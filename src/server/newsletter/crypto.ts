/**
 * Token and encryption helpers for the newsletter (node:crypto only).
 *
 * - Confirmation tokens: 32 random bytes from the CSPRNG, base64url. Only the
 *   SHA-256 is stored; a 256-bit random token needs no salt or slow hash.
 * - Unsubscribe tokens: `<id base36>.<HMAC-SHA256(secret, id + address)>`.
 *   Nothing is stored, every future email can carry a working link, and
 *   rotating NEWSLETTER_SECRET revokes all of them at once.
 * - The Netlify Blobs document is sealed with AES-256-GCM under a key derived
 *   (HKDF) from NEWSLETTER_SECRET, so a deploy without the production secret
 *   (e.g. a Deploy Preview of an untrusted branch) cannot read addresses.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UNSUBSCRIBE_PATTERN = /^([0-9a-z]{1,11})\.([A-Za-z0-9_-]{43})$/;

export const newToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

const mac = (secret: string, message: string): string => createHmac('sha256', secret).update(message, 'utf8').digest('base64url');

const unsubscribeMessage = (id: number, normalizedEmail: string) => `newsletter:unsubscribe:v1:${id}:${normalizedEmail}`;

export const unsubscribeToken = (secret: string, id: number, normalizedEmail: string): string =>
  `${id.toString(36)}.${mac(secret, unsubscribeMessage(id, normalizedEmail))}`;

/** The subscriber id a well-formed unsubscribe token claims (not yet verified). */
export function unsubscribeTokenId(token: unknown): number | null {
  const match = typeof token === 'string' ? UNSUBSCRIBE_PATTERN.exec(token) : null;
  if (!match) return null;
  const id = parseInt(match[1]!, 36);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function verifyUnsubscribeToken(secret: string, token: string, id: number, normalizedEmail: string): boolean {
  const expected = Buffer.from(unsubscribeToken(secret, id, normalizedEmail));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Stable, non-reversible rate-limit key for a client address. */
export const clientKey = (secret: string, ip: string): string => mac(secret, `newsletter:ip:${ip}`).slice(0, 22);

const AAD = Buffer.from('red-room-archive/newsletter/v1');
const keyFor = (secret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('red-room-newsletter'), Buffer.from('document-v1'), 32));

export interface SealedDocument {
  format: 'red-room-newsletter';
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function seal(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const sealed: SealedDocument = { format: 'red-room-newsletter', v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  return JSON.stringify(sealed);
}

export class UnreadableDocumentError extends Error {
  constructor() {
    super('the subscriber store cannot be decrypted (was NEWSLETTER_SECRET changed?)');
    this.name = 'UnreadableDocumentError';
  }
}

export function unseal(secret: string, text: string): string {
  try {
    const sealed = JSON.parse(text) as SealedDocument;
    if (sealed?.format !== 'red-room-newsletter' || sealed.v !== 1) throw new Error('format');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new UnreadableDocumentError();
  }
}
