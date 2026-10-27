// End-to-end contract tests for the JSON API handlers, against an in-memory
// SQLite database. Handlers are invoked exactly as Astro invokes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const uploads = mkdtempSync(path.join(tmpdir(), 'rra-api-'));
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = uploads;
process.env.ADMIN_TOKEN = 'test-admin-token';
delete process.env.NOTION_TOKEN;

const posts = await import('../src/server/http/endpoints/posts.ts');
const pub = await import('../src/server/http/endpoints/public.ts');
const admin = await import('../src/server/http/endpoints/admin.ts');
const files = await import('../src/server/http/endpoints/uploads.ts');
const { resetAuthThrottle } = await import('../src/server/services/auth.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');

test.after(() => {
  closeConnection();
  rmSync(uploads, { recursive: true, force: true });
});
test.beforeEach(() => resetAuthThrottle());

const TOKEN = 'test-admin-token';

/** Invoke a handler the way Astro does. */
async function call(handler, { method = 'GET', path: p = '/', params = {}, json, body, headers = {}, token } = {}) {
  const url = new URL(p, 'http://archive.test');
  const h = new Headers(headers);
  if (token) h.set('authorization', `Bearer ${token}`);
  if (json !== undefined) h.set('content-type', 'application/json');
  const request = new Request(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, duplex: 'half' });
  const response = await handler({ request, url, params });
  const text = response.status === 204 ? '' : await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { status: response.status, headers: response.headers, data };
}

test('writes require the admin token; errors follow the contract', async () => {
  const anonymous = await call(posts.create, { method: 'POST', json: { title: 'x', body: 'y' } });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.data.code, 'unauthorized');

  const wrong = await call(posts.create, { method: 'POST', json: { title: 'x', body: 'y' }, token: 'nope' });
  assert.equal(wrong.status, 401);
});

test('post lifecycle: create → read → patch (rename) → delete', async () => {
  const created = await call(posts.create, {
    method: 'POST', token: TOKEN,
    json: { title: 'First Light', body: 'Line one\nline two', tags: ['notes', 'light'], published: true },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.slug, 'first-light');
  assert.equal(created.data.href, '/journal/first-light');
  assert.deepEqual(created.data.tags, ['notes', 'light']);
  assert.equal(created.headers.get('location'), '/journal/first-light');

  const dup = await call(posts.create, { method: 'POST', token: TOKEN, json: { title: 'First Light', body: 'again' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.code, 'conflict');
  assert.deepEqual(dup.data.details, { slug: 'first-light' });

  const read = await call(posts.read, { path: '/api/posts/first-light?format=html', params: { slug: 'first-light' } });
  assert.equal(read.status, 200);
  assert.equal(read.data.markdown, 'Line one\nline two');
  assert.match(read.data.html, /<br>/);

  const patched = await call(posts.update, { method: 'PATCH', token: TOKEN, params: { slug: 'first-light' }, json: { slug: 'dawn', title: 'Dawn' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.slug, 'dawn');
  assert.equal(patched.data.title, 'Dawn');
  assert.equal(patched.data.markdown, 'Line one\nline two', 'untouched fields survive a partial update');

  const gone = await call(posts.read, { params: { slug: 'first-light' } });
  assert.equal(gone.status, 404);
  assert.equal(gone.data.code, 'not_found');

  const removed = await call(posts.remove, { method: 'DELETE', token: TOKEN, params: { slug: 'dawn' } });
  assert.equal(removed.status, 204);
  const again = await call(posts.remove, { method: 'DELETE', token: TOKEN, params: { slug: 'dawn' } });
  assert.equal(again.status, 404);
});

test('drafts are invisible to the public and 401 when requested anonymously', async () => {
  await call(posts.create, { method: 'POST', token: TOKEN, json: { title: 'Secret Draft', body: 'wip', published: false } });

  const publicList = await call(posts.list);
  assert.ok(!publicList.data.posts.some((p) => p.slug === 'secret-draft'));
  assert.equal(publicList.data.draftsIncluded, false);

  const sneaky = await call(posts.list, { path: '/api/posts?drafts=1' });
  assert.equal(sneaky.status, 401);

  const adminList = await call(posts.list, { path: '/api/posts?drafts=1', token: TOKEN });
  assert.ok(adminList.data.posts.some((p) => p.slug === 'secret-draft' && p.published === false));
  assert.equal(adminList.headers.get('cache-control'), 'no-store');

  assert.equal((await call(posts.read, { params: { slug: 'secret-draft' } })).status, 404);
  assert.equal((await call(posts.read, { params: { slug: 'secret-draft' }, token: TOKEN })).status, 200);
});

test('tag filter narrows both the list and the total', async () => {
  await call(posts.create, { method: 'POST', token: TOKEN, json: { title: 'Tagged A', body: 'a', tags: 'sound' } });
  await call(posts.create, { method: 'POST', token: TOKEN, json: { title: 'Tagged B', body: 'b', tags: 'sound, film' } });
  await call(posts.create, { method: 'POST', token: TOKEN, json: { title: 'Untagged', body: 'c' } });
  const sound = await call(posts.list, { path: '/api/posts?tag=sound' });
  assert.equal(sound.data.total, 2);
  assert.deepEqual(sound.data.posts.map((p) => p.slug).sort(), ['tagged-a', 'tagged-b']);
});

test('search finds published posts only and escapes LIKE wildcards', async () => {
  const hit = await call(pub.searchAll, { path: '/api/search?q=Tagged' });
  assert.equal(hit.status, 200);
  assert.ok(hit.data.posts.length >= 2);
  assert.equal(hit.data.total, hit.data.posts.length + hit.data.items.length);

  const wildcard = await call(pub.searchAll, { path: '/api/search?q=%25' });
  assert.equal(wildcard.data.total, 0, '% is matched literally, not as a wildcard');

  const draft = await call(pub.searchAll, { path: '/api/search?q=Secret' });
  assert.equal(draft.data.posts.length, 0);

  const empty = await call(pub.searchAll, { path: '/api/search' });
  assert.deepEqual(empty.data, { query: '', total: 0, posts: [], items: [] });
});

test('public collection endpoints validate the kind', async () => {
  const bad = await call(pub.listCollection, { params: { kind: 'poems' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'bad_request');

  const ok = await call(pub.listCollection, { params: { kind: 'music' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.data).sort(), ['items', 'kind', 'limit', 'offset', 'total']);

  const archive = await call(pub.archive);
  assert.deepEqual(Object.keys(archive.data.items).sort(), ['films', 'music', 'writing']);
});

test('refreshing an entry body is admin-only', async () => {
  const response = await call(pub.getEntry, { path: '/api/items/writing/x?refresh=1', params: { kind: 'writing', slug: 'x' } });
  assert.equal(response.status, 401);
});

test('settings: masked token is never echoed, empty string clears overrides', async () => {
  const before = await call(admin.readSettings, { token: TOKEN });
  assert.equal(before.status, 200);
  assert.equal(before.data.values.hasToken, false);

  const saved = await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_name: 'Velvet', NOTION_TOKEN: 'secret_abcdef1234' } });
  assert.equal(saved.data.values.site_name, 'Velvet');
  assert.equal(saved.data.values.NOTION_TOKEN, '••••1234');
  assert.equal(saved.data.values.hasToken, true);
  assert.doesNotMatch(JSON.stringify(saved.data), /secret_abcdef/);

  const site = await call(pub.site);
  assert.equal(site.data.name, 'Velvet');

  const kept = await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { NOTION_TOKEN: '••••1234', site_name: '' } });
  assert.equal(kept.data.values.hasToken, true, 'masked token keeps the stored one');
  assert.equal(kept.data.values.site_name, 'Red Room Archive', 'empty string falls back to the default');
});

test('sync rejects unknown kinds and reports when Notion is not ready', async () => {
  const unknown = await call(admin.runSync, { method: 'POST', path: '/api/sync?kind=poems', token: TOKEN });
  assert.equal(unknown.status, 400);
  const status = await call(admin.readSync, { token: TOKEN });
  assert.equal(status.status, 200);
  assert.ok('syncedAt' in status.data.status);
});

test('login: wrong tokens are throttled, missing tokens on other endpoints are not', async () => {
  for (let i = 0; i < 12; i++) {
    const r = await call(admin.login, { method: 'POST', json: { token: 'wrong' }, headers: { 'x-forwarded-for': '10.0.0.9' } });
    assert.equal(r.status, 401);
  }
  const locked = await call(admin.login, { method: 'POST', json: { token: TOKEN }, headers: { 'x-forwarded-for': '10.0.0.9' } });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.code, 'rate_limited');

  // An anonymous visitor hammering a protected endpoint without any token
  // must not lock the owner out.
  for (let i = 0; i < 20; i++) await call(admin.readSettings, { headers: { 'x-forwarded-for': '10.0.0.10' } });
  const owner = await call(admin.login, { method: 'POST', json: { token: TOKEN }, headers: { 'x-forwarded-for': '10.0.0.10' } });
  assert.equal(owner.status, 200);
});

test('uploads: raw + multipart (with as=model as a form field), list, rename, delete', async () => {
  const raw = await call(files.upload, {
    method: 'POST', token: TOKEN, path: '/api/uploads?name=Field%20Recording.mp3',
    body: new Blob(['abc']).stream(), headers: { 'content-type': 'audio/mpeg' },
  });
  assert.equal(raw.status, 201);
  assert.equal(raw.data.name, 'field-recording.mp3');

  const form = new FormData();
  form.append('file', new File(['glb'], 'statue.glb'));
  form.append('as', 'model');
  const url = new URL('http://archive.test/api/uploads');
  const request = new Request(url, { method: 'POST', body: form, headers: { authorization: `Bearer ${TOKEN}` } });
  const model = await files.upload({ request, url, params: {} });
  assert.equal(model.status, 201);
  assert.equal((await model.json()).name, 'venus.glb', 'the multipart `as` field is honoured');

  const list = await call(files.list, { token: TOKEN });
  assert.equal(list.data.usage.count, 2);

  const renamed = await call(files.rename, { method: 'PATCH', token: TOKEN, params: { name: 'field-recording.mp3' }, json: { name: 'take-two.mp3' } });
  assert.equal(renamed.data.name, 'take-two.mp3');

  assert.equal((await call(files.remove, { method: 'DELETE', token: TOKEN, params: { name: 'take-two.mp3' } })).status, 204);
  assert.equal((await call(files.info, { token: TOKEN, params: { name: 'take-two.mp3' } })).status, 404);
  assert.equal((await call(files.info, { token: TOKEN, params: { name: '../etc/passwd' } })).status, 400);
});

test('health reports database status without secrets', async () => {
  const health = await call(pub.health);
  assert.equal(health.status, 200);
  assert.equal(health.data.database, true);
  assert.equal(health.headers.get('cache-control'), 'no-store');
});
