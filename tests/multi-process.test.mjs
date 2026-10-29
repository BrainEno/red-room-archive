import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB } from './fixtures/notion-mock.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-workers-'));
process.env.DB_PATH = path.join(dir, 'archive.db');
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.NOTION_TOKEN = 'original-token';
process.env.NOTION_DATABASE_ID = DB;
process.env.NOTION_API_BASE = API;
const { updateSettings, notionGeneration } = await import('../src/server/services/settings.ts');
const { articlesRepository } = await import('../src/server/db/articles.repository.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');

test.after(() => { closeConnection(); rmSync(dir, { recursive: true, force: true }); });

test('another process cannot commit a sync started before the database switch', async () => {
  const oldGeneration = notionGeneration();
  const worker = fork(new URL('./fixtures/sync-worker.mjs', import.meta.url), [], {
    env: process.env,
    execArgv: ['--experimental-strip-types', '--no-warnings'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  try {
    const [waiting] = await once(worker, 'message');
    assert.equal(waiting.type, 'waiting');
    const result = once(worker, 'message');
    const other = 'fedcba9876543210fedcba9876543210';
    updateSettings({ NOTION_DATABASE_ID: other });
    assert.notEqual(notionGeneration(), oldGeneration);
    worker.send('release');
    const [message] = await result;
    assert.equal(message.type, 'result');
    assert.equal(message.code, 'conflict');
    assert.equal(message.databaseId, other, 'worker sees the new settings');
    assert.equal(articlesRepository.count(), 0);
  } finally {
    if (worker.exitCode === null) worker.kill();
  }
});

test('another process cannot complete an old media download after the switch', async () => {
  const { createNotionMock } = await import('./fixtures/notion-mock.mjs');
  const { syncArticles } = await import('../src/server/services/articles.ts');
  updateSettings({ NOTION_DATABASE_ID: '' });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = createNotionMock().fetch;
  let worker;
  try {
    await syncArticles();
    const cover = articlesRepository.all().find((a) => a.cover?.startsWith('/media/notion/'));
    const mediaId = cover.cover.split('/').pop();
    worker = fork(new URL('./fixtures/sync-worker.mjs', import.meta.url), [], {
      env: { ...process.env, WORKER_MODE: 'media', MEDIA_ID: mediaId },
      execArgv: ['--experimental-strip-types', '--no-warnings'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const [waiting] = await once(worker, 'message');
    assert.equal(waiting.type, 'waiting');
    const result = once(worker, 'message');
    const other = 'fedcba9876543210fedcba9876543210';
    updateSettings({ NOTION_DATABASE_ID: other });
    worker.send('release');
    const [message] = await result;
    assert.equal(message.code, 'conflict');
    assert.equal(message.databaseId, other);
    assert.equal(articlesRepository.count(), 0);
    const { readCached } = await import('../src/server/storage/notion-media.ts');
    assert.equal(await readCached(mediaId, notionGeneration()), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (worker && worker.exitCode === null) worker.kill();
  }
});
