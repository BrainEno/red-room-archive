import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_TOKEN = 'analytics-test-admin';
process.env.SITE_URL = 'https://archive.example';

const core = await import('../src/core/analytics.ts');
const { createAnalyticsDocumentStore } = await import('../src/server/analytics/document-store.ts');
const { memoryBackend } = await import('../src/server/newsletter/document-store.ts');
const { sqliteAnalyticsStore } = await import('../src/server/db/analytics.repository.ts');
const { connection, closeConnection } = await import('../src/server/db/connection.ts');
const { handleAnalyticsRequest } = await import('../src/server/analytics/http.ts');
const { netlifyAnalyticsStore, analyticsDocumentKey } = await import('../src/server/analytics/netlify.ts');
const { unauthorized } = await import('../src/core/errors.ts');

const TODAY = '2026-10-31';
const now = () => new Date(`${TODAY}T12:00:00.000Z`);
const view = (path = '/articles/light', referrer = '') => ({ ...core.analyticsPath(path), referrer: core.analyticsReferrer(referrer) });
test.after(() => closeConnection());
test.beforeEach(async () => {
  await sqliteAnalyticsStore.clear();
  await sqliteAnalyticsStore.setEnabled(true);
});

test('only canonical public paths and host-only referrers are accepted', () => {
  assert.deepEqual(core.analyticsPath('/'), { path: '/', locale: 'en' });
  assert.deepEqual(core.analyticsPath('/zh-CN/'), { path: '/zh-CN', locale: 'zh-CN' });
  assert.deepEqual(core.analyticsPath('/zh-CN/articles/light/'), { path: '/zh-CN/articles/light', locale: 'zh-CN' });
  assert.deepEqual(core.analyticsPath('/articles/page/2'), { path: '/articles/page/2', locale: 'en' });
  assert.deepEqual(core.analyticsPath('/topics/%E5%B0%8F%E8%AF%B4/page/3'), { path: '/topics/%E5%B0%8F%E8%AF%B4/page/3', locale: 'en' });
  for (const path of ['/admin', '/admin/x', '/api/analytics/collect', '/newsletter/confirm', '/zh-CN/newsletter/confirm', '/offline', '/404', '/robots.txt',
    '/articles/a/b', '/topics/a/b', '/articles/page/0', '/topics/a/page/9999999', '/search?q=secret', '/articles/%2Fadmin', '/articles/%2E%2E',
    '//evil.example/x', 'https://archive.example/articles', '/articles\\admin', '/articles#secret', `/${'x'.repeat(241)}`]) {
    assert.equal(core.analyticsPath(path), null, path);
  }
  assert.equal(core.analyticsReferrer(''), '(direct)');
  assert.equal(core.analyticsReferrer('(internal)'), '(internal)');
  assert.equal(core.analyticsReferrer('News.Example.'), 'news.example');
  assert.equal(core.analyticsReferrer('xn--bcher-kva.example'), 'xn--bcher-kva.example');
  for (const value of ['https://news.example/private?token=1', 'news.example/path', 'user@example.com', 'javascript:alert(1)', 'a..example', '-bad.example']) {
    assert.equal(core.analyticsReferrer(value), null, value);
  }
  assert.deepEqual(core.pageviewFrom({ path: '/zh-CN/more', referrer: 'news.example', query: 'do-not-store' }), { path: '/zh-CN/more', locale: 'zh-CN', referrer: 'news.example' });
});

test('summary fills UTC days and aggregates without inventing visitor counts', () => {
  const day = core.emptyAnalyticsDay(TODAY);
  day.total = 5; day.paths = { '/b': 3, '/a': 2 }; day.referrers = { '(direct)': 4, 'news.example': 1 }; day.locales = { en: 3, 'zh-CN': 2 };
  const result = core.analyticsSummary({ days: [day], rangeDays: 7, today: TODAY, enabled: true, storage: 'memory' });
  assert.equal(result.daily.length, 7);
  assert.equal(result.range.from, '2026-10-25');
  assert.equal(result.totals.pageviews, 5);
  assert.equal(result.totals.today, 5);
  assert.deepEqual(result.pages, [{ key: '/b', views: 3 }, { key: '/a', views: 2 }]);
  assert.deepEqual(result.locales.map((item) => item.key), ['en', 'zh-CN']);
  assert.equal('visitors' in result.totals, false);
  assert.equal(core.analyticsRange('90'), 90);
  assert.equal(core.analyticsRange('31'), 0);
});

const engines = [
  ['SQLite', () => sqliteAnalyticsStore],
  ['Blobs document', () => createAnalyticsDocumentStore(memoryBackend(), 'memory')],
];
for (const [name, make] of engines) {
  test(`${name}: counters, disable, clear and 90-day retention share semantics`, async () => {
    const store = make();
    await store.setEnabled(true);
    await store.record(TODAY, view('/articles/light'));
    await store.record(TODAY, view('/articles/light', 'news.example'));
    await store.record(TODAY, view('/zh-CN/articles/light', '(internal)'));
    let days = await store.read('2026-10-01', TODAY);
    assert.equal(days.length, 1);
    assert.equal(days[0].total, 3);
    assert.equal(days[0].paths['/articles/light'], 2);
    assert.equal(days[0].paths['/zh-CN/articles/light'], 1);
    assert.equal(days[0].referrers['(direct)'], 1);
    assert.equal(days[0].referrers['news.example'], 1);
    assert.equal(days[0].locales['zh-CN'], 1);

    await store.setEnabled(false);
    assert.equal(await store.record(TODAY, view('/articles/ignored')), false);
    assert.equal((await store.read(TODAY, TODAY))[0].total, 3);
    await store.clear();
    assert.deepEqual(await store.read('2026-01-01', TODAY), []);
    assert.equal(await store.isEnabled(), false, 'clearing data preserves the owner choice');

    await store.setEnabled(true);
    await store.record('2026-08-01', view('/articles/old'));
    await store.record(TODAY, view('/articles/new'));
    days = await store.read('2026-01-01', TODAY);
    assert.deepEqual(days.map((day) => day.date), [TODAY]);
    assert.equal(days[0].paths['/articles/old'], undefined);
  });
}

test('document store retries conditional-write conflicts without dropping views', async () => {
  const inner = memoryBackend();
  let conflicts = 3;
  const backend = {
    load: () => inner.load(),
    async save(text, etag) {
      if (conflicts > 0) { conflicts--; return false; }
      return inner.save(text, etag);
    },
  };
  const store = createAnalyticsDocumentStore(backend, 'memory');
  await Promise.all(Array.from({ length: 8 }, () => store.record(TODAY, view('/articles/light'))));
  assert.equal((await store.read(TODAY, TODAY))[0].total, 8);
  assert.ok(conflicts < 3);
});

function httpHarness(store = createAnalyticsDocumentStore(memoryBackend(), 'memory')) {
  const run = (method, path, { body, headers = {}, admin = false } = {}) => handleAnalyticsRequest(new Request(new URL(path, 'https://archive.example'), {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(admin ? { authorization: 'Bearer analytics-test-admin' } : {}), ...headers },
  }), {
    store, now,
    requireAdmin: (request) => { if (request.headers.get('authorization') !== 'Bearer analytics-test-admin') throw unauthorized(); },
    siteOrigin: 'https://archive.example',
  });
  return { store, run };
}

test('HTTP: collection, privacy signals, origin checks, owner auth, export and clear', async () => {
  const { store, run } = httpHarness();
  let response = await run('POST', '/api/analytics/collect', { body: { path: '/articles/light?query=secret', referrer: '' } });
  assert.equal(response.status, 400);
  response = await run('POST', '/api/analytics/collect', { body: { path: '/articles/light', referrer: 'news.example' }, headers: { origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
  response = await run('POST', '/api/analytics/collect', { body: { path: '/articles/light', referrer: 'news.example' }, headers: { origin: 'https://archive.example', 'sec-fetch-site': 'same-origin' } });
  assert.equal(response.status, 204);
  await run('POST', '/api/analytics/collect', { body: { path: '/zh-CN/more', referrer: '(internal)' } });
  const beforePrivacy = (await store.read(TODAY, TODAY))[0].total;
  for (const headers of [{ dnt: '1' }, { 'sec-gpc': '1' }]) {
    response = await run('POST', '/api/analytics/collect', { body: { path: '/articles/private-signal', referrer: '' }, headers });
    assert.equal(response.status, 204);
  }
  assert.equal((await store.read(TODAY, TODAY))[0].total, beforePrivacy);

  assert.equal((await run('GET', '/api/analytics/admin/summary')).status, 401);
  response = await run('GET', '/api/analytics/admin/summary?days=7', { admin: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const summary = await response.json();
  assert.equal(summary.totals.pageviews, 2);
  assert.equal(summary.pages.find((item) => item.key === '/articles/light').views, 1);
  assert.equal(summary.locales.find((item) => item.key === 'zh-CN').views, 1);
  assert.equal((await run('GET', '/api/analytics/admin/summary?days=31', { admin: true })).status, 400);

  response = await run('PATCH', '/api/analytics/admin/settings', { admin: true, body: { enabled: false } });
  assert.deepEqual(await response.json(), { enabled: false });
  await run('POST', '/api/analytics/collect', { body: { path: '/articles/disabled', referrer: '' } });
  assert.equal((await store.read(TODAY, TODAY))[0].total, 2);

  response = await run('GET', '/api/analytics/admin/export?days=7', { admin: true });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /pageviews-2026-10-31-7d\.csv/);
  const csv = await response.text();
  assert.match(csv, /date,metric,key,pageviews/);
  assert.match(csv, /\/articles\/light/);
  assert.doesNotMatch(csv, /query=secret/);

  response = await run('DELETE', '/api/analytics/admin/data', { admin: true, headers: { origin: 'https://archive.example' } });
  assert.deepEqual(await response.json(), { cleared: true });
  assert.deepEqual(await store.read(TODAY, TODAY), []);
  assert.equal(await store.isEnabled(), false);
});

test('same-site validation accepts the real Host without trusting a cross-site Origin', async () => {
  const { store } = httpHarness();
  const init = {
    method: 'POST',
    headers: { host: '127.0.0.1:4178', origin: 'http://127.0.0.1:4178', 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/more', referrer: '' }),
  };
  const local = await handleAnalyticsRequest(new Request('https://example.invalid/api/analytics/collect', init), { store, siteOrigin: 'https://example.invalid' });
  assert.equal(local.status, 204);
  const evil = await handleAnalyticsRequest(new Request('https://example.invalid/api/analytics/collect', { ...init, headers: { ...init.headers, origin: 'https://evil.example' } }), { store, siteOrigin: 'https://example.invalid' });
  assert.equal(evil.status, 403);
  assert.equal((await store.read(TODAY, TODAY))[0].total, 1);
});

test('CSV export protects spreadsheets even from a hostile aggregate key', () => {
  const day = core.emptyAnalyticsDay(TODAY);
  day.paths['=HYPERLINK("https://evil.example")'] = 1;
  assert.match(core.analyticsCsv([day]), /"'=HYPERLINK/);
});

test('SQLite migration 12 has counters only, not a raw event table', () => {
  assert.ok(Number(connection().pragma('user_version', { simple: true })) >= 12);
  const tables = connection().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes('analytics_daily'));
  assert.ok(!tables.includes('analytics_events'));
  const columns = connection().prepare('PRAGMA table_info(analytics_daily)').all().map((row) => row.name);
  assert.deepEqual(columns, ['day', 'metric', 'key', 'views']);
});

function fakeBlobs() {
  const data = new Map(); let version = 0;
  return {
    data,
    async getWithMetadata(key) { const entry = data.get(key); return entry ? { data: entry.value, etag: entry.etag } : null; },
    async set(key, value, options) {
      const entry = data.get(key);
      if (options.onlyIfNew && entry) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== entry?.etag) return { modified: false };
      data.set(key, { value, etag: `"${++version}"` });
      return { modified: true, etag: `"${version}"` };
    },
  };
}

test('Netlify Blobs wiring isolates deploy contexts and stores no raw visitor data', async () => {
  const blobs = fakeBlobs();
  const production = netlifyAnalyticsStore(blobs, 'production');
  const preview = netlifyAnalyticsStore(blobs, 'deploy-preview');
  await production.record(TODAY, view('/articles/light', 'news.example'));
  await preview.record(TODAY, view('/zh-CN/more', '(internal)'));
  assert.deepEqual([...blobs.data.keys()].sort(), ['pageviews-deploy-preview.json', 'pageviews-production.json']);
  assert.equal(analyticsDocumentKey('production'), 'pageviews-production.json');
  const stored = blobs.data.get('pageviews-production.json').value;
  assert.match(stored, /news\.example/);
  assert.doesNotMatch(stored, /https:\/\/news|user-agent|ipAddress|visitor|query/);
  assert.equal((await production.read(TODAY, TODAY))[0].total, 1);
  assert.equal((await preview.read(TODAY, TODAY))[0].paths['/articles/light'], undefined);
});

test('Netlify analytics Function bundle excludes the Node database, Astro and UI', async () => {
  const source = readFileSync(new URL('../netlify/functions/analytics.mts', import.meta.url), 'utf8');
  assert.match(source, /path: \['\/api\/analytics', '\/api\/analytics\/\*'\]/);
  assert.match(source, /rateLimit: \{ windowLimit: 120, windowSize: 60, aggregateBy: \['ip', 'domain'\] \}/);
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({ input: new URL('../netlify/functions/analytics.mts', import.meta.url).pathname, platform: 'node', external: ['@netlify/blobs', /^node:/], logLevel: 'silent' });
  const inputs = (await bundle.generate({ format: 'esm' })).output[0].moduleIds;
  await bundle.close();
  assert.ok(inputs.some((path) => path.endsWith('src/server/analytics/http.ts')));
  for (const forbidden of ['better-sqlite3', 'db/connection.ts', 'db/analytics.repository.ts', 'node_modules/astro/', 'src/ui/', 'src/pages/']) {
    assert.ok(!inputs.some((path) => path.includes(forbidden)), forbidden);
  }
});
