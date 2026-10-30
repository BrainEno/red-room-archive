import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
process.env.NOTION_TOKEN = 'new-token';
process.env.NOTION_DATABASE_ID = '0123456789abcdef0123456789abcdef';
const { articlesRepository } = await import('../src/server/db/articles.repository.ts');
const { metaRepository } = await import('../src/server/db/meta.repository.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');
const { notionGeneration } = await import('../src/server/services/settings.ts');
test.after(() => closeConnection());
test('upgrading an unassociated legacy cache discards it before it can be trusted', () => {
  articlesRepository.replaceAll([{ id: 'old', slug: 'old', title: 'private', date: '2020-01-01', created: '2020-01-01', tags: [], excerpt: '', cover: null, rank: 0, updated: '2020-01-01' }], []);
  metaRepository.set('synced', String(Date.now()));
  assert.equal(articlesRepository.count(), 1);
  notionGeneration();
  assert.equal(articlesRepository.count(), 0);
  assert.equal(metaRepository.get('synced'), undefined);
});
