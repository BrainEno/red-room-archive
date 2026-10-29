// Separate Node process used by the shared-SQLite integration tests.
import { createNotionMock } from './notion-mock.mjs';
const mock = createNotionMock();
const mode = process.env.WORKER_MODE ?? 'sync';
let release;
const gate = new Promise((resolve) => { release = resolve; });
let blocked = false;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!blocked && (mode === 'sync' ? url.includes('/query') : url.startsWith('https://files.test/'))) {
    blocked = true;
    process.send({ type: 'waiting' });
    await gate;
  }
  return mock.fetch(input, init);
};
process.on('message', (message) => { if (message === 'release') release(); });
const { notionConfig } = await import('../../src/server/services/settings.ts');
try {
  if (mode === 'sync') {
    const { syncArticles } = await import('../../src/server/services/articles.ts');
    const count = await syncArticles();
    process.send({ type: 'result', count, databaseId: notionConfig().databaseId });
  } else {
    const { notionMedia } = await import('../../src/server/services/media.ts');
    await notionMedia(process.env.MEDIA_ID);
    process.send({ type: 'result', databaseId: notionConfig().databaseId });
  }
} catch (error) {
  process.send({ type: 'result', code: error.code, message: error.message, databaseId: notionConfig().databaseId });
}
process.disconnect();
