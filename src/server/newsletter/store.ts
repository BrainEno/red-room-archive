/**
 * Storage contract for the newsletter.
 *
 * The service runs its state machine inside `transact(fn)`: `fn` sees one
 * consistent snapshot, every change it makes is committed together, and a
 * throw commits nothing. `fn` is synchronous and must not perform I/O (it
 * may be re-run when an optimistic commit loses a race), so emails are sent
 * by the service *after* the transaction, never inside it.
 *
 * Two engines implement it:
 *   - `db/newsletter.repository.ts` — SQLite tables (Node server), real
 *     transactions and UNIQUE constraints;
 *   - `newsletter/document-store.ts` — one encrypted JSON document committed
 *     with compare-and-swap (Netlify Blobs on the static deployment).
 *
 * All timestamps are ISO-8601 UTC strings.
 */
import type { SubscriberStatus } from '../../core/newsletter.ts';
import type { NewsletterCounts } from '../../shared/contracts.ts';

export interface SubscriberRecord {
  id: number;
  email: string;
  normalizedEmail: string;
  status: SubscriberStatus;
  source: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Last "you are already subscribed" notice, so repeats cannot flood an inbox. */
  noticeSentAt: string | null;
}

export type NewSubscriber = Omit<SubscriberRecord, 'id'>;
export type SubscriberPatch = Partial<Omit<SubscriberRecord, 'id' | 'normalizedEmail' | 'createdAt'>>;

/** Only `confirm` exists today; the column is free text so new kinds need no migration. */
export type TokenType = 'confirm';

export interface TokenRecord {
  id: number;
  subscriberId: number;
  /** SHA-256 of the token sent by email. The token itself is never stored. */
  tokenHash: string;
  tokenType: TokenType;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export type NewToken = Omit<TokenRecord, 'id'>;

export interface SubscriberQuery {
  /** Case-insensitive substring of the address. */
  q?: string;
  status?: SubscriberStatus;
  limit: number;
  offset: number;
}

export interface NewsletterTx {
  findSubscriberByEmail(normalizedEmail: string): SubscriberRecord | undefined;
  findSubscriber(id: number): SubscriberRecord | undefined;
  /** Throws if the normalised address already exists (uniqueness is the store's job too). */
  insertSubscriber(subscriber: NewSubscriber): SubscriberRecord;
  updateSubscriber(id: number, patch: SubscriberPatch): void;

  insertToken(token: NewToken): TokenRecord;
  findTokenByHash(tokenHash: string): TokenRecord | undefined;
  /** Tokens of one subscriber and type created at or after `since`. */
  recentTokens(subscriberId: number, type: TokenType, since: string): TokenRecord[];
  /** Mark one token used. False when it was already consumed (single use). */
  consumeToken(id: number, at: string): boolean;
  /** Retire every unconsumed token of this subscriber and type (a newer one supersedes them). */
  retireTokens(subscriberId: number, type: TokenType, at: string): void;
  /** Delete tokens that expired or were consumed before `before`. */
  purgeTokens(before: string): void;

  /** Fixed-window counter keyed by an opaque string (hashed client address).
   * Increments and returns true while under `limit`; false once the window is full. */
  hitRateLimit(key: string, limit: number, windowMs: number, nowMs: number): boolean;

  /** Emails counted for this UTC day (`YYYY-MM-DD`) and its calendar month. */
  sendUsage(day: string): SendUsage;
  /** Count one email against `day` and its month. Limits are checked by the service. */
  recordSend(day: string): void;
  /** Raise the counters to what the email provider reports (never lowers them). */
  raiseSendUsage(day: string, usage: Partial<SendUsage>): void;

  listSubscribers(query: SubscriberQuery): { rows: SubscriberRecord[]; total: number };
  allSubscribers(query: Omit<SubscriberQuery, 'limit' | 'offset'>): SubscriberRecord[];
  counts(): NewsletterCounts;
}

/** Emails sent (or reserved) in one UTC day and in that day's calendar month. */
export interface SendUsage {
  daily: number;
  monthly: number;
}

/**
 * Send counters are keyed by period: `YYYY-MM-DD` (a UTC day) and `YYYY-MM`
 * (its month). Keys sort as text, and a month key sorts before that month's
 * days, so everything older than the previous month is `key < keepFrom(day)`.
 */
export const monthOf = (day: string) => day.slice(0, 7);
export function keepSendCountsFrom(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export interface NewsletterStore {
  readonly kind: 'sqlite' | 'netlify-blobs' | 'memory';
  transact<T>(fn: (tx: NewsletterTx) => T): Promise<T>;
}

/** Thrown by stores when the normalised address is taken (the service checks first). */
export class DuplicateSubscriberError extends Error {
  constructor() {
    super('subscriber already exists');
    this.name = 'DuplicateSubscriberError';
  }
}

/** Shared filter for engines that hold rows in memory. */
export function matchesQuery(row: SubscriberRecord, query: Omit<SubscriberQuery, 'limit' | 'offset'>): boolean {
  if (query.status && row.status !== query.status) return false;
  const needle = query.q?.trim().toLowerCase();
  return !needle || row.normalizedEmail.includes(needle);
}
