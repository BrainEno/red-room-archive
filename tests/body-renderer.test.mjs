import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { API, DB, ID, compact, createNotionMock } from './fixtures/notion-mock.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-render-version-'));
process.env.DB_PATH = path.join(dir, 'site.db');
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.NOTION_TOKEN = 'test-token';
process.env.NOTION_DATABASE_ID = DB;
process.env.NOTION_API_BASE = API;
const mock = createNotionMock();
const originalFetch = globalThis.fetch;
globalThis.fetch = mock.fetch;
const { syncArticles, articleBody, findArticle } = await import('../src/server/services/articles.ts');
const { articlesRepository } = await import('../src/server/db/articles.repository.ts');
const { closeConnection, connection } = await import('../src/server/db/connection.ts');
test.after(() => { globalThis.fetch = originalFetch; closeConnection(); rmSync(dir, { recursive: true, force: true }); });

test('renderer upgrade lazily rerenders old HTML and retains it as an offline fallback', async () => {
  await syncArticles();
  const article = await findArticle('first-light');
  assert.ok(article);
  articlesRepository.saveBody(article.id, { html: '<p>Old cached body</p>', text: 'Old cached body', toc: [], updated: article.updated });
  // Simulate the exact pre-upgrade schema with existing cached article data.
  connection().exec('ALTER TABLE articles DROP COLUMN body_renderer_version; PRAGMA user_version = 8');
  closeConnection();
  assert.equal(articlesRepository.bodyTexts().get(article.id), 'Old cached body', 'migration keeps cached search text');
  mock.state.blocks[compact(ID.first)].push({ type: 'paragraph', id: 'blank', paragraph: { rich_text: [] } });
  mock.state.offline = true;
  try {
    assert.match((await articleBody(article)).html, /Old cached body/, 'old copy remains available offline');
    assert.equal(articlesRepository.body(article.id, { rendererVersion: 3 }), undefined, 'old renderer version is stale');
    assert.equal(articlesRepository.bodyTexts().get(article.id), 'Old cached body', 'search text survives a renderer upgrade');
  } finally { mock.state.offline = false; }
  const refreshed = await articleBody(article);
  assert.match(refreshed.html, /notion-blank-line/);
  assert.doesNotMatch(refreshed.html, /Old cached body/);
  assert.equal(articlesRepository.body(article.id, { rendererVersion: 4 }).html, refreshed.html);
});

test('failed tree fetch never replaces the same-source stale body', async () => {
  const article = await findArticle('first-light');
  const old = articlesRepository.body(article.id, { allowStale: true });
  const original = mock.state.blocks[compact(ID.first)];
  mock.state.blocks[compact(ID.first)] = [{ id: 'depth0', type: 'toggle', has_children: true, toggle: { rich_text: [] } }];
  for (let i = 0; i < 9; i++) mock.state.blocks[`depth${i}`] = [{ id: `depth${i + 1}`, type: 'toggle', has_children: true, toggle: { rich_text: [] } }];
  try {
    assert.deepEqual(await articleBody(article, { refresh: true }), old);
    assert.deepEqual(articlesRepository.body(article.id, { allowStale: true }), old);
    const noCache = await findArticle('第二篇');
    const other = mock.state.blocks[compact(ID.second)];
    mock.state.blocks[compact(ID.second)] = mock.state.blocks[compact(ID.first)];
    try { await assert.rejects(articleBody(noCache), /nesting depth limit/); }
    finally { mock.state.blocks[compact(ID.second)] = other; }
  } finally {
    mock.state.blocks[compact(ID.first)] = original;
    for (let i = 0; i < 9; i++) delete mock.state.blocks[`depth${i}`];
  }
});
