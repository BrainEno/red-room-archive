import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { API, DB, FILES, ID, compact, createNotionMock } from '../fixtures/notion-mock.mjs';

async function run(env) {
  const child = spawn(process.execPath, ['scripts/static-snapshot.mjs'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (d) => { output += d; }); child.stderr.on('data', (d) => { output += d; });
  const [code] = await once(child, 'exit');
  return { code, output };
}

test('static snapshot exports only published Notion content, media and bilingual navigation; fails closed', async () => {
  const mock = createNotionMock();
  for (const page of mock.state.pages) if (page.properties.Date.date?.start.startsWith('2026')) page.properties.Date.date.start = page.properties.Date.date.start.replace('2026', '2020');
  // A malformed row without the publication property must never be exported,
  // even if the database schema itself has a valid Published column.
  delete mock.state.pages.find((page) => page.id === ID.draft).properties.Published;
  // Exercise pagination and feed limits independently from the home page's 10-item limit.
  for (let i = 0; i < 22; i++) {
    const page = structuredClone(mock.state.pages[0]);
    page.id = `${(i + 100).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
    page.properties.Page.title[0].plain_text = `Extra ${i}`;
    page.properties.Page.title[0].text.content = `Extra ${i}`;
    page.properties.Slug.rich_text[0].plain_text = `extra-${i}`;
    page.properties.Slug.rich_text[0].text.content = `extra-${i}`;
    page.properties.FeaturedImage.files = [];
    if (i === 0) page.properties.Tags.multi_select.push({ name: '../unsafe' });
    mock.state.pages.push(page);
    mock.state.blocks[compact(page.id)] = [{ object: 'block', id: `extra-block-${i}`, type: 'paragraph', has_children: false, paragraph: { rich_text: [{ type: 'text', plain_text: 'Unique searchable text', text: { content: 'Unique searchable text' }, annotations: {} }] } }];
  }
  let base;
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const target = req.url.startsWith('/files/') ? `${FILES}${req.url.slice(6)}` : `${API}${req.url.replace(/^\/v1/, '')}`;
      const response = await mock.fetch(target, { method: req.method, body: Buffer.concat(chunks).toString() || undefined });
      const type = response.headers.get('content-type') || '';
      const bytes = type.includes('json') ? JSON.stringify(await response.json()).replaceAll(FILES, `${base}/files`) : Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, { 'content-type': type }); res.end(bytes);
    } catch { res.writeHead(500); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  const env = { SITE_URL: 'https://archive.test', NOTION_TOKEN: 'never-publish-this-secret', NOTION_DATABASE_ID: DB, NOTION_API_BASE: `${base}/v1`, STATIC_DEMO: '' };
  try {
    const result = await run(env); assert.equal(result.code, 0, result.output);
    const read = (file) => readFile(path.join('static-dist', file), 'utf8');
    const en = await read('articles/first-light/index.html');
    const zh = await read('zh-CN/articles/first-light/index.html');
    assert.match(en, /light through the curtain/); assert.match(zh, /lang="zh-CN"/);
    assert.match(zh, /href="\/zh-CN\/articles"/);
    assert.match(en, /\/media\/notion\/[0-9a-f]+\.png/);
    const mediaPath = en.match(/\/media\/notion\/[0-9a-f]+\.png/)[0];
    assert.ok((await readFile(path.join('static-dist', mediaPath))).length > 100);
    assert.match(await read('zh-CN/search/index.html'), /action="\/zh-CN\/search"/);
    assert.match(await read('articles/page/2/index.html'), /article-entry/);
    const topic = (key) => 't-' + createHash('sha256').update(key).digest('hex');
    assert.match(await read(`topics/${topic('fiction')}/page/2/index.html`), /article-entry/);
    assert.match(await read(`topics/${topic('../unsafe')}/index.html`), /Extra 0/);
    assert.match(await read('index.html'), /id="home"/);
    const rss = await read('rss.xml'); assert.equal((rss.match(/<item>/g) || []).length, 25);
    assert.match(await read('sitemap.xml'), /\/articles\/extra-0/);
    const index = await read('static-search.json');
    assert.match(index, /Unique searchable text/); assert.doesNotMatch(index, /never-publish-this-secret|SECRET child page content/);
    await assert.rejects(access('static-dist/articles/draft/index.html'));
    await assert.rejects(access('static-dist/admin/index.html'));
    // A deeply nested article must abort the snapshot, not publish a partial body.
    const originalBlocks = mock.state.blocks[compact(ID.first)];
    mock.state.blocks[compact(ID.first)] = [{ id: 'depth0', type: 'toggle', has_children: true, toggle: { rich_text: [] } }];
    for (let i = 0; i < 9; i++) mock.state.blocks[`depth${i}`] = [{ id: `depth${i + 1}`, type: 'toggle', has_children: true, toggle: { rich_text: [] } }];
    const incomplete = await run(env);
    assert.notEqual(incomplete.code, 0); assert.match(incomplete.output, /Snapshot request failed/);
    await assert.rejects(access('static-dist/index.html'));
    mock.state.blocks[compact(ID.first)] = originalBlocks;
    for (let i = 0; i < 9; i++) delete mock.state.blocks[`depth${i}`];
    // Losing the publication column must fail the build, not expose every row.
    delete mock.state.pages[0].properties.Published;
    const unsafe = await run(env);
    assert.notEqual(unsafe.code, 0); assert.match(unsafe.output, /Published column/);
    await assert.rejects(access('static-dist/index.html'));
  } finally { server.close(); await once(server, 'close'); }
});

test('Netlify falls back to its primary URL without weakening static build validation', async () => {
  const env = { NETLIFY: 'true', URL: 'https://primary.netlify.app/', DEPLOY_PRIME_URL: 'https://preview.netlify.app',
    SITE_URL: '', STATIC_DEMO: '1', NOTION_TOKEN: '', NOTION_API_SECRET: '', NOTION_DATABASE_ID: '', DATABASE_ID: '', NOTION_DB_WRITING: '' };
  const read = (file) => readFile(path.join('static-dist', file), 'utf8');

  let result = await run(env);
  assert.equal(result.code, 0, result.output);
  assert.match(await read('articles/index.html'), /rel="canonical" href="https:\/\/primary\.netlify\.app\/articles"/);
  assert.match(await read('sitemap.xml'), /https:\/\/primary\.netlify\.app\//);
  assert.match(await read('rss.xml'), /https:\/\/primary\.netlify\.app\//);
  assert.match(await read('robots.txt'), /Sitemap: https:\/\/primary\.netlify\.app\/sitemap\.xml/);
  assert.doesNotMatch(await read('sitemap.xml'), /preview\.netlify\.app/);

  result = await run({ ...env, SITE_URL: 'https://custom.example' });
  assert.equal(result.code, 0, result.output);
  assert.match(await read('sitemap.xml'), /https:\/\/custom\.example\//);
  assert.match(await read('articles/index.html'), /rel="canonical" href="https:\/\/custom\.example\/articles"/);

  result = await run({ ...env, SITE_URL: 'https://custom.example/path' });
  assert.notEqual(result.code, 0); assert.match(result.output, /SITE_URL must be a plain HTTP\(S\) origin/);
  await assert.rejects(access('static-dist/index.html'));

  result = await run({ ...env, NETLIFY: '' });
  assert.notEqual(result.code, 0); assert.match(result.output, /Set SITE_URL/);
  await assert.rejects(access('static-dist/index.html'));

  result = await run({ ...env, URL: '' });
  assert.notEqual(result.code, 0); assert.match(result.output, /Set SITE_URL/);
  await assert.rejects(access('static-dist/index.html'));

  result = await run({ ...env, STATIC_DEMO: '' });
  assert.notEqual(result.code, 0); assert.match(result.output, /Set NOTION_TOKEN and NOTION_DATABASE_ID/);
  await assert.rejects(access('static-dist/index.html'));
});
