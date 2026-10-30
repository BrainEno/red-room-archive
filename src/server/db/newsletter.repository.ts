/**
 * Newsletter tables (migration 11) as a NewsletterStore.
 *
 * Every service call runs inside one SQLite transaction (`transaction()` from
 * connection.ts), so a failure anywhere rolls the whole step back. The UNIQUE
 * index on `normalized_email` backs the service's own duplicate check.
 */
import { isSubscriberStatus } from '../../core/newsletter.ts';
import type { NewsletterCounts } from '../../shared/contracts.ts';
import {
  DuplicateSubscriberError, keepSendCountsFrom, monthOf,
  type NewsletterStore, type NewsletterTx, type SubscriberQuery, type SubscriberRecord, type TokenRecord,
} from '../newsletter/store.ts';
import { connection, transaction } from './connection.ts';

interface SubscriberRow {
  id: number;
  email: string;
  normalized_email: string;
  status: string;
  source: string;
  locale: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  notice_sent_at: string | null;
}

interface TokenRow {
  id: number;
  subscriber_id: number;
  token_hash: string;
  token_type: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

const COLUMNS: Record<string, keyof SubscriberRow> = {
  email: 'email', status: 'status', source: 'source', locale: 'locale', updatedAt: 'updated_at', confirmedAt: 'confirmed_at',
  unsubscribedAt: 'unsubscribed_at', lastError: 'last_error', lastErrorAt: 'last_error_at', noticeSentAt: 'notice_sent_at',
};

function toSubscriber(row: SubscriberRow): SubscriberRecord {
  if (!isSubscriberStatus(row.status)) throw new Error(`unknown subscriber status in database: ${row.status}`);
  return {
    id: row.id, email: row.email, normalizedEmail: row.normalized_email, status: row.status, source: row.source, locale: row.locale,
    createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at, unsubscribedAt: row.unsubscribed_at,
    lastError: row.last_error, lastErrorAt: row.last_error_at, noticeSentAt: row.notice_sent_at,
  };
}

const toToken = (row: TokenRow): TokenRecord => ({
  id: row.id, subscriberId: row.subscriber_id, tokenHash: row.token_hash, tokenType: row.token_type as TokenRecord['tokenType'],
  expiresAt: row.expires_at, consumedAt: row.consumed_at, createdAt: row.created_at,
});

/** Escape LIKE wildcards so a search for `a_b` matches literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function where(query: Omit<SubscriberQuery, 'limit' | 'offset'>) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (query.status) { clauses.push('status = ?'); params.push(query.status); }
  const q = query.q?.trim().toLowerCase();
  if (q) { clauses.push("normalized_email LIKE ? ESCAPE '\\'"); params.push(likePattern(q)); }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const tx: NewsletterTx = {
  findSubscriberByEmail(normalizedEmail) {
    const row = connection().prepare('SELECT * FROM newsletter_subscribers WHERE normalized_email = ?').get(normalizedEmail) as SubscriberRow | undefined;
    return row ? toSubscriber(row) : undefined;
  },
  findSubscriber(id) {
    const row = connection().prepare('SELECT * FROM newsletter_subscribers WHERE id = ?').get(id) as SubscriberRow | undefined;
    return row ? toSubscriber(row) : undefined;
  },
  insertSubscriber(s) {
    try {
      const result = connection()
        .prepare(`INSERT INTO newsletter_subscribers(email, normalized_email, status, source, locale, created_at, updated_at, confirmed_at, unsubscribed_at, last_error, last_error_at, notice_sent_at)
                  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(s.email, s.normalizedEmail, s.status, s.source, s.locale, s.createdAt, s.updatedAt, s.confirmedAt, s.unsubscribedAt, s.lastError, s.lastErrorAt, s.noticeSentAt);
      return { ...s, id: Number(result.lastInsertRowid) };
    } catch (error) {
      if (/UNIQUE/i.test(String((error as Error)?.message))) throw new DuplicateSubscriberError();
      throw error;
    }
  },
  updateSubscriber(id, patch) {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key];
      if (!column) throw new Error(`cannot update ${key}`);
      sets.push(`${column} = ?`);
      params.push(value ?? null);
    }
    if (!sets.length) return;
    const result = connection().prepare(`UPDATE newsletter_subscribers SET ${sets.join(', ')} WHERE id = ?`).run(...(params as (string | null)[]), id);
    if (!result.changes) throw new Error(`no subscriber ${id}`);
  },
  insertToken(t) {
    const result = connection()
      .prepare('INSERT INTO newsletter_tokens(subscriber_id, token_hash, token_type, expires_at, consumed_at, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(t.subscriberId, t.tokenHash, t.tokenType, t.expiresAt, t.consumedAt, t.createdAt);
    return { ...t, id: Number(result.lastInsertRowid) };
  },
  findTokenByHash(tokenHash) {
    const row = connection().prepare('SELECT * FROM newsletter_tokens WHERE token_hash = ?').get(tokenHash) as TokenRow | undefined;
    return row ? toToken(row) : undefined;
  },
  recentTokens(subscriberId, type, since) {
    return (connection()
      .prepare('SELECT * FROM newsletter_tokens WHERE subscriber_id = ? AND token_type = ? AND created_at >= ? ORDER BY id')
      .all(subscriberId, type, since) as TokenRow[]).map(toToken);
  },
  consumeToken(id, at) {
    return connection().prepare('UPDATE newsletter_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(at, id).changes === 1;
  },
  retireTokens(subscriberId, type, at) {
    connection().prepare('UPDATE newsletter_tokens SET consumed_at = ? WHERE subscriber_id = ? AND token_type = ? AND consumed_at IS NULL').run(at, subscriberId, type);
  },
  purgeTokens(before) {
    connection().prepare('DELETE FROM newsletter_tokens WHERE (consumed_at IS NOT NULL AND consumed_at < ?) OR expires_at < ?').run(before, before);
  },
  hitRateLimit(key, limit, windowMs, nowMs) {
    const db = connection();
    db.prepare('DELETE FROM newsletter_rate_limits WHERE window_start < ?').run(nowMs - 24 * 60 * 60 * 1000);
    const row = db.prepare('SELECT window_start, count FROM newsletter_rate_limits WHERE key = ?').get(key) as { window_start: number; count: number } | undefined;
    if (!row || nowMs - row.window_start >= windowMs) {
      db.prepare('INSERT INTO newsletter_rate_limits(key, window_start, count) VALUES(?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1').run(key, nowMs);
      return limit > 0;
    }
    if (row.count >= limit) return false;
    db.prepare('UPDATE newsletter_rate_limits SET count = count + 1 WHERE key = ?').run(key);
    return true;
  },
  sendUsage(day) {
    const count = (period: string) =>
      Number((connection().prepare('SELECT count FROM newsletter_send_counts WHERE period = ?').get(period) as { count: number } | undefined)?.count ?? 0);
    return { daily: count(day), monthly: count(monthOf(day)) };
  },
  recordSend(day) {
    const db = connection();
    const add = db.prepare('INSERT INTO newsletter_send_counts(period, count) VALUES(?, 1) ON CONFLICT(period) DO UPDATE SET count = count + 1');
    add.run(day);
    add.run(monthOf(day));
    db.prepare('DELETE FROM newsletter_send_counts WHERE period < ?').run(keepSendCountsFrom(day));
  },
  raiseSendUsage(day, usage) {
    const raise = connection().prepare(
      'INSERT INTO newsletter_send_counts(period, count) VALUES(?, ?) ON CONFLICT(period) DO UPDATE SET count = max(count, excluded.count)',
    );
    for (const [period, value] of [[day, usage.daily], [monthOf(day), usage.monthly]] as const) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) raise.run(period, Math.floor(value));
    }
  },
  listSubscribers(query) {
    const { sql, params } = where(query);
    const db = connection();
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers ${sql}`).get(...params) as { n: number }).n);
    const rows = db
      .prepare(`SELECT * FROM newsletter_subscribers ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.offset) as SubscriberRow[];
    return { rows: rows.map(toSubscriber), total };
  },
  allSubscribers(query) {
    const { sql, params } = where(query);
    return (connection().prepare(`SELECT * FROM newsletter_subscribers ${sql} ORDER BY created_at DESC, id DESC`).all(...params) as SubscriberRow[]).map(toSubscriber);
  },
  counts() {
    const counts: NewsletterCounts = { total: 0, active: 0, pending: 0, unsubscribed: 0 };
    for (const row of connection().prepare('SELECT status, COUNT(*) AS n FROM newsletter_subscribers GROUP BY status').all() as { status: string; n: number }[]) {
      counts.total += Number(row.n);
      if (row.status === 'active' || row.status === 'pending' || row.status === 'unsubscribed') counts[row.status] = Number(row.n);
    }
    return counts;
  },
};

export const sqliteNewsletterStore: NewsletterStore = {
  kind: 'sqlite',
  async transact(fn) {
    return transaction(() => fn(tx));
  },
};
