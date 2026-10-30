/**
 * NewsletterStore over a single JSON document with optimistic concurrency.
 *
 * Used where there is no database: on the static Netlify deployment the
 * document lives in Netlify Blobs (see `blobsBackend`). A transaction loads
 * the document and its ETag, runs the synchronous mutation on a private
 * copy, and writes back only if the ETag is unchanged (`onlyIfMatch`, or
 * `onlyIfNew` for the first write). A lost race re-runs the transaction on
 * fresh data, so two concurrent sign-ups can never overwrite each other and
 * the uniqueness check always sees the committed state.
 *
 * Scale: the whole list is read per request. That is fine for the few
 * thousand readers a literary newsletter has (≈250 bytes per subscriber);
 * beyond ~20,000, move to the Node server (SQLite) — see docs/NEWSLETTER.md.
 */
import { unavailable } from '../../core/errors.ts';
import type { NewsletterCounts } from '../../shared/contracts.ts';
import {
  DuplicateSubscriberError, matchesQuery,
  type NewsletterStore, type NewsletterTx, type SubscriberRecord, type TokenRecord,
} from './store.ts';

export interface DocumentBackend {
  load(): Promise<{ text: string; etag: string } | null>;
  /** Write `text` if the stored ETag is still `etag` (`null`: only if absent). False on conflict. */
  save(text: string, etag: string | null): Promise<boolean>;
}

export interface DocumentCodec {
  encode(plaintext: string): string;
  decode(stored: string): string;
}

interface RateBucket {
  start: number;
  count: number;
}

interface NewsletterDocument {
  format: 'red-room-newsletter-state';
  version: 1;
  nextSubscriberId: number;
  nextTokenId: number;
  subscribers: SubscriberRecord[];
  tokens: TokenRecord[];
  /** Emails sent per UTC day (`YYYY-MM-DD`), last 8 days. */
  sends: Record<string, number>;
  /** Rate-limit windows by hashed client key. */
  limits: Record<string, RateBucket>;
}

const emptyDocument = (): NewsletterDocument => ({
  format: 'red-room-newsletter-state', version: 1, nextSubscriberId: 1, nextTokenId: 1, subscribers: [], tokens: [], sends: {}, limits: {},
});

const MAX_ATTEMPTS = 6;
const LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

function parseDocument(text: string): NewsletterDocument {
  const doc = JSON.parse(text) as NewsletterDocument;
  if (doc?.format !== 'red-room-newsletter-state' || doc.version !== 1 || !Array.isArray(doc.subscribers) || !Array.isArray(doc.tokens)) {
    throw new Error('unrecognised newsletter document');
  }
  doc.sends ??= {};
  doc.limits ??= {};
  return doc;
}

/** The transaction view of one in-memory document. Tracks whether anything changed. */
function documentTx(doc: NewsletterDocument) {
  let dirty = false;
  const touch = () => { dirty = true; };
  const byId = (id: number) => doc.subscribers.find((row) => row.id === id);
  const sorted = (rows: SubscriberRecord[]) => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

  const tx: NewsletterTx = {
    findSubscriberByEmail: (normalizedEmail) => {
      const row = doc.subscribers.find((candidate) => candidate.normalizedEmail === normalizedEmail);
      return row ? { ...row } : undefined;
    },
    findSubscriber: (id) => {
      const row = byId(id);
      return row ? { ...row } : undefined;
    },
    insertSubscriber: (subscriber) => {
      if (doc.subscribers.some((row) => row.normalizedEmail === subscriber.normalizedEmail)) throw new DuplicateSubscriberError();
      const row: SubscriberRecord = { ...subscriber, id: doc.nextSubscriberId++ };
      doc.subscribers.push(row);
      touch();
      return { ...row };
    },
    updateSubscriber: (id, patch) => {
      const row = byId(id);
      if (!row) throw new Error(`no subscriber ${id}`);
      Object.assign(row, patch);
      touch();
    },
    insertToken: (token) => {
      if (doc.tokens.some((row) => row.tokenHash === token.tokenHash)) throw new Error('token hash collision');
      const row: TokenRecord = { ...token, id: doc.nextTokenId++ };
      doc.tokens.push(row);
      touch();
      return { ...row };
    },
    findTokenByHash: (tokenHash) => {
      const row = doc.tokens.find((candidate) => candidate.tokenHash === tokenHash);
      return row ? { ...row } : undefined;
    },
    recentTokens: (subscriberId, type, since) =>
      doc.tokens.filter((row) => row.subscriberId === subscriberId && row.tokenType === type && row.createdAt >= since).map((row) => ({ ...row })),
    consumeToken: (id, at) => {
      const row = doc.tokens.find((candidate) => candidate.id === id);
      if (!row || row.consumedAt) return false;
      row.consumedAt = at;
      touch();
      return true;
    },
    retireTokens: (subscriberId, type, at) => {
      for (const row of doc.tokens) {
        if (row.subscriberId === subscriberId && row.tokenType === type && !row.consumedAt) {
          row.consumedAt = at;
          touch();
        }
      }
    },
    purgeTokens: (before) => {
      const kept = doc.tokens.filter((row) => !((row.consumedAt && row.consumedAt < before) || row.expiresAt < before));
      if (kept.length !== doc.tokens.length) {
        doc.tokens = kept;
        touch();
      }
    },
    hitRateLimit: (key, limit, windowMs, nowMs) => {
      for (const [name, bucket] of Object.entries(doc.limits)) {
        if (nowMs - bucket.start > LIMIT_RETENTION_MS) {
          delete doc.limits[name];
          touch();
        }
      }
      let bucket = doc.limits[key];
      if (!bucket || nowMs - bucket.start >= windowMs) bucket = doc.limits[key] = { start: nowMs, count: 0 };
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      touch();
      return true;
    },
    reserveSend: (day, limit) => {
      const used = doc.sends[day] ?? 0;
      if (used >= limit) return false;
      doc.sends[day] = used + 1;
      for (const old of Object.keys(doc.sends).sort().slice(0, -8)) delete doc.sends[old];
      touch();
      return true;
    },
    releaseSend: (day) => {
      if ((doc.sends[day] ?? 0) > 0) {
        doc.sends[day]! -= 1;
        touch();
      }
    },
    sentOn: (day) => doc.sends[day] ?? 0,
    listSubscribers: (query) => {
      const rows = sorted(doc.subscribers.filter((row) => matchesQuery(row, query)));
      return { rows: rows.slice(query.offset, query.offset + query.limit).map((row) => ({ ...row })), total: rows.length };
    },
    allSubscribers: (query) => sorted(doc.subscribers.filter((row) => matchesQuery(row, query))).map((row) => ({ ...row })),
    counts: () => {
      const counts: NewsletterCounts = { total: doc.subscribers.length, active: 0, pending: 0, unsubscribed: 0 };
      for (const row of doc.subscribers) if (row.status in counts) counts[row.status as keyof Omit<NewsletterCounts, 'total'>] += 1;
      return counts;
    },
  };
  return { tx, isDirty: () => dirty };
}

export function createDocumentStore(backend: DocumentBackend, codec: DocumentCodec, kind: NewsletterStore['kind'] = 'netlify-blobs'): NewsletterStore {
  return {
    kind,
    async transact<T>(fn: (tx: NewsletterTx) => T): Promise<T> {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const current = await backend.load();
        // A document that exists but cannot be read is never replaced by an empty one.
        const doc = current ? parseDocument(codec.decode(current.text)) : emptyDocument();
        const { tx, isDirty } = documentTx(doc);
        const result = fn(tx);
        if (!isDirty()) return result;
        if (await backend.save(codec.encode(JSON.stringify(doc)), current?.etag ?? null)) return result;
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1) + Math.random() * 25));
      }
      throw unavailable('the subscriber store is busy, please try again');
    },
  };
}

/** The subset of `@netlify/blobs` Store used here (kept structural so src/ has no Netlify dependency). */
export interface BlobStoreLike {
  getWithMetadata(key: string, options: { type: 'text'; consistency?: 'strong' | 'eventual' }): Promise<{ data: string; etag?: string } | null>;
  set(key: string, value: string, options: { onlyIfMatch: string } | { onlyIfNew: boolean }): Promise<{ modified: boolean } | void>;
}

/** Netlify Blobs: strongly consistent reads, conditional writes on the ETag. */
export function blobsBackend(store: BlobStoreLike, key: string): DocumentBackend {
  return {
    async load() {
      const entry = await store.getWithMetadata(key, { type: 'text', consistency: 'strong' });
      if (!entry) return null;
      if (!entry.etag) throw new Error('Netlify Blobs returned no ETag; conditional writes are unavailable');
      return { text: entry.data, etag: entry.etag };
    },
    async save(text, etag) {
      const result = await store.set(key, text, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      if (!result || typeof result.modified !== 'boolean') throw new Error('@netlify/blobs did not report a conditional write result');
      return result.modified;
    },
  };
}

/** In-process backend with real ETag semantics (tests, local experiments). */
export function memoryBackend(): DocumentBackend & { text(): string | null; writes: number } {
  let text: string | null = null;
  let version = 0;
  const backend = {
    writes: 0,
    text: () => text,
    async load() {
      return text === null ? null : { text, etag: `"${version}"` };
    },
    async save(next: string, etag: string | null) {
      if ((etag === null && text !== null) || (etag !== null && etag !== `"${version}"`)) return false;
      text = next;
      version += 1;
      backend.writes += 1;
      return true;
    },
  };
  return backend;
}
