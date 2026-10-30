/**
 * Newsletter subscriptions: double opt-in, unsubscribe, admin list/export.
 *
 * Storage-agnostic: the same state machine runs on SQLite (Node server) and
 * on the encrypted Netlify Blobs document (static deployment), through
 * `NewsletterStore.transact`. Email goes through a `Mailer`.
 *
 *   subscribe ─▶ pending ──confirm (token)──▶ active ──unsubscribe──▶ unsubscribed
 *                   ▲                                                     │
 *                   └────────── subscribe again (still needs confirm) ◀──┘
 *
 * Rules:
 * - Nothing becomes `active` without the emailed token. Tokens are 256-bit,
 *   stored as SHA-256, single-use, and expire (NEWSLETTER_TOKEN_TTL_HOURS).
 * - The public answer is identical for new, pending, active and unsubscribed
 *   addresses; an active address gets an "already subscribed" note instead.
 * - Emails are sent after the transaction commits. If the provider fails, the
 *   token is retired, the row records `send_failed`, nothing is activated and
 *   the visitor is told the truth (502), so retrying immediately works.
 * - Abuse limits: per client (hashed address) window, per address cooldown and
 *   daily cap, and a site-wide daily send budget kept under the provider's
 *   free quota.
 * - Logs carry masked addresses and ids only, never tokens.
 */
import { badRequest, conflict, gone, notFound, rateLimited, unavailable, upstreamError } from '../../core/errors.ts';
import { isSubscriberStatus, maskEmail, normalizeEmail, toCsv } from '../../core/newsletter.ts';
import type {
  NewsletterConfirmResponse, NewsletterDelivery, NewsletterListResponse, NewsletterResendResponse,
  NewsletterSubscribeResponse, NewsletterSubscriber, NewsletterUnsubscribeResponse,
} from '../../shared/contracts.ts';
import { DEFAULT_LOCALE, localePath, parseLocale, type Locale } from '../../shared/i18n.ts';
import { NEWSLETTER_CONFIRM_PATH, NEWSLETTER_UNSUBSCRIBE_PATH } from '../../shared/routes.ts';
import type { NewsletterConfig } from '../newsletter/config.ts';
import { TOKEN_PATTERN, clientKey, hashToken, newToken, unsubscribeToken, unsubscribeTokenId, verifyUnsubscribeToken } from '../newsletter/crypto.ts';
import { alreadySubscribedEmail, confirmationEmail, welcomeEmail } from '../newsletter/emails.ts';
import type { EmailMessage, Mailer } from '../newsletter/mailer.ts';
import type { NewsletterStore, NewsletterTx, SubscriberRecord } from '../newsletter/store.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const NEWSLETTER_LIMITS = {
  /** Sign-up attempts per client address per window. */
  clientWindowMs: 10 * MINUTE,
  clientMax: 8,
  /** Clients we cannot tell apart (behind an untrusted proxy) share a larger bucket. */
  sharedClientMax: 60,
  /** No second confirmation email to the same address within this time. */
  confirmCooldownMs: 10 * MINUTE,
  /** Confirmation emails per address per 24 hours. */
  confirmPerDay: 5,
  /** "Already subscribed" notes per address. */
  noticeIntervalMs: DAY,
  /** Consumed and expired tokens are deleted after this. */
  tokenRetentionMs: 7 * DAY,
} as const;

const SUBSCRIBE_OK: NewsletterSubscribeResponse = { status: 'check-inbox' };
const INVALID_LINK = 'this link is invalid or has already been replaced';
const DAILY_LIMIT = 'sign-up is paused until tomorrow: the daily email limit has been reached. Nothing was saved.';
const SEND_FAILED = 'the confirmation email could not be sent. Nothing was activated; please try again later.';
const NOT_CONFIGURED = 'newsletter sign-up is not available yet: email delivery is not configured on this server. Nothing was saved.';

export interface ClientInfo {
  /** Address of the client, or a shared label when it cannot be trusted. */
  ip: string;
  /** True when `ip` cannot distinguish clients (uses the shared bucket). */
  shared?: boolean;
}

export interface SubscribeInput {
  email?: unknown;
  locale?: unknown;
  source?: unknown;
  website?: unknown;
}

export interface SubscriberListQuery {
  q?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

export interface NewsletterServiceDeps {
  /** Null when the storage cannot be opened (e.g. Netlify without NEWSLETTER_SECRET). */
  store: NewsletterStore | null;
  storage: NewsletterDelivery['storage'];
  config: NewsletterConfig;
  mailer: Mailer | null;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export type NewsletterService = ReturnType<typeof createNewsletterService>;

const defaultLog = (event: string, fields: Record<string, unknown> = {}) => console.info(`[newsletter] ${event}`, JSON.stringify(fields));

const cleanSource = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);

function toPublic(row: SubscriberRecord): NewsletterSubscriber {
  return {
    id: row.id, email: row.email, status: row.status, locale: row.locale, source: row.source, createdAt: row.createdAt,
    confirmedAt: row.confirmedAt, unsubscribedAt: row.unsubscribedAt, lastError: row.lastError, lastErrorAt: row.lastErrorAt,
  };
}

export function createNewsletterService(deps: NewsletterServiceDeps) {
  const { config, mailer } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? defaultLog;

  const store = (): NewsletterStore => {
    if (!deps.store) throw unavailable('the subscriber store is not available: NEWSLETTER_SECRET is not configured');
    return deps.store;
  };
  const deliverable = () => Boolean(config.enabled && mailer && deps.store && config.secret && config.siteUrl);
  const secret = () => {
    if (!config.secret) throw unavailable('NEWSLETTER_SECRET is not configured');
    return config.secret;
  };
  const localeOf = (value: unknown): Locale => parseLocale(typeof value === 'string' ? value : null) ?? DEFAULT_LOCALE;
  const link = (path: string, locale: Locale, fragment = '') => `${config.siteUrl}${localePath(path, locale)}${fragment}`;
  const unsubscribeUrls = (row: SubscriberRecord) => {
    const token = unsubscribeToken(secret(), row.id, row.normalizedEmail);
    const locale = localeOf(row.locale);
    return {
      page: link(NEWSLETTER_UNSUBSCRIBE_PATH, locale, `#token=${token}`),
      oneClick: `${config.siteUrl}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
    };
  };
  /** RFC 2369 + RFC 8058: mail clients show an unsubscribe button that POSTs to oneClick. */
  const listHeaders = (oneClick: string) => ({
    'List-Unsubscribe': `<${oneClick}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });

  function confirmationMessage(row: SubscriberRecord, token: string): EmailMessage {
    const locale = localeOf(row.locale);
    const mail = confirmationEmail(locale, config.siteName, link(NEWSLETTER_CONFIRM_PATH, locale, `#token=${token}`), Math.round(config.tokenTtlMs / HOUR));
    return { to: row.email, ...mail, idempotencyKey: `confirm-${hashToken(token).slice(0, 32)}` };
  }

  /** Create a fresh confirmation token inside a transaction (retiring older ones). */
  const issueToken = (tx: NewsletterTx, row: SubscriberRecord, at: Date) => {
    const raw = newToken();
    tx.retireTokens(row.id, 'confirm', at.toISOString());
    const token = tx.insertToken({
      subscriberId: row.id, tokenHash: hashToken(raw), tokenType: 'confirm',
      expiresAt: new Date(at.getTime() + config.tokenTtlMs).toISOString(), consumedAt: null, createdAt: at.toISOString(),
    });
    return { raw, id: token.id };
  };

  async function deliverConfirmation(row: SubscriberRecord, raw: string, tokenId: number) {
    try {
      await mailer!.send(confirmationMessage(row, raw));
    } catch (error) {
      log('confirmation send failed', { id: row.id, to: maskEmail(row.email), provider: mailer!.provider, reason: (error as Error)?.message });
      const at = now().toISOString();
      await store().transact((tx) => {
        tx.consumeToken(tokenId, at); // retired: the visitor may retry at once
        tx.updateSubscriber(row.id, { lastError: 'send_failed', lastErrorAt: at, updatedAt: at });
      });
      throw upstreamError(SEND_FAILED);
    }
    if (row.lastError) {
      await store().transact((tx) => tx.updateSubscriber(row.id, { lastError: null, lastErrorAt: null }));
    }
    log('confirmation sent', { id: row.id, to: maskEmail(row.email) });
  }

  async function delivery(): Promise<NewsletterDelivery> {
    const day = now().toISOString().slice(0, 10);
    const sentToday = deps.store ? await deps.store.transact((tx) => tx.sentOn(day)) : 0;
    return { configured: deliverable(), provider: config.provider, missing: config.missing, storage: deps.storage, dailyLimit: config.dailyLimit, sentToday };
  }

  return {
    /** Public: whether a visitor can sign up here. */
    availability: () => ({ enabled: deliverable() }),

    async subscribe(input: SubscribeInput, client: ClientInfo): Promise<NewsletterSubscribeResponse> {
      // Honeypot: people never see the field; a filled one is a bot. Store and send nothing.
      if (typeof input.website === 'string' && input.website.trim()) {
        log('honeypot', {});
        return SUBSCRIBE_OK;
      }
      if (!deliverable()) throw unavailable(NOT_CONFIGURED);
      const address = normalizeEmail(input.email);
      if (!address) throw badRequest('enter a valid email address', { field: 'email' });
      const locale = localeOf(input.locale);
      const source = cleanSource(input.source);
      const at = now();
      const iso = at.toISOString();
      const day = iso.slice(0, 10);
      const key = client.shared ? 'shared' : clientKey(secret(), client.ip || 'unknown');
      const max = client.shared ? NEWSLETTER_LIMITS.sharedClientMax : NEWSLETTER_LIMITS.clientMax;

      type Plan =
        | { kind: 'none' }
        | { kind: 'confirm'; row: SubscriberRecord; raw: string; tokenId: number }
        | { kind: 'already'; row: SubscriberRecord; previousNotice: string | null };

      const plan = await store().transact<Plan>((tx) => {
        if (!tx.hitRateLimit(key, max, NEWSLETTER_LIMITS.clientWindowMs, at.getTime())) throw rateLimited('too many sign-up attempts, please try again later');
        // Checked before looking the address up, so the answer cannot depend on it.
        if (tx.sentOn(day) >= config.dailyLimit) throw unavailable(DAILY_LIMIT);
        tx.purgeTokens(new Date(at.getTime() - NEWSLETTER_LIMITS.tokenRetentionMs).toISOString());

        let row = tx.findSubscriberByEmail(address.normalized);
        if (row?.status === 'active') {
          if (row.noticeSentAt && at.getTime() - Date.parse(row.noticeSentAt) < NEWSLETTER_LIMITS.noticeIntervalMs) return { kind: 'none' };
          if (!tx.reserveSend(day, config.dailyLimit)) throw unavailable(DAILY_LIMIT);
          tx.updateSubscriber(row.id, { noticeSentAt: iso, updatedAt: iso });
          return { kind: 'already', row, previousNotice: row.noticeSentAt };
        }
        if (row) {
          // pending, or unsubscribed and asking again: still needs a confirmed token.
          const today = tx.recentTokens(row.id, 'confirm', new Date(at.getTime() - DAY).toISOString());
          const cooling = today.some((token) => !token.consumedAt && at.getTime() - Date.parse(token.createdAt) < NEWSLETTER_LIMITS.confirmCooldownMs);
          if (cooling || today.length >= NEWSLETTER_LIMITS.confirmPerDay) return { kind: 'none' };
          tx.updateSubscriber(row.id, { email: address.email, locale, updatedAt: iso });
          row = { ...row, email: address.email, locale };
        } else {
          row = tx.insertSubscriber({
            email: address.email, normalizedEmail: address.normalized, status: 'pending', source, locale, createdAt: iso, updatedAt: iso,
            confirmedAt: null, unsubscribedAt: null, lastError: null, lastErrorAt: null, noticeSentAt: null,
          });
        }
        if (!tx.reserveSend(day, config.dailyLimit)) throw unavailable(DAILY_LIMIT);
        const token = issueToken(tx, row, at);
        return { kind: 'confirm', row, raw: token.raw, tokenId: token.id };
      });

      if (plan.kind === 'confirm') await deliverConfirmation(plan.row, plan.raw, plan.tokenId);
      if (plan.kind === 'already') {
        const urls = unsubscribeUrls(plan.row);
        const mail = alreadySubscribedEmail(localeOf(plan.row.locale), config.siteName, link('/', localeOf(plan.row.locale)), urls.page);
        try {
          await mailer!.send({ to: plan.row.email, ...mail, headers: listHeaders(urls.oneClick) });
        } catch (error) {
          log('notice send failed', { id: plan.row.id, to: maskEmail(plan.row.email), reason: (error as Error)?.message });
          await store().transact((tx) => tx.updateSubscriber(plan.row.id, { noticeSentAt: plan.previousNotice }));
          throw upstreamError(SEND_FAILED);
        }
      }
      return SUBSCRIBE_OK;
    },

    async confirm(token: unknown): Promise<NewsletterConfirmResponse> {
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw badRequest(INVALID_LINK, { reason: 'invalid' });
      const hash = hashToken(token);
      const at = now();
      const iso = at.toISOString();
      const result = await store().transact((tx) => {
        const record = tx.findTokenByHash(hash);
        const row = record && record.tokenType === 'confirm' ? tx.findSubscriber(record.subscriberId) : undefined;
        if (!record || !row) throw badRequest(INVALID_LINK, { reason: 'invalid' });
        // A second click on a used link is fine while the subscription stands.
        if (record.consumedAt) {
          if (row.status === 'active') return { status: 'already-confirmed' as const };
          throw badRequest(INVALID_LINK, { reason: 'invalid' });
        }
        if (Date.parse(record.expiresAt) <= at.getTime()) throw gone('this confirmation link has expired; subscribe again to get a new one', { reason: 'expired' });
        if (!tx.consumeToken(record.id, iso)) throw badRequest(INVALID_LINK, { reason: 'invalid' });
        tx.retireTokens(row.id, 'confirm', iso);
        if (row.status === 'active') return { status: 'already-confirmed' as const };
        tx.updateSubscriber(row.id, { status: 'active', confirmedAt: iso, updatedAt: iso, lastError: null, lastErrorAt: null });
        const welcome = Boolean(mailer && config.siteUrl && config.secret) && tx.reserveSend(iso.slice(0, 10), config.dailyLimit);
        return { status: 'confirmed' as const, row, welcome };
      });
      if (result.status === 'confirmed') {
        log('confirmed', { id: result.row.id, to: maskEmail(result.row.email) });
        if (result.welcome) {
          // Best effort: the subscription is already active; a lost welcome note is not an error.
          try {
            const urls = unsubscribeUrls(result.row);
            const locale = localeOf(result.row.locale);
            await mailer!.send({ to: result.row.email, ...welcomeEmail(locale, config.siteName, link('/', locale), urls.page), headers: listHeaders(urls.oneClick) });
          } catch (error) {
            log('welcome send failed', { id: result.row.id, reason: (error as Error)?.message });
          }
        }
      }
      return { status: result.status };
    },

    /** Idempotent. Works for one-click (RFC 8058) and for the page. Sends nothing. */
    async unsubscribe(token: unknown): Promise<NewsletterUnsubscribeResponse> {
      const id = unsubscribeTokenId(token);
      if (!id) throw badRequest(INVALID_LINK, { reason: 'invalid' });
      const key = secret();
      const iso = now().toISOString();
      const changed = await store().transact((tx) => {
        const row = tx.findSubscriber(id);
        if (!row || !verifyUnsubscribeToken(key, token as string, id, row.normalizedEmail)) throw badRequest(INVALID_LINK, { reason: 'invalid' });
        if (row.status === 'unsubscribed') return false;
        tx.updateSubscriber(id, { status: 'unsubscribed', unsubscribedAt: iso, updatedAt: iso });
        tx.retireTokens(id, 'confirm', iso);
        return true;
      });
      if (changed) log('unsubscribed', { id });
      return { status: 'unsubscribed' };
    },

    delivery,

    async list(query: SubscriberListQuery = {}): Promise<NewsletterListResponse> {
      const filter = parseQuery(query);
      const limit = Math.min(Math.max(Math.floor(query.limit ?? 50) || 50, 1), 200);
      const offset = Math.max(Math.floor(query.offset ?? 0) || 0, 0);
      const { rows, total, counts } = await store().transact((tx) => ({ ...tx.listSubscribers({ ...filter, limit, offset }), counts: tx.counts() }));
      return { subscribers: rows.map(toPublic), total, counts, delivery: await delivery() };
    },

    /** Minimal fields only — no ids, tokens, hashes or error details. */
    async exportCsv(query: SubscriberListQuery = {}): Promise<{ filename: string; csv: string }> {
      const rows = await store().transact((tx) => tx.allSubscribers(parseQuery(query)));
      const csv = toCsv(
        ['email', 'status', 'locale', 'source', 'created_at', 'confirmed_at', 'unsubscribed_at'],
        rows.map((row) => [row.email, row.status, row.locale, row.source, row.createdAt, row.confirmedAt, row.unsubscribedAt]),
      );
      log('exported', { rows: rows.length });
      return { filename: `newsletter-subscribers-${now().toISOString().slice(0, 10)}.csv`, csv };
    },

    /** Admin recovery: send a fresh confirmation to a pending address (e.g. after a provider outage). */
    async resend(id: number): Promise<NewsletterResendResponse> {
      if (!deliverable()) throw unavailable(NOT_CONFIGURED);
      const at = now();
      const day = at.toISOString().slice(0, 10);
      const plan = await store().transact((tx) => {
        const row = tx.findSubscriber(id);
        if (!row) throw notFound('subscriber not found');
        if (row.status !== 'pending') throw conflict('only pending subscribers can be sent a new confirmation');
        if (!tx.reserveSend(day, config.dailyLimit)) throw unavailable(DAILY_LIMIT);
        const token = issueToken(tx, row, at);
        return { row, raw: token.raw, tokenId: token.id };
      });
      await deliverConfirmation(plan.row, plan.raw, plan.tokenId);
      return { status: 'sent' };
    },
  };
}

function parseQuery(query: SubscriberListQuery) {
  const status = query.status ? String(query.status) : '';
  if (status && !isSubscriberStatus(status)) throw badRequest('unknown status', { status });
  const q = String(query.q ?? '').trim().slice(0, 100);
  return { ...(q ? { q } : {}), ...(status ? { status: status as SubscriberRecord['status'] } : {}) };
}
