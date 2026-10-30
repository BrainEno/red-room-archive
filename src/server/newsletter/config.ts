/**
 * Newsletter configuration, read from the environment on every call.
 *
 * Sign-up is enabled only when *all* of these are present; otherwise the
 * public endpoint answers 503 and stores nothing (never a fake success):
 *
 *   NEWSLETTER_SECRET          ≥ 32 characters; HMAC/encryption key
 *   SITE_URL                   public origin used in email links (on Netlify,
 *                              the built-in URL is used when unset)
 *   NEWSLETTER_EMAIL_PROVIDER  `resend` or `brevo`
 *   NEWSLETTER_EMAIL_API_KEY   the provider's API key
 *   NEWSLETTER_FROM            `Name <letters@your-domain>` (verified sender)
 *
 * Optional: NEWSLETTER_REPLY_TO, NEWSLETTER_DAILY_LIMIT (default 90 — below
 * Resend's free 100/day), NEWSLETTER_TOKEN_TTL_HOURS (default 48),
 * NEWSLETTER_SITE_NAME (default from content/site.ts).
 */
import { readEnv } from '../../core/env.ts';
import { normalizeEmail } from '../../core/newsletter.ts';
import { site } from '../../content/site.ts';

export const EMAIL_PROVIDERS = ['resend', 'brevo'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export interface Sender {
  name: string;
  email: string;
}

export interface NewsletterConfig {
  secret: string | null;
  siteUrl: string | null;
  provider: EmailProvider | null;
  apiKey: string | null;
  from: Sender | null;
  replyTo: string | null;
  dailyLimit: number;
  tokenTtlMs: number;
  siteName: string;
  /** Names of required variables that are missing or invalid. */
  missing: string[];
  enabled: boolean;
}

const MIN_SECRET = 32;

const positive = (value: string | undefined, fallback: number, max: number) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

/** `Name <addr@domain>` or a bare address. Header-breaking characters are refused. */
export function parseSender(raw: string | undefined): Sender | null {
  const value = String(raw ?? '').trim();
  if (!value || /[\r\n]/.test(value)) return null;
  const match = /^(?:"?([^"<>]*?)"?\s*)?<([^<>\s]+)>$/.exec(value);
  const address = normalizeEmail(match ? match[2] : value);
  if (!address) return null;
  const name = (match?.[1] ?? '').trim();
  if (/[<>"\\]/.test(name) || name.length > 80) return null;
  return { name, email: address.email };
}

/** A plain http(s) origin, or null. */
export function parseOrigin(raw: string | undefined): string | null {
  try {
    const url = new URL(String(raw ?? '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function newsletterConfig(env: (key: string) => string | undefined = readEnv): NewsletterConfig {
  const missing: string[] = [];
  const secretValue = env('NEWSLETTER_SECRET') ?? '';
  const secret = secretValue.length >= MIN_SECRET ? secretValue : null;
  if (!secret) missing.push('NEWSLETTER_SECRET');

  // Netlify exposes the primary site address as URL; an explicit SITE_URL wins.
  const siteUrl = parseOrigin(env('SITE_URL') || (env('NETLIFY') === 'true' ? env('URL') : ''));
  if (!siteUrl) missing.push('SITE_URL');

  const providerValue = (env('NEWSLETTER_EMAIL_PROVIDER') ?? '').trim().toLowerCase();
  const provider = (EMAIL_PROVIDERS as readonly string[]).includes(providerValue) ? (providerValue as EmailProvider) : null;
  if (!provider) missing.push('NEWSLETTER_EMAIL_PROVIDER');

  const apiKey = (env('NEWSLETTER_EMAIL_API_KEY') ?? '').trim() || null;
  if (!apiKey) missing.push('NEWSLETTER_EMAIL_API_KEY');

  const from = parseSender(env('NEWSLETTER_FROM'));
  if (!from) missing.push('NEWSLETTER_FROM');

  const replyTo = normalizeEmail(env('NEWSLETTER_REPLY_TO') ?? '')?.email ?? null;
  const siteName = (env('NEWSLETTER_SITE_NAME') ?? '').replace(/[\r\n<>]/g, '').trim().slice(0, 80) || site.name;

  return {
    secret, siteUrl, provider, apiKey, from, replyTo, siteName, missing,
    dailyLimit: positive(env('NEWSLETTER_DAILY_LIMIT'), 90, 100_000),
    tokenTtlMs: positive(env('NEWSLETTER_TOKEN_TTL_HOURS'), 48, 24 * 14) * 60 * 60 * 1000,
    enabled: missing.length === 0,
  };
}
