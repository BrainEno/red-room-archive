/**
 * Notion connection webhooks → a prompt sync, instead of waiting for the next
 * visit after the cache expires.
 *
 * Handshake: when a subscription is created, Notion POSTs
 * `{ verification_token }` once. It is stored (state `pending`) and shown in
 * /admin → Settings → Notion so the owner can paste it back into Notion.
 * Every later event carries `X-Notion-Signature: sha256=<HMAC of the raw
 * body, keyed with that token>`; anything unsigned or mis-signed is refused.
 * The first correctly signed event moves the state to `active`; from then on
 * new verification tokens are refused until the owner resets the webhook in
 * /admin (so a stranger cannot replace the token later). Setting
 * NOTION_WEBHOOK_TOKEN pins the token and skips the handshake.
 *
 * Events are only signals: nothing in them is published. Each accepted event
 * schedules one debounced sync, which asks Notion for the current state
 * (Published, Date, last edit) like any other sync. Comment events are ignored.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from '../../core/env.ts';
import { badRequest, conflict, unauthorized } from '../../core/errors.ts';
import type { WebhookStatus } from '../../shared/contracts.ts';
import { config } from '../config.ts';
import { metaRepository } from '../db/meta.repository.ts';
import { syncArticles } from './articles.ts';
import { notionReady } from './settings.ts';

export const WEBHOOK_PATH = '/api/webhooks/notion';

const KEYS = {
  token: 'webhook.token',
  tokenAt: 'webhook.token_at',
  active: 'webhook.active',
  events: 'webhook.events',
  lastEventAt: 'webhook.last_event_at',
  lastType: 'webhook.last_type',
  rejected: 'webhook.rejected',
  lastRejectedAt: 'webhook.last_rejected_at',
} as const;

/** Delay between the last event and the sync it triggers (Notion already batches edits). */
const DEBOUNCE_MS = 4000;
const SEEN_LIMIT = 500;

const envToken = () => readEnv('NOTION_WEBHOOK_TOKEN')?.trim() || '';
const storedToken = () => metaRepository.get(KEYS.token) ?? '';
const count = (key: string) => Number(metaRepository.get(key) ?? 0) || 0;

export function webhookStatus(): WebhookStatus {
  const fromEnv = Boolean(envToken());
  const token = envToken() || storedToken();
  const state = !token ? 'off' : fromEnv || metaRepository.get(KEYS.active) === '1' ? 'active' : 'pending';
  const site = config.siteUrl();
  return {
    url: site ? `${site}${WEBHOOK_PATH}` : '',
    path: WEBHOOK_PATH,
    state,
    fromEnv,
    // The owner has to paste it into Notion while pending; afterwards only its tail is shown.
    token: fromEnv ? null : state === 'pending' ? token : token ? `••••${token.slice(-4)}` : null,
    tokenAt: metaRepository.get(KEYS.tokenAt) ?? null,
    events: count(KEYS.events),
    lastEventAt: metaRepository.get(KEYS.lastEventAt) ?? null,
    lastType: metaRepository.get(KEYS.lastType) ?? null,
    rejected: count(KEYS.rejected),
    lastRejectedAt: metaRepository.get(KEYS.lastRejectedAt) ?? null,
  };
}

/** Forget the stored token and counters (admin). Notion will need a new subscription or “Resend token”. */
export function resetWebhook(): WebhookStatus {
  for (const key of Object.values(KEYS)) metaRepository.remove(key);
  seen.clear();
  return webhookStatus();
}

/** Constant-time check of `sha256=<hex>` against the raw body. */
export function validSignature(raw: Uint8Array, header: string | null, secret: string): boolean {
  const hex = /^sha256=([0-9a-f]{64})$/i.exec(String(header ?? '').trim())?.[1];
  if (!hex || !secret) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(hex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* ── sync scheduling ───────────────────────────────────────────────── */

const seen = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

function scheduleSync() {
  if (running) {
    again = true; // an edit arrived mid-sync: run once more afterwards
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(runSync, DEBOUNCE_MS);
  timer.unref?.();
}

async function runSync() {
  timer = undefined;
  if (!notionReady()) return;
  running = true;
  again = false;
  try {
    await syncArticles();
  } catch (error) {
    console.error('[webhook] sync failed:', error instanceof Error ? error.message : error);
  } finally {
    running = false;
    if (again) scheduleSync();
  }
}

/** Tests: run a pending debounced sync now. */
export async function flushWebhookSync() {
  if (!timer) return;
  clearTimeout(timer);
  await runSync();
}

/* ── receiving ─────────────────────────────────────────────────────── */

export type WebhookOutcome = 'verification' | 'synced' | 'ignored' | 'duplicate';

function reject(message: string): never {
  metaRepository.set(KEYS.rejected, String(count(KEYS.rejected) + 1));
  metaRepository.set(KEYS.lastRejectedAt, new Date().toISOString());
  throw unauthorized(message);
}

/** Handle one POST from Notion (raw body, `X-Notion-Signature` header). */
export function receiveWebhook(raw: Uint8Array, signature: string | null): WebhookOutcome {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    payload = parsed;
  } catch {
    throw badRequest('invalid JSON body');
  }

  // 1. Handshake: `{ verification_token }` without an event type.
  if (typeof payload.verification_token === 'string' && payload.type === undefined) {
    const token = payload.verification_token.trim();
    if (!/^[\x21-\x7e]{16,200}$/.test(token)) throw badRequest('invalid verification_token');
    const status = webhookStatus();
    if (status.fromEnv) throw conflict('NOTION_WEBHOOK_TOKEN is set on the server; the handshake is not needed');
    if (status.state === 'active') throw conflict('webhook already verified; reset it in /admin before subscribing again');
    metaRepository.set(KEYS.token, token);
    metaRepository.set(KEYS.tokenAt, new Date().toISOString());
    return 'verification';
  }

  // 2. Events: must be signed with the stored token.
  const secret = envToken() || storedToken();
  if (!secret) reject('webhook not set up: no verification token received yet');
  if (!validSignature(raw, signature, secret)) reject('invalid X-Notion-Signature');
  if (!envToken() && metaRepository.get(KEYS.active) !== '1') metaRepository.set(KEYS.active, '1');

  const id = typeof payload.id === 'string' ? payload.id : '';
  if (id && seen.has(id)) return 'duplicate'; // Notion retries deliveries
  if (id) {
    seen.add(id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value!);
  }

  const type = typeof payload.type === 'string' ? payload.type.slice(0, 64) : 'unknown';
  metaRepository.set(KEYS.events, String(count(KEYS.events) + 1));
  metaRepository.set(KEYS.lastEventAt, new Date().toISOString());
  metaRepository.set(KEYS.lastType, type);

  if (!/^(page|database|data_source)\./.test(type)) return 'ignored'; // comments etc. never change what is published
  scheduleSync();
  return 'synced';
}
