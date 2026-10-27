// Archive service: cache refresh, de-duplicated syncs, graceful degradation.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.NOTION_TOKEN = 'secret_test';
process.env.NOTION_DB_MUSIC = 'db-music';
delete process.env.NOTION_DB_WRITING;
delete process.env.NOTION_DB_FILMS;

let queries = 0;
let failNext = false;
let bodyCalls = 0;
const realFetch = globalThis.fetch;
const page = (id, title, year) => ({
  id, created_time: '2026-01-01T00:00:00Z', last_edited_time: `2026-01-0${year % 9 + 1}T00:00:00Z`,
  properties: { Name: { type: 'title', title: [{ plain_text: title }] }, Year: { type: 'number', number: year },
    URL: { type: 'url', url: 'https://cdn.test/track.mp3' } },
});

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/query')) {
    queries++;
    await new Promise((r) => setTimeout(r, 20));
    if (failNext) { failNext = false; return new Response('{}', { status: 500 }); }
    return Response.json({ results: [page('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Older Track', 2020), page('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Newer Track', 2025)], has_more: false });
  }
  if (u.includes('/children')) {
    bodyCalls++;
    return Response.json({ results: [{ id: 'p', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'liner notes' }] } }], has_more: false });
  }
  return Response.json({});
};

const archive = await import('../src/server/services/archive.ts');
const { syncStatus } = await import('../src/server/services/status.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');
test.after(() => { globalThis.fetch = realFetch; closeConnection(); });

test('concurrent syncs of one kind share a single Notion query', async () => {
  const before = queries;
  const [a, b, c] = await Promise.all([archive.syncKind('music'), archive.syncKind('music'), archive.syncKind('music')]);
  assert.deepEqual([a, b, c], [2, 2, 2]);
  assert.equal(queries - before, 1);
});

test('unconfigured kinds are skipped instead of failing', async () => {
  assert.equal(await archive.syncKind('writing'), 0);
  assert.deepEqual(await archive.syncAll(), { music: 2 });
});

test('listItems serves the cache sorted newest year first, with public hrefs', async () => {
  const items = await archive.listItems('music');
  assert.deepEqual(items.map((i) => i.title), ['Newer Track', 'Older Track']);
  const found = await archive.findItem('music', 'older-track');
  assert.equal(found.id, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});

test('bodies are fetched once and then served from the cache', async () => {
  const item = await archive.requireItem('music', 'newer-track');
  const first = await archive.itemBody(item);
  const second = await archive.itemBody(item);
  assert.equal(first, '<p>liner notes</p>');
  assert.equal(second, first);
  assert.equal(bodyCalls, 1);
  await archive.itemBody(item, { refresh: true });
  assert.equal(bodyCalls, 2);
});

test('a failed sync keeps the stale cache and records the error', async () => {
  failNext = true;
  await assert.rejects(archive.syncKind('music'), (error) => error.code === 'upstream_error');
  assert.equal((await archive.listItems('music')).length, 2, 'stale data still served');
  assert.match(syncStatus().syncError, /Notion request failed/);
  await archive.syncKind('music');
  assert.equal(syncStatus().syncError, null, 'a successful sync clears the error');
});

test('requireItem 404s with a contract error', async () => {
  await assert.rejects(archive.requireItem('music', 'missing'), (error) => error.status === 404 && error.code === 'not_found');
});

test('changing Notion settings forces the next read to re-sync', async () => {
  const { updateSettings } = await import('../src/server/services/settings.ts');
  await archive.listItems('music');
  const before = queries;
  updateSettings({ NOTION_DB_MUSIC: 'db-music-2' });
  await archive.listItems('music');
  assert.equal(queries - before, 1, 'cache invalidated by the settings change');
});
