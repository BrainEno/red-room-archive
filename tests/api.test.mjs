// End-to-end contract tests for the JSON API, the media proxy and the page
// facade — against an in-memory SQLite database and a fake Notion workspace
// shaped like the original astro-notion blog database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB, ID, compact, createNotionMock } from './fixtures/notion-mock.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-api-'));
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.NOTION_TOKEN = 'secret_env_token';
process.env.NOTION_API_BASE = API;
process.env.SYNC_TTL_SECONDS = '3600';
delete process.env.NOTION_DATABASE_ID;
// The astro-notion variable name is accepted as a fallback.
process.env.DATABASE_ID = DB;

const mock = createNotionMock();
const realFetch = globalThis.fetch;
globalThis.fetch = mock.fetch;

const pub = await import('../src/server/http/endpoints/public.ts');
const admin = await import('../src/server/http/endpoints/admin.ts');
const files = await import('../src/server/http/endpoints/uploads.ts');
const media = await import('../src/server/http/endpoints/media.ts');
const queries = await import('../src/server/queries.ts');
const { resetAuthThrottle } = await import('../src/server/services/auth.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');

test.after(() => {
  globalThis.fetch = realFetch;
  closeConnection();
  rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(() => resetAuthThrottle());

const TOKEN = 'test-admin-token';

/** Invoke a handler the way Astro does. */
async function call(handler, { method = 'GET', path: p = '/', params = {}, json, body, headers = {}, token, peer = '127.0.0.1' } = {}) {
  const url = new URL(p, 'http://archive.test');
  const h = new Headers(headers);
  if (token) h.set('authorization', `Bearer ${token}`);
  if (json !== undefined) h.set('content-type', 'application/json');
  const request = new Request(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, duplex: 'half' });
  const response = await handler({ request, url, params, clientAddress: peer });
  const raw = response.status === 204 ? new ArrayBuffer(0) : await response.arrayBuffer();
  const text = Buffer.from(raw).toString();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { status: response.status, headers: response.headers, data, bytes: Buffer.from(raw) };
}

const notionCalls = (fragment) => mock.state.calls.filter((c) => c.url.includes(fragment)).length;

test('sync is admin-only; it paginates, retries 429 and keeps only visible pages', async () => {
  assert.equal((await call(admin.runSync, { method: 'POST' })).status, 401);

  mock.state.rateLimit = 1;
  const synced = await call(admin.runSync, { method: 'POST', token: TOKEN });
  assert.equal(synced.status, 200, JSON.stringify(synced.data));
  assert.equal(synced.data.synced, 3);
  assert.equal(notionCalls('/query'), 3, 'one 429 retry + two result pages');
  assert.equal(synced.data.status.demo, false);
  assert.equal(synced.data.status.syncError, null);

  const list = await call(pub.listArticlesEndpoint, { path: '/api/articles' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.articles.map((a) => a.slug), ['first-light', '第二篇', 'first-light-2']);
  assert.equal(list.data.total, 3);
  const [first, second] = list.data.articles;
  assert.equal(first.href, '/articles/first-light');
  assert.equal(first.cover, `/media/notion/${compact(ID.first)}`, 'Notion-hosted cover goes through the proxy');
  assert.equal(second.cover, 'https://images.test/second.jpg', 'external cover is used directly');
  assert.equal(first.rank, 2);
  assert.equal(first.excerpt, 'Where it begins.');
  assert.equal(second.href, `/articles/${encodeURIComponent('第二篇')}`);
  assert.ok(!JSON.stringify(list.data).includes('Draft'), 'unpublished pages never reach the API');
  assert.ok(!JSON.stringify(list.data).includes('Future'), 'scheduled pages stay hidden until their date');
});

test('admin overview: what is published and what needs attention', async () => {
  assert.equal((await call(admin.readOverview)).status, 401);
  const { status, data } = await call(admin.readOverview, { token: TOKEN });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.status.demo, false);
  assert.equal(data.articles.total, 3);
  assert.equal(data.articles.featured, 1, 'first-light has Rank 2');
  assert.equal(data.articles.topics, 2);
  assert.deepEqual(data.articles.latest, { title: 'First Light', href: '/articles/first-light', date: data.articles.latest.date });
  assert.equal(data.articles.years.reduce((n, y) => n + y.count, 0), 3);
  assert.equal(data.more.custom, false);
  assert.ok(data.more.publications > 0);
  assert.equal(typeof data.uploads.bytes, 'number');
  const codes = data.checks.map((check) => check.code);
  assert.ok(!codes.includes('notion-missing') && !codes.includes('sync-error'));
  assert.ok(codes.includes('more-sample'), 'the built-in More sample is pointed out');
  assert.ok(codes.includes('site-url-missing'), 'SITE_URL is not set in this test');
  assert.ok(data.checks.every((check) => check.level === 'warn' || check.level === 'info'));
  assert.ok(!JSON.stringify(data).includes('secret_env_token'), 'no credentials in the overview');
});

test('tags: counts are case-insensitive and filter the list', async () => {
  const tags = await call(pub.tags);
  // Labels follow what the archive uses (`Poem`, not the glossary's first name `Poetry`).
  assert.deepEqual(tags.data.tags, [{ key: 'fiction', slug: 'fiction', name: 'Fiction', count: 2 }, { key: 'poetry', slug: 'poetry', name: 'Poem', count: 1 }]);
  const filtered = await call(pub.listArticlesEndpoint, { path: '/api/articles?tag=fiction&limit=1' });
  assert.equal(filtered.data.total, 2);
  assert.equal(filtered.data.articles.length, 1);
  assert.equal(filtered.data.tag, 'fiction');
});

test('tags in Chinese: built-in pairs translate, any alias filters, one name per topic', async () => {
  const zh = await call(pub.tags, { path: '/api/tags?lang=zh-CN' });
  assert.deepEqual(zh.data.tags, [{ key: 'fiction', slug: 'fiction', name: '小说', count: 2 }, { key: 'poetry', slug: 'poetry', name: '诗歌', count: 1 }]);
  const byChinese = await call(pub.listArticlesEndpoint, { path: `/api/articles?tag=${encodeURIComponent('小说')}&lang=zh-CN` });
  assert.equal(byChinese.data.total, 2, 'a Chinese name selects the English-tagged articles');
  assert.ok(byChinese.data.articles.every((article) => article.tags.includes('小说') && !article.tags.includes('Fiction')));

  // The admin's own pairs win over the built-in ones.
  await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { tag_glossary: '# mine\nPoem = 诗' } });
  const custom = await call(pub.tags, { path: '/api/tags?lang=zh-CN' });
  assert.deepEqual(custom.data.tags.map((tag) => tag.name), ['小说', '诗']);
  assert.equal((await call(admin.readSettings, { token: TOKEN })).data.values.tag_glossary, '# mine\nPoem = 诗');
  const home = await queries.getHome('zh-CN');
  assert.deepEqual(home.topics.map((topic) => topic.name), ['小说', '诗']);
  assert.ok(home.latest.every((article) => article.tags.every((tag) => /\p{Script=Han}/u.test(tag))));
  // Topic pages: other names of a topic redirect to its one slug.
  assert.deepEqual(await queries.getTopic({ slug: 'FICTION', locale: 'zh-CN' }), { status: 'redirect', slug: 'fiction' });
  assert.deepEqual(await queries.getTopic({ slug: '小说', locale: 'zh-CN' }), { status: 'redirect', slug: 'fiction' });
  const page = await queries.getTopic({ slug: 'fiction', locale: 'zh-CN' });
  assert.equal(page.status, 'ok');
  assert.deepEqual(page.tag, { key: 'fiction', slug: 'fiction', name: '小说' });
  assert.ok(page.articles.every((article) => article.topics.some((topic) => topic.slug === 'fiction' && topic.name === '小说')));
  const found = await call(pub.searchArticles, { path: `/api/search?q=${encodeURIComponent('小说')}` });
  assert.ok(found.data.total >= 2, 'search matches a tag through its translation');
  await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { tag_glossary: '' } });
});

test('article detail renders the block tree once and caches it', async () => {
  const before = notionCalls('/children');
  const detail = await call(pub.getArticle, { path: '/api/articles/first-light', params: { slug: 'first-light' } });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  const { html, toc } = detail.data;

  assert.deepEqual(toc, [{ id: 'opening', text: 'Opening', level: 1 }, { id: 'closing', text: 'Closing', level: 2 }]);
  assert.match(html, /<h2 id="opening">Opening<\/h2>/);
  assert.match(html, /<nav class="toc nc-gray"/);
  assert.match(html, new RegExp(`<a href="/articles/${encodeURIComponent('第二篇')}">the second</a>`), 'internal links resolve to article URLs');
  assert.match(html, /<span class="mention">Draft<\/span>/);
  assert.doesNotMatch(html, /notion\.so/, 'links to unpublished pages are dropped');
  assert.match(html, new RegExp(`<img src="/media/notion/${compact(ID.image)}"`));
  assert.doesNotMatch(html, /files\.test/, 'expiring signed URLs never reach the HTML');
  assert.match(html, /<details class="toggle"><summary>More<\/summary><p>Hidden paragraph about owls\.<\/p><\/details>/);
  assert.match(html, /<thead><tr><th scope="col">Name<\/th><th scope="col">Value<\/th><\/tr><\/thead>/);
  assert.match(html, /Synced words\./, 'synced blocks show the original content');
  assert.doesNotMatch(html, /SECRET/, 'child pages are not inlined');
  assert.match(html, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(html, /<span class="nc-red"><em>/);
  assert.equal(detail.data.previous, null);
  assert.deepEqual(detail.data.next, { slug: '第二篇', title: '第二篇', href: `/articles/${encodeURIComponent('第二篇')}` });
  assert.ok(detail.data.readingMinutes >= 1);
  const fetched = notionCalls('/children') - before;
  assert.equal(fetched, 4, 'page + toggle + table + synced original (child page skipped)');

  await call(pub.getArticle, { path: '/api/articles/first-light', params: { slug: 'first-light' } });
  assert.equal(notionCalls('/children') - before, fetched, 'second view is served from the cache');

  const missing = await call(pub.getArticle, { params: { slug: 'nope' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.code, 'not_found');

  assert.equal((await call(pub.getArticle, { path: '/api/articles/first-light?refresh=1', params: { slug: 'first-light' } })).status, 401);
  const refreshed = await call(pub.getArticle, { path: '/api/articles/first-light?refresh=1', params: { slug: 'first-light' }, token: TOKEN });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.headers.get('cache-control'), 'no-store');
  assert.equal(notionCalls('/children') - before, fetched * 2);
});

test('media proxy: allow-listed ids only, cached on disk, ranges, fresh URL on miss', async () => {
  const id = compact(ID.image);
  const first = await call(media.serveNotionMedia, { params: { id } });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/png');
  assert.deepEqual(first.bytes, Buffer.from(mock.PNG));
  assert.match(first.headers.get('content-security-policy'), /sandbox/);
  assert.equal(mock.state.downloads, 1);

  const { notionGeneration } = await import('../src/server/services/settings.ts');
  assert.ok(existsSync(path.join(process.env.MEDIA_CACHE_DIR, `generation-${notionGeneration()}`, id)), 'image is cached in the active generation');

  // Notion re-signs URLs; the proxy asks for a fresh one, never reuses the old.
  mock.state.signature = 2;
  const again = await call(media.serveNotionMedia, { params: { id } });
  assert.equal(again.status, 200);
  assert.equal(mock.state.downloads, 1, 'served from the disk cache');

  const range = await call(media.serveNotionMedia, { params: { id }, headers: { range: 'bytes=0-7' } });
  assert.equal(range.status, 206);
  assert.equal(range.bytes.length, 8);

  const cover = await call(media.serveNotionMedia, { params: { id: compact(ID.first) } });
  assert.equal(cover.status, 200);
  assert.equal(mock.state.downloads, 2);

  assert.equal((await call(media.serveNotionMedia, { params: { id: compact(ID.child) } })).status, 404, 'ids that are not article media are refused');
  assert.equal((await call(media.serveNotionMedia, { params: { id: '../../etc/passwd' } })).status, 404);
});

test('editing a page in Notion invalidates its body and media on the next sync', async () => {
  const before = notionCalls('/children');
  mock.touch(ID.first, '2026-10-02T09:00:00.000Z');
  await call(admin.runSync, { method: 'POST', token: TOKEN });
  const { notionGeneration } = await import('../src/server/services/settings.ts');
  assert.ok(!existsSync(path.join(process.env.MEDIA_CACHE_DIR, `generation-${notionGeneration()}`, compact(ID.image))), 'old image copy is deleted');

  const detail = await call(pub.getArticle, { params: { slug: 'first-light' } });
  assert.equal(detail.data.updated, '2026-10-02T09:00:00.000Z');
  assert.ok(notionCalls('/children') > before, 'body fetched again');
  const image = await call(media.serveNotionMedia, { params: { id: compact(ID.image) } });
  assert.equal(image.status, 200);
  assert.equal(mock.state.downloads, 3);
});

test('when Notion is down, the last rendered body is served', async () => {
  mock.touch(ID.first, '2026-10-03T09:00:00.000Z');
  await call(admin.runSync, { method: 'POST', token: TOKEN });
  mock.state.offline = true;
  try {
    const detail = await call(pub.getArticle, { params: { slug: 'first-light' } });
    assert.equal(detail.status, 200);
    assert.match(detail.data.html, /Opening/);
    const failed = await call(admin.runSync, { method: 'POST', token: TOKEN });
    assert.equal(failed.status, 502);
    assert.equal(failed.data.code, 'upstream_error');
    const status = await call(admin.readSync, { token: TOKEN });
    assert.match(status.data.status.syncError, /could not reach Notion/);
    // The public list keeps working from the cache.
    assert.equal((await call(pub.listArticlesEndpoint)).data.total, 3);
  } finally {
    mock.state.offline = false;
  }
});

test('search matches title, tags and cached body text', async () => {
  await call(admin.runSync, { method: 'POST', path: '/api/sync?bodies=1', token: TOKEN });
  const byTitle = await call(pub.searchArticles, { path: '/api/search?q=light' });
  assert.deepEqual(byTitle.data.articles.map((a) => a.slug), ['first-light', 'first-light-2']);
  const byTag = await call(pub.searchArticles, { path: '/api/search?q=poem' });
  assert.deepEqual(byTag.data.articles.map((a) => a.slug), ['第二篇']);
  const byBody = await call(pub.searchArticles, { path: '/api/search?q=owls' });
  assert.deepEqual(byBody.data.articles.map((a) => a.slug), ['first-light']);
  const none = await call(pub.searchArticles, { path: '/api/search?q=owls%20poem' });
  assert.equal(none.data.total, 0, 'every term must match');
  assert.equal((await call(pub.searchArticles, { path: '/api/search?q=' })).data.total, 0);
});

test('page facade: home sections, paginated index, article view', async () => {
  const home = await queries.getHome();
  assert.equal(home.total, 3);
  assert.deepEqual(home.featured.map((a) => a.slug), ['first-light']);
  assert.deepEqual(home.topics.map((t) => t.name), ['Fiction', 'Poem']);

  const index = await queries.getArticles();
  assert.equal(index.total, 3);
  assert.equal(index.pages, 1);
  assert.equal(index.tag, undefined);
  assert.deepEqual(index.tags.map((t) => t.slug), ['fiction', 'poetry']);
  const poem = await queries.getTopic({ slug: 'poetry' });
  assert.equal(poem.status, 'ok');
  assert.equal(poem.total, 1);
  assert.equal(poem.pages, 1);
  assert.deepEqual(poem.tag, { key: 'poetry', slug: 'poetry', name: 'Poem' });
  assert.deepEqual(await queries.getTopic({ slug: 'poem' }), { status: 'redirect', slug: 'poetry' }, 'the label used on articles finds the topic');
  assert.deepEqual(await queries.getTopic({ slug: 'no-such-topic' }), { status: 'missing' });
  assert.deepEqual(await queries.getTopic({ slug: 'essay' }), { status: 'missing' }, 'a glossary topic without articles has no page');

  const archive = await queries.getArchive('en');
  assert.equal(archive.total, 3);
  assert.equal(archive.years.reduce((n, year) => n + year.articles.length, 0), 3);
  assert.ok(archive.years.every((year, i, all) => !i || !year.year || year.year < all[i - 1].year), 'years run newest first');
  const view = await queries.getArticle('first-light');
  assert.equal(view.bodyMissing, false);
  assert.equal(await queries.getArticle('missing'), undefined);
});

test('site copy per language: Chinese overrides are separate from English, /api/site?lang=', async () => {
  const en = queries.getSite('en');
  const zh = queries.getSite('zh-CN');
  assert.equal(en.locale, 'en');
  assert.equal(zh.locale, 'zh-CN');
  assert.equal(zh.tagline, '小说、诗歌以及其他');
  assert.notEqual(zh.about, en.about, 'each language has its own quote');
  assert.equal(en.intro, '', 'no placeholder intro: hidden until the owner writes one');
  assert.equal(zh.intro, '');
  assert.equal(queries.getSite().locale, 'en', 'English by default');

  const saved = await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_intro_zh: '你好，帷幕之后。', site_intro: 'Hello behind the curtain.' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.values.site_intro_zh, '你好，帷幕之后。');
  assert.equal(queries.getSite('zh-CN').intro, '你好，帷幕之后。');
  assert.equal(queries.getSite('en').intro, 'Hello behind the curtain.');
  assert.equal((await call(pub.site, { path: '/api/site?lang=zh-CN' })).data.intro, '你好，帷幕之后。');
  assert.equal((await call(pub.site, { path: '/api/site?lang=zh-CN' })).data.locale, 'zh-CN');
  assert.equal((await call(pub.site, { path: '/api/site' })).data.intro, 'Hello behind the curtain.');

  // Clearing an override falls back to that language's built-in copy, never the other language.
  await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_intro_zh: '' } });
  assert.equal(queries.getSite('zh-CN').intro, zh.intro);
  // Saving the untouched default does not freeze it as an override.
  await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_intro_zh: zh.intro, site_intro: '' } });
  const after = await call(admin.readSettings, { token: TOKEN });
  assert.equal(after.data.values.site_intro_zh, zh.intro);
  assert.equal(queries.getSite('en').intro, en.intro);
});

test('schema check maps the astro-notion columns without warnings', async () => {
  assert.equal((await call(admin.notionSchema)).status, 401);
  const schema = await call(admin.notionSchema, { token: TOKEN });
  assert.equal(schema.status, 200);
  assert.equal(schema.data.database.title, 'Bottom Think');
  assert.deepEqual(
    Object.fromEntries(Object.entries(schema.data.mapping).map(([field, m]) => [field, m.property])),
    { title: 'Page', slug: 'Slug', date: 'Date', published: 'Published', tags: 'Tags', excerpt: 'Excerpt', cover: 'FeaturedImage', rank: 'Rank' },
  );
  assert.deepEqual(schema.data.warnings, []);
});

test('settings: token masked, database accepts a pasted link, changing it resets the cache', async () => {
  const before = await call(admin.readSettings, { token: TOKEN });
  assert.equal(before.data.values.NOTION_TOKEN, '••••oken');
  assert.equal(before.data.values.NOTION_DATABASE_ID, DB);
  assert.doesNotMatch(JSON.stringify(before.data), /secret_env_token/);

  const bad = await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { NOTION_DATABASE_ID: 'not a database' } });
  assert.equal(bad.status, 400);

  const other = 'fedcba9876543210fedcba9876543210';
  const saved = await call(admin.writeSettings, {
    method: 'PATCH', token: TOKEN,
    json: { site_name: 'Velvet', NOTION_TOKEN: '••••oken', NOTION_DATABASE_ID: `https://www.notion.so/team/Blog-${other}?v=99999999999999999999999999999999` },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.values.NOTION_DATABASE_ID, other);
  assert.equal(saved.data.status.articles, 0, 'old articles are forgotten');
  assert.equal((await call(pub.site)).data.name, 'Velvet');

  // The new database does not exist → sync reports it, nothing leaks.
  const sync = await call(admin.runSync, { method: 'POST', token: TOKEN });
  assert.equal(sync.status, 502);
  assert.doesNotMatch(JSON.stringify(sync.data), /secret database detail/);

  const back = await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { NOTION_DATABASE_ID: '', site_name: '' } });
  assert.equal(back.data.values.NOTION_DATABASE_ID, DB, 'empty value falls back to the environment');
  assert.equal(back.data.values.site_name, 'SureShot Studio');
});

test('login: wrong tokens are throttled, missing tokens on other endpoints are not', async () => {
  for (let i = 0; i < 12; i++) {
    const r = await call(admin.login, { method: 'POST', json: { token: 'wrong' }, peer: '10.0.0.9' });
    assert.equal(r.status, 401);
  }
  const locked = await call(admin.login, { method: 'POST', json: { token: TOKEN }, peer: '10.0.0.9' });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.code, 'rate_limited');

  for (let i = 0; i < 20; i++) await call(admin.readSettings, { peer: '10.0.0.10' });
  const owner = await call(admin.login, { method: 'POST', json: { token: TOKEN }, peer: '10.0.0.10' });
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
  assert.equal(health.data.notion, true);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(health.data), /secret/);
});

test('site profile import is authenticated, public-only, atomic and preserves Notion credentials', async () => {
  const { makeProfile } = await import('../public/profile-format.js');
  const before = await call(admin.readSettings, { token: TOKEN });
  const profile = makeProfile(before.data.values);
  profile.settings.site_name = 'Migrated Archive';
  profile.settings.site_about_zh = '迁移后的介绍';
  assert.equal((await call(admin.writeSiteProfile, { method: 'POST', json: profile })).status, 401);
  const injected = structuredClone(profile); injected.settings.NOTION_TOKEN = 'new-secret';
  assert.equal((await call(admin.writeSiteProfile, { method: 'POST', token: TOKEN, json: injected })).status, 400);
  assert.equal((await call(admin.readSettings, { token: TOKEN })).data.values.site_name, before.data.values.site_name);
  const imported = await call(admin.writeSiteProfile, { method: 'POST', token: TOKEN, json: profile });
  assert.equal(imported.status, 200); assert.equal(imported.data.values.site_name, 'Migrated Archive');
  assert.equal(imported.data.values.site_about_zh, '迁移后的介绍');
  assert.equal(imported.data.values.NOTION_TOKEN, before.data.values.NOTION_TOKEN);
  assert.equal(imported.data.values.NOTION_DATABASE_ID, before.data.values.NOTION_DATABASE_ID);
  assert.ok(!JSON.stringify(profile).includes('secret_env_token'));
  assert.equal((await call(admin.writeSiteProfile, { method: 'POST', token: TOKEN, json: makeProfile(before.data.values) })).status, 200);
});

test('newsletter entry points: hidden by default, the admin switch wins over SHOW_NEWSLETTER_SIGNUP, the sitemap follows', async () => {
  const { newsletterSignupVisible } = await import('../src/server/services/settings.ts');
  const { sitemap } = await import('../src/ui/feeds.ts');
  const listed = (on) => /\/subscribe</.test(sitemap({ origin: 'https://archive.test', articles: [], newsletterSignup: on }));
  const old = process.env.SHOW_NEWSLETTER_SIGNUP;
  const write = (value) => call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { newsletter_signup: value } });
  try {
    delete process.env.SHOW_NEWSLETTER_SIGNUP;
    assert.equal(newsletterSignupVisible(), false, 'off unless enabled');
    assert.equal(queries.getSite('en').newsletterSignup, false);
    assert.equal((await call(admin.readSettings, { token: TOKEN })).data.values.newsletter_signup, 'off');
    assert.equal(listed(false), false);
    assert.equal(listed(true), true);

    process.env.SHOW_NEWSLETTER_SIGNUP = 'true';
    assert.equal(newsletterSignupVisible(), true, 'the environment supplies the default');
    assert.equal((await write('off')).status, 200);
    assert.equal(newsletterSignupVisible(), false, 'a saved admin choice wins over the environment');
    assert.equal((await write('on')).status, 200);
    assert.equal(queries.getSite('zh-CN').newsletterSignup, true, 'takes effect without a restart');

    // Saving the value that matches the environment default is not frozen as an
    // override (the settings form submits every field on each save).
    delete process.env.SHOW_NEWSLETTER_SIGNUP;
    assert.equal(newsletterSignupVisible(), false, 'back to the environment default');
    assert.equal((await write('on')).status, 200);
    delete process.env.SHOW_NEWSLETTER_SIGNUP;
    assert.equal(newsletterSignupVisible(), true, 'an explicit choice that differs from the default is kept');
    assert.equal((await write('off')).status, 200);
    assert.equal(newsletterSignupVisible(), false);
  } finally {
    if (old === undefined) delete process.env.SHOW_NEWSLETTER_SIGNUP; else process.env.SHOW_NEWSLETTER_SIGNUP = old;
  }
});

test('homepage facts: editable per language, "-" hides, invalid text is rejected', async () => {
  const defaults = queries.getSite('en').facts;
  assert.deepEqual(defaults, [], 'no placeholder facts: the row stays hidden until the owner fills it in');
  assert.deepEqual(queries.getSite('zh-CN').facts, []);
  const initial = await call(admin.readSettings, { token: TOKEN });
  assert.equal(initial.data.values.site_facts, '-', 'admin shows the hidden default as "-", ready to edit');
  assert.equal(initial.data.values.site_facts_zh, '-');

  const saved = await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_facts: 'Based in: Taipei\r\nOpen: 10:00–18:00', site_facts_zh: '-' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(queries.getSite('en').facts, [{ key: 'Based in', value: 'Taipei' }, { key: 'Open', value: '10:00–18:00' }]);
  assert.deepEqual(queries.getSite('zh-CN').facts, [], '"-" hides the row');
  assert.deepEqual((await call(pub.site, { path: '/api/site' })).data.facts[0], { key: 'Based in', value: 'Taipei' });

  const bad = await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_facts: 'no separator', site_name: 'Should not save' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /site_facts/);
  assert.notEqual((await call(admin.readSettings, { token: TOKEN })).data.values.site_name, 'Should not save', 'validated before any write');

  // Saving the default text (or clearing) removes the override.
  await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_facts: initial.data.values.site_facts, site_facts_zh: '' } });
  assert.deepEqual(queries.getSite('en').facts, defaults);
  assert.deepEqual(queries.getSite('zh-CN').facts, []);
});

test('content bundle: admin-only ZIP with profile, saved More page, its uploads and the model', async () => {
  const { readZip } = await import('./fixtures/zip-reader.mjs');
  const more = await import('../src/server/http/endpoints/more.ts');
  assert.equal((await call(admin.downloadContentBundle)).status, 401);

  const cover = await call(files.upload, {
    method: 'POST', token: TOKEN, path: '/api/uploads?name=Zine%20Cover.png',
    body: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]).stream(), headers: { 'content-type': 'image/png' },
  });
  assert.equal(cover.status, 201);
  const document = { intro: { en: 'Hello', 'zh-CN': '' }, channels: [],
    publications: [{ title: { en: 'Zine', 'zh-CN': '' }, cover: cover.data.url }, { title: { en: 'Remote', 'zh-CN': '' }, cover: 'https://example.com/c.jpg' }] };
  assert.equal((await call(more.writeMoreDocument, { method: 'PUT', token: TOKEN, json: document })).status, 200);
  await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_facts: 'Based in: Taipei' } });

  const response = await call(admin.downloadContentBundle, { token: TOKEN });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="red-room-content-\d{8}\.zip"/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const zip = readZip(response.bytes);
  assert.deepEqual([...zip.keys()].sort(), ['README.txt', 'more.json', 'site-profile.json', `uploads/${cover.data.name}`, 'uploads/venus.glb'].sort());

  const profile = JSON.parse(zip.get('site-profile.json'));
  assert.equal(profile.version, 2);
  assert.equal(profile.settings.site_facts, 'Based in: Taipei');
  assert.doesNotMatch(zip.get('site-profile.json').toString(), /secret_env_token|NOTION/);
  const moreFile = JSON.parse(zip.get('more.json'));
  assert.equal(moreFile.format, 'red-room-more');
  assert.equal(moreFile.document.publications[0].cover, cover.data.url);
  assert.deepEqual([...zip.get(`uploads/${cover.data.name}`)], [0x89, 0x50, 0x4e, 0x47]);
  await call(more.resetMoreDocument, { method: 'DELETE', token: TOKEN });
  await call(admin.writeSettings, { method: 'PATCH', token: TOKEN, json: { site_facts: '' } });
});

test('homepage statue: the uploaded model (versioned) or the bundled one, never a guaranteed 404', async () => {
  // The uploads test above stored venus.glb.
  assert.match((await queries.getHome()).model, /^\/uploads\/venus\.glb\?v=\d+$/);
  assert.equal((await call(files.remove, { method: 'DELETE', token: TOKEN, params: { name: 'venus.glb' } })).status, 204);
  assert.equal((await queries.getHome()).model, '/models/venus.glb');
});
