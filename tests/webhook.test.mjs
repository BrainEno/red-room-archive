// Notion webhooks: verification handshake, signatures, state, dedupe and the
// sync they trigger — through the real endpoints, against the Notion mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB, createNotionMock } from './fixtures/notion-mock.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-webhook-'));
process.env.DB_PATH = ':memory:';
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.NOTION_TOKEN = 'secret_env_token';
process.env.NOTION_DATABASE_ID = DB;
process.env.NOTION_API_BASE = API;
process.env.SITE_URL = 'https://archive.example';
delete process.env.NOTION_WEBHOOK_TOKEN;
const mock = createNotionMock();
const realFetch = globalThis.fetch;
globalThis.fetch = mock.fetch;

const hooks = await import('../src/server/http/endpoints/webhooks.ts');
const { flushWebhookSync, validSignature } = await import('../src/server/services/webhook.ts');
const { overview } = await import('../src/server/services/overview.ts');
const { resetAuthThrottle } = await import('../src/server/services/auth.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');
test.after(() => {
  globalThis.fetch = realFetch;
  closeConnection();
  rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(() => resetAuthThrottle());

const TOKEN = 'secret_' + 'a1B2c3D4e5'.repeat(4);
const sign = (body, key = TOKEN) => `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

async function call(handler, { method = 'POST', body, signature, admin = false } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature) headers.set('x-notion-signature', signature);
  if (admin) headers.set('authorization', 'Bearer test-admin-token');
  const url = new URL('/api/webhooks/notion', 'https://archive.example');
  const request = new Request(url, { method, headers, body, duplex: 'half' });
  const response = await handler({ request, url, params: {}, clientAddress: '203.0.113.9' });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
const event = (id, type, extra = {}) =>
  JSON.stringify({ id, type, timestamp: '2026-10-30T00:00:00.000Z', workspace_id: 'w', subscription_id: 's', integration_id: 'i', attempt_number: 1, entity: { id: 'p', type: 'page' }, ...extra });
const status = async () => (await call(hooks.readWebhook, { method: 'GET', admin: true })).data.webhook;
const syncCalls = () => mock.state.calls.filter((c) => c.url.includes(`/databases/${DB}/query`)).length;

test('signatures are HMAC-SHA256 of the raw body, compared exactly', () => {
  const body = Buffer.from('{"a":1}');
  assert.ok(validSignature(body, sign(body), TOKEN));
  assert.ok(validSignature(body, sign(body).toUpperCase().replace('SHA256=', 'sha256='), TOKEN), 'hex case does not matter');
  assert.equal(validSignature(Buffer.from('{"a":2}'), sign(body), TOKEN), false);
  assert.equal(validSignature(body, sign(body, 'other'), TOKEN), false);
  for (const header of [null, '', 'sha256=', 'sha1=abc', sign(body).slice(0, -2), `${sign(body)}00`]) assert.equal(validSignature(body, header, TOKEN), false, String(header));
});

test('status and reset are admin-only; events before the handshake are refused', async () => {
  assert.equal((await call(hooks.readWebhook, { method: 'GET' })).status, 401);
  assert.equal((await call(hooks.clearWebhook, { method: 'DELETE' })).status, 401);
  const initial = await status();
  assert.equal(initial.state, 'off');
  assert.equal(initial.url, 'https://archive.example/api/webhooks/notion');

  const body = event('e0', 'page.content_updated');
  assert.equal((await call(hooks.notionWebhook, { body, signature: sign(body) })).status, 401);
  assert.equal((await status()).rejected, 1);
  assert.equal((await call(hooks.notionWebhook, { body: 'not json' })).status, 400);
  assert.equal((await call(hooks.notionWebhook, { body: JSON.stringify({ verification_token: 'short' }) })).status, 400);
  assert.equal((await call(hooks.notionWebhook, { body: 'x'.repeat(70 * 1024) })).status, 413);
});

test('handshake → pending, first signed event → active, then the token is locked', async () => {
  const handshake = await call(hooks.notionWebhook, { body: JSON.stringify({ verification_token: TOKEN }) });
  assert.equal(handshake.status, 200);
  assert.equal(handshake.data.outcome, 'verification');
  assert.equal(handshake.headers.get('cache-control'), 'no-store');
  let current = await status();
  assert.equal(current.state, 'pending');
  assert.equal(current.token, TOKEN, 'shown in full while the owner still has to paste it into Notion');
  assert.ok((await overview()).checks.some((check) => check.code === 'webhook-pending'));

  // A second handshake while pending replaces the token (Notion's “resend token”).
  const replaced = TOKEN.replace('a1', 'z9');
  await call(hooks.notionWebhook, { body: JSON.stringify({ verification_token: replaced }) });
  assert.equal((await status()).token, replaced);
  await call(hooks.notionWebhook, { body: JSON.stringify({ verification_token: TOKEN }) });

  const forged = event('e1', 'page.content_updated');
  assert.equal((await call(hooks.notionWebhook, { body: forged, signature: sign(forged, 'guess') })).status, 401);
  assert.equal((await status()).state, 'pending');

  const before = syncCalls();
  const body = event('e1', 'page.content_updated');
  const accepted = await call(hooks.notionWebhook, { body, signature: sign(body) });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.outcome, 'synced');
  current = await status();
  assert.equal(current.state, 'active');
  assert.equal(current.token, `••••${TOKEN.slice(-4)}`, 'masked once verified');
  assert.equal(current.events, 1);
  assert.equal(current.lastType, 'page.content_updated');
  assert.equal(current.rejected, 2);
  assert.ok(!(await overview()).checks.some((check) => check.code === 'webhook-pending'));

  // The sync is debounced (Notion batches edits) and then reads the database like any sync.
  assert.equal(syncCalls(), before, 'nothing synced synchronously; the response is immediate');
  await flushWebhookSync();
  assert.ok(syncCalls() > before, 'a database query ran');

  // Retries of the same delivery are acknowledged without a second sync.
  const again = await call(hooks.notionWebhook, { body, signature: sign(body) });
  assert.equal(again.data.outcome, 'duplicate');

  const comment = event('e2', 'comment.created');
  assert.equal((await call(hooks.notionWebhook, { body: comment, signature: sign(comment) })).data.outcome, 'ignored');

  const takeover = await call(hooks.notionWebhook, { body: JSON.stringify({ verification_token: TOKEN.replace('a1', 'x0') }) });
  assert.equal(takeover.status, 409, 'a verified subscription cannot be replaced from outside');
});

test('reset forgets the token; NOTION_WEBHOOK_TOKEN pins it and skips the handshake', async () => {
  const reset = await call(hooks.clearWebhook, { method: 'DELETE', admin: true });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.webhook.state, 'off');
  assert.equal(reset.data.webhook.events, 0);

  process.env.NOTION_WEBHOOK_TOKEN = TOKEN;
  try {
    const pinned = await status();
    assert.equal(pinned.state, 'active');
    assert.equal(pinned.fromEnv, true);
    assert.equal(pinned.token, null, 'an environment secret is never echoed');
    assert.equal((await call(hooks.notionWebhook, { body: JSON.stringify({ verification_token: TOKEN }) })).status, 409);
    const body = event('e3', 'page.properties_updated');
    assert.equal((await call(hooks.notionWebhook, { body, signature: sign(body) })).data.outcome, 'synced');
    await flushWebhookSync();
  } finally {
    delete process.env.NOTION_WEBHOOK_TOKEN;
  }
});
