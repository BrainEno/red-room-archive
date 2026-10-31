// Exercise in-flight Notion operations and settings rollback with isolated data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB, createNotionMock } from './fixtures/notion-mock.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-switch-'));
process.env.DB_PATH = ':memory:';
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.NOTION_TOKEN = 'original-token';
process.env.NOTION_DATABASE_ID = DB;
process.env.NOTION_API_BASE = API;
const mock = createNotionMock();
const originalFetch = globalThis.fetch;
globalThis.fetch = mock.fetch;

const { syncArticles, syncState, articleBody } = await import('../src/server/services/articles.ts');
const { updateSettings, notionConfig, siteProfile } = await import('../src/server/services/settings.ts');
const { articlesRepository } = await import('../src/server/db/articles.repository.ts');
const { connection, closeConnection } = await import('../src/server/db/connection.ts');
const { settingsRepository } = await import('../src/server/db/settings.repository.ts');
const other = 'fedcba9876543210fedcba9876543210';

test.after(() => {
  globalThis.fetch = originalFetch;
  closeConnection();
  rmSync(dir, { recursive: true, force: true });
});

function gateFirst(fragment) {
  let release, started;
  const wait = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  let blocked = false;
  globalThis.fetch = async (input, init) => {
    if (!blocked && String(input).includes(fragment)) {
      blocked = true;
      started();
      await wait;
    }
    // The second database exists but is empty, so the test can distinguish it.
    if (String(input).includes(`/databases/${other}/query`)) {
      return Response.json({ results: [], has_more: false, next_cursor: null });
    }
    return mock.fetch(input, init);
  };
  return { entered, release };
}

test('invalid settings leave every field and existing article cache unchanged', async () => {
  await syncArticles();
  const before = syncState();
  assert.throws(() => updateSettings({ site_name: 'Unexpected', NOTION_TOKEN: 'new-token', NOTION_DATABASE_ID: 'bad-id' }), /database id or link/);
  assert.equal(notionConfig().token, 'original-token');
  assert.equal(notionConfig().databaseId, DB);
  assert.equal(siteProfile().name, 'SureShot Studio');
  assert.equal(articlesRepository.count(), 3);
  assert.equal(syncState().syncedAt, before.syncedAt);
});

test('a SQL failure rolls back all settings', () => {
  connection().exec(`CREATE TRIGGER fail_settings BEFORE INSERT ON settings
    WHEN NEW.k = 'NOTION_DATABASE_ID' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try {
    assert.throws(() => updateSettings({ site_name: 'Unexpected', NOTION_TOKEN: 'new-token', NOTION_DATABASE_ID: other }), /test failure/);
    assert.equal(notionConfig().token, 'original-token');
    assert.equal(notionConfig().databaseId, DB);
    assert.equal(siteProfile().name, 'SureShot Studio');
    assert.equal(settingsRepository.get('site_name'), undefined);
    assert.equal(articlesRepository.count(), 3);
  } finally {
    connection().exec('DROP TRIGGER fail_settings');
  }
});

test('a failed cache reset also rolls back the new connection and sync metadata', () => {
  const before = syncState();
  connection().exec(`CREATE TRIGGER fail_article_clear BEFORE DELETE ON articles
    BEGIN SELECT RAISE(ABORT, 'clear failure'); END`);
  try {
    assert.throws(() => updateSettings({ NOTION_TOKEN: 'new-token', NOTION_DATABASE_ID: other }), /clear failure/);
    assert.equal(notionConfig().token, 'original-token');
    assert.equal(notionConfig().databaseId, DB);
    assert.equal(articlesRepository.count(), 3);
    assert.equal(syncState().syncedAt, before.syncedAt);
  } finally {
    connection().exec('DROP TRIGGER fail_article_clear');
  }
});

test('a pending old sync cannot publish or mark success after a database switch', async () => {
  const gate = gateFirst(`/databases/${DB}/query`);
  const old = syncArticles().then(() => null, (error) => error);
  await gate.entered;
  updateSettings({ NOTION_DATABASE_ID: other });
  assert.equal(articlesRepository.count(), 0);
  assert.equal(syncState().syncedAt, 0);
  const next = syncArticles();
  gate.release();
  assert.match((await old).message, /settings changed/);
  assert.equal(await next, 0, 'a new sync must query the new database');
  assert.equal(articlesRepository.count(), 0);
  assert.ok(syncState().syncedAt > 0);
  assert.equal(syncState().syncError, null);
  globalThis.fetch = mock.fetch;
});

test('late body fetches cannot return or register old database content', async () => {
  updateSettings({ NOTION_DATABASE_ID: '' });
  await syncArticles();
  const article = articlesRepository.all()[0];
  const gate = gateFirst(`/blocks/${article.id}/children`);
  const old = articleBody(article).then(() => null, (error) => error);
  await gate.entered;
  updateSettings({ NOTION_DATABASE_ID: other });
  gate.release();
  assert.match((await old).message, /settings changed/);
  assert.equal(articlesRepository.count(), 0);
  assert.deepEqual(articlesRepository.allMediaIds(), []);
  globalThis.fetch = mock.fetch;
});

test('a media download interrupted by a settings change cannot be served or reused', async () => {
  updateSettings({ NOTION_DATABASE_ID: '' });
  await syncArticles();
  const { notionMedia } = await import('../src/server/services/media.ts');
  const { notionGeneration } = await import('../src/server/services/settings.ts');
  const { readCached } = await import('../src/server/storage/notion-media.ts');
  const cover = articlesRepository.all().find((a) => a.cover?.startsWith('/media/notion/'));
  const id = cover.cover.split('/').pop();
  const previous = notionGeneration();
  let start, release;
  const entered = new Promise((resolve) => { start = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://files.test/')) {
      return new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          start();
          await wait;
          controller.enqueue(new Uint8Array([4, 5]));
          controller.close();
        },
      }), { headers: { 'content-type': 'image/png' } });
    }
    return mock.fetch(input, init);
  };
  const download = notionMedia(id).then(() => null, (error) => error);
  await entered;
  updateSettings({ NOTION_DATABASE_ID: other });
  const next = notionGeneration();
  assert.notEqual(previous, next);
  release();
  assert.match((await download).message, /settings changed/);
  assert.equal(await readCached(id, next), null);
  await assert.rejects(notionMedia(id), /not found/i);
  globalThis.fetch = mock.fetch;
});
