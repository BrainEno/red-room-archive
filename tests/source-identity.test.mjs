import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB, createNotionMock } from './fixtures/notion-mock.mjs';
const dir = mkdtempSync(path.join(tmpdir(), 'rra-source-'));
process.env.DB_PATH = path.join(dir, 'archive.db');
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.NOTION_API_BASE = API;
process.env.NOTION_TOKEN = 'secret-original-token';
process.env.NOTION_DATABASE_ID = DB;
const mock = createNotionMock(), oldFetch = globalThis.fetch;
globalThis.fetch = mock.fetch;
const { syncArticles, syncState, findArticle } = await import('../src/server/services/articles.ts');
const { notionGeneration } = await import('../src/server/services/settings.ts');
const { articlesRepository } = await import('../src/server/db/articles.repository.ts');
const { connection, closeConnection } = await import('../src/server/db/connection.ts');
test.after(() => { globalThis.fetch = oldFetch; closeConnection(); rmSync(dir, { recursive: true, force: true }); });

test('source identity survives restart; changed environment invalidates prior cache and generation', async () => {
  await syncArticles();
  assert.equal(articlesRepository.count(), 3);
  const before = notionGeneration();
  const values = connection().prepare("SELECT v FROM meta WHERE k LIKE 'notion_source_%'").all();
  assert.doesNotMatch(JSON.stringify(values), /secret-original-token/);
  closeConnection();
  assert.equal(notionGeneration(), before, 'same source retains cached data after restart');
  assert.equal(articlesRepository.count(), 3);
  process.env.NOTION_TOKEN = 'new-secret-token';
  assert.notEqual(notionGeneration(), before);
  assert.equal(articlesRepository.count(), 0);
  assert.equal(syncState().syncedAt, 0);
  process.env.NOTION_TOKEN = 'secret-original-token';
  await syncArticles();
  process.env.NOTION_DATABASE_ID = 'fedcba9876543210fedcba9876543210';
  mock.state.offline = true;
  assert.equal(await findArticle('first-light'), undefined, 'old-source cache is not an offline fallback');
  mock.state.offline = false;
  process.env.NOTION_DATABASE_ID = DB;
});

test('an in-flight sync cannot commit after environment credentials change', async () => {
  await syncArticles();
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/query')) { entered(); await wait; }
    return mock.fetch(input, init);
  };
  try {
    const pending = syncArticles().then(() => null, (error) => error);
    await started;
    process.env.NOTION_TOKEN = 'changed-during-sync';
    notionGeneration();
    release();
    assert.equal((await pending).code, 'conflict');
    assert.equal(articlesRepository.count(), 0);
    assert.equal(syncState().syncedAt, 0);
  } finally { process.env.NOTION_TOKEN = 'secret-original-token'; globalThis.fetch = mock.fetch; release(); }
});

test('same-source offline failure retains the last trusted snapshot', async () => {
  await syncArticles();
  mock.state.offline = true;
  try {
    await assert.rejects(syncArticles());
    assert.ok(await findArticle('first-light'));
    assert.equal(articlesRepository.count(), 3);
  } finally { mock.state.offline = false; }
});

test('a successful sync removes articles if Published is missing or unrecognized', async () => {
  await syncArticles();
  assert.equal(articlesRepository.count(), 3);
  for (const page of mock.state.pages) delete page.properties.Published;
  await syncArticles();
  assert.equal(articlesRepository.count(), 0);
});
