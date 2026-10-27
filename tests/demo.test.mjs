// Without Notion credentials the site serves the built-in demo articles.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_TOKEN = 'demo-admin';
for (const key of ['NOTION_TOKEN', 'NOTION_API_SECRET', 'NOTION_DATABASE_ID', 'DATABASE_ID', 'NOTION_DB_WRITING']) delete process.env[key];

const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('demo mode must not call the network'); };

const pub = await import('../src/server/http/endpoints/public.ts');
const admin = await import('../src/server/http/endpoints/admin.ts');
const queries = await import('../src/server/queries.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');

test.after(() => {
  globalThis.fetch = realFetch;
  closeConnection();
});

const call = async (handler, { path = '/', params = {}, method = 'GET', token } = {}) => {
  const url = new URL(path, 'http://archive.test');
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await handler({ request: new Request(url, { method, headers }), url, params });
  return { status: response.status, data: await response.json() };
};

test('demo articles are listed and rendered through the Notion renderer', async () => {
  const site = await call(pub.site);
  assert.equal(site.data.demo, true);
  assert.equal(site.data.notionConfigured, false);

  const list = await call(pub.listArticlesEndpoint);
  assert.equal(list.data.total, 3);
  assert.equal(list.data.articles[0].slug, 'connect-notion');

  const detail = await call(pub.getArticle, { params: { slug: 'connect-notion' } });
  assert.equal(detail.status, 200);
  assert.match(detail.data.html, /<table>/);
  assert.match(detail.data.html, /<nav class="toc"/);
  assert.equal(detail.data.toc.length, 2);
  assert.equal(detail.data.next.slug, 'a-room-with-red-curtains');

  const home = await queries.getHome();
  assert.deepEqual(home.featured.map((a) => a.slug), ['connect-notion']);
  assert.ok(home.topics.some((t) => t.name === 'Notes' && t.count === 2));

  const found = await call(pub.searchArticles, { path: '/api/search?q=curtain' });
  assert.ok(found.data.total >= 1);
});

test('sync and schema check explain that Notion is not configured', async () => {
  const sync = await call(admin.runSync, { method: 'POST', token: 'demo-admin' });
  assert.equal(sync.status, 400);
  assert.match(sync.data.error, /not configured/);
  const schema = await call(admin.notionSchema, { token: 'demo-admin' });
  assert.equal(schema.status, 400);
  const status = await call(admin.readSync, { token: 'demo-admin' });
  assert.equal(status.data.status.demo, true);
});
