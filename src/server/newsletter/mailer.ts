/**
 * Email delivery behind one small interface, so the provider can be swapped
 * without touching the service. Two adapters, both plain HTTPS + JSON with a
 * free tier that needs no credit card:
 *
 *   resend — POST https://api.resend.com/emails        (Bearer key)
 *   brevo  — POST https://api.brevo.com/v3/smtp/email  (`api-key` header)
 *
 * Both accept custom headers, which carries RFC 8058 one-click unsubscribe
 * (`List-Unsubscribe` + `List-Unsubscribe-Post`). Errors never include the
 * recipient or the provider's response body (it can echo the address).
 *
 * Resend also reports quota use on every response (`x-resend-daily-quota`,
 * free plan only, and `x-resend-monthly-quota`: emails used so far) and
 * answers 429 `daily_quota_exceeded` / `monthly_quota_exceeded` when a quota
 * is spent. Both are surfaced so the service can stop before the provider
 * does. See https://resend.com/docs/api-reference/rate-limit
 */
import type { EmailProvider, NewsletterConfig, Sender } from './config.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  /** Lets the provider drop an accidental duplicate of the same send. */
  idempotencyKey?: string;
}

export type QuotaPeriod = 'daily' | 'monthly';

export interface SendResult {
  /** Emails the provider says were used in its current day / month, when it says. */
  usage?: { daily?: number; monthly?: number };
}

export interface Mailer {
  readonly provider: EmailProvider | 'test';
  send(message: EmailMessage): Promise<SendResult | void>;
}

export class MailerError extends Error {
  readonly status: number | null;
  /** Set when the provider refused because a sending quota is used up. */
  readonly quota: QuotaPeriod | null;
  constructor(provider: string, status: number | null, reason = '', quota: QuotaPeriod | null = null) {
    super(`${provider} rejected the message${status ? ` (HTTP ${status})` : ''}${reason ? `: ${reason}` : ''}`);
    this.name = 'MailerError';
    this.status = status;
    this.quota = quota;
  }
}

const TIMEOUT_MS = 6000;

/** Header values must stay on one line. */
const headerSafe = (headers: Record<string, string> = {}) =>
  Object.fromEntries(Object.entries(headers).filter(([name, value]) => /^[A-Za-z0-9-]+$/.test(name) && !/[\r\n]/.test(value)));

const display = (sender: Sender) => (sender.name ? `${sender.name} <${sender.email}>` : sender.email);

type Fetch = typeof fetch;

const count = (value: string | null) => {
  if (value === null || !/^\s*\d+\s*$/.test(value)) return undefined;
  return Number(value);
};

/** Resend's quota headers: emails already used today (free plan) and this month. */
function resendUsage(response: Response): SendResult {
  const daily = count(response.headers.get('x-resend-daily-quota'));
  const monthly = count(response.headers.get('x-resend-monthly-quota'));
  return daily === undefined && monthly === undefined ? {} : { usage: { ...(daily !== undefined ? { daily } : {}), ...(monthly !== undefined ? { monthly } : {}) } };
}

/** Only the error *type* is read from a 429 body — never logged, never the message. */
async function resendQuota(response: Response): Promise<QuotaPeriod | null> {
  if (response.status !== 429) return null;
  try {
    const name = ((await response.clone().json()) as { name?: unknown })?.name;
    return name === 'daily_quota_exceeded' ? 'daily' : name === 'monthly_quota_exceeded' ? 'monthly' : null;
  } catch {
    return null;
  }
}

async function post(
  provider: string, fetchImpl: Fetch, url: string, headers: Record<string, string>, body: unknown,
  inspect?: { usage?: (response: Response) => SendResult; quota?: (response: Response) => Promise<QuotaPeriod | null> },
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new MailerError(provider, null, (error as Error)?.name === 'TimeoutError' ? 'timed out' : 'network error');
  }
  const quota = !response.ok && inspect?.quota ? await inspect.quota(response) : null;
  const result = inspect?.usage ? inspect.usage(response) : {};
  // Drain without reading the content into logs.
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok) throw new MailerError(provider, response.status, quota ? `${quota} quota exceeded` : '', quota);
  return result;
}

export function resendMailer(apiKey: string, from: Sender, replyTo: string | null, fetchImpl: Fetch = fetch): Mailer {
  return {
    provider: 'resend',
    send: (message) =>
      post('resend', fetchImpl, 'https://api.resend.com/emails',
        { Authorization: `Bearer ${apiKey}`, ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}) },
        {
          from: display(from),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(message.headers ? { headers: headerSafe(message.headers) } : {}),
        },
        { usage: resendUsage, quota: resendQuota }),
  };
}

export function brevoMailer(apiKey: string, from: Sender, replyTo: string | null, fetchImpl: Fetch = fetch): Mailer {
  return {
    provider: 'brevo',
    send: (message) =>
      post('brevo', fetchImpl, 'https://api.brevo.com/v3/smtp/email', { 'api-key': apiKey }, {
        sender: { email: from.email, ...(from.name ? { name: from.name } : {}) },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        ...(message.headers ? { headers: headerSafe(message.headers) } : {}),
      }),
  };
}

/** The configured adapter, or null when delivery is not fully configured. */
export function createMailer(config: NewsletterConfig, fetchImpl: Fetch = fetch): Mailer | null {
  if (!config.enabled || !config.apiKey || !config.from || !config.provider) return null;
  if (config.provider === 'resend') return resendMailer(config.apiKey, config.from, config.replyTo, fetchImpl);
  return brevoMailer(config.apiKey, config.from, config.replyTo, fetchImpl);
}
