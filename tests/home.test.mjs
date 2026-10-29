// Home page limits and ordering against the actual article repository/facade.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.NOTION_TOKEN = 'local-test';
process.env.NOTION_DATABASE_ID = '0123456789abcdef0123456789abcdef';
const { articlesRepository } = await import('../src/server/db/articles.repository.ts');
const { metaRepository } = await import('../src/server/db/meta.repository.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');
const { featuredArticles } = await import('../src/server/services/articles.ts');
const { getHome } = await import('../src/server/queries.ts');
test.after(() => closeConnection());

const row = (n, rank = n) => ({
  id: String(n), slug: `article-${n}`, title: `Article ${n}`,
  date: `2020-01-${String(n).padStart(2, '0')}`, created: `2020-01-${String(n).padStart(2, '0')}T00:00:00Z`,
  tags: ['Fiction'], excerpt: '', cover: null, rank, updated: '2020-01-01T00:00:00Z',
});

test('home latest and featured cap at ten, with date and positive rank ordering', async () => {
  // Deliberately out of order; 0 and negative ranks must never be featured.
  const rows = Array.from({ length: 15 }, (_, i) => row(15 - i, i === 13 ? 0 : i === 14 ? -1 : i + 1));
  articlesRepository.replaceAll(rows, []);
  metaRepository.set('synced', String(Date.now()));
  const home = await getHome('en');
  assert.equal(home.total, 15);
  assert.deepEqual(home.latest.map((article) => article.slug), Array.from({ length: 10 }, (_, i) => `article-${15 - i}`));
  assert.deepEqual(home.featured.map((article) => article.rank), [13, 12, 11, 10, 9, 8, 7, 6, 5, 4]);
  assert.deepEqual(home.featured.map((article) => article.slug), Array.from({ length: 10 }, (_, i) => `article-${i + 3}`), 'rank order differs from date order');
  assert.equal(featuredArticles(rows).length, 10);
  const fewer = featuredArticles([row(1, 0), row(2, -1), row(3, 2), row(4, 2), row(5, 1)]);
  assert.deepEqual(fewer.map((article) => article.slug), ['article-4', 'article-3', 'article-5'], 'ties use newest date');
  assert.deepEqual(featuredArticles([row(1, 0), row(2, -1)]), []);
});
