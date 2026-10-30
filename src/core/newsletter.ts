/**
 * Newsletter primitives with no I/O: address validation/normalisation, the
 * subscriber status vocabulary, CSV that spreadsheets cannot execute, and a
 * log-safe address mask. Shared by the service, both storage engines and tests.
 */

/** Lifecycle of a subscriber. New states may be added; nothing assumes this list is closed. */
export const NEWSLETTER_STATUSES = ['pending', 'active', 'unsubscribed'] as const;
export type SubscriberStatus = (typeof NEWSLETTER_STATUSES)[number];

export const isSubscriberStatus = (value: unknown): value is SubscriberStatus =>
  (NEWSLETTER_STATUSES as readonly unknown[]).includes(value);

/** RFC 5321 limits: 254 for the whole path, 64 for the local part, 63 per label. */
const MAX_ADDRESS = 254;
const MAX_LOCAL = 64;
/** RFC 5322 dot-atom, ASCII only. Quoted local parts and SMTPUTF8 are refused on purpose:
 * almost no provider delivers them reliably, and they widen the injection surface. */
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export interface NormalizedEmail {
  /** As typed (trimmed), with the domain lower-cased — what we write to. */
  email: string;
  /** Lookup and uniqueness key: the whole address lower-cased. */
  normalized: string;
}

/**
 * Validate and normalise an address, or return `null`.
 *
 * - Unicode domains become punycode (`bücher.example` → `xn--bcher-kva.example`).
 * - The uniqueness key lower-cases the local part too. Strictly the local part
 *   is case-sensitive, but no mainstream mailbox treats it that way, and a
 *   case-sensitive key would let one person hold two subscriptions.
 * - Provider-specific aliases (Gmail dots, `+tags`) are *not* folded: they are
 *   legitimate distinct addresses for many providers.
 */
export function normalizeEmail(raw: unknown): NormalizedEmail | null {
  if (typeof raw !== 'string') return null;
  const value = raw.normalize('NFC').trim();
  if (!value || value.length > MAX_ADDRESS || /[\s\u0000-\u001f\u007f<>"(),;:\\[\]]/.test(value)) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at !== value.indexOf('@') || at === value.length - 1) return null;
  const local = value.slice(0, at);
  const domainInput = value.slice(at + 1);
  if (local.length > MAX_LOCAL || !LOCAL.test(local)) return null;
  if (/[/?#:%]/.test(domainInput)) return null;
  let domain: string;
  try {
    domain = new URL(`http://${domainInput}`).hostname;
  } catch {
    return null;
  }
  // URL accepts IP literals, ports and paths; the round trip must be a plain host.
  if (!domain || domain !== domain.toLowerCase() || domain.endsWith('.') || domain.length > 253) return null;
  if (domainInput.toLowerCase() !== domain && !/[^\x00-\x7f]/.test(domainInput)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)) || !TLD.test(labels.at(-1)!)) return null;
  const email = `${local}@${domain}`;
  if (email.length > MAX_ADDRESS) return null;
  return { email, normalized: email.toLowerCase() };
}

/** `j•••@example.com` — enough to recognise a row in a log, never the whole address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${email[0]}•••@${email.slice(at + 1)}`;
}

/**
 * One CSV field. Values that a spreadsheet would treat as a formula
 * (`=`, `+`, `-`, `@`, tab, CR — OWASP "CSV injection") are prefixed with `'`,
 * then the field is quoted when it contains a delimiter, quote or newline.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 document with CRLF line endings. */
export const toCsv = (header: readonly string[], rows: readonly (readonly unknown[])[]): string =>
  [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
