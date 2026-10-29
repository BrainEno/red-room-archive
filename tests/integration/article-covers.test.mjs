// Exercise the built SSR pages against a local Notion mock, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB, FILES, ID, compact, createNotionMock } from '../fixtures/notion-mock.mjs';

const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const ready = (child) => new Promise((resolve, reject) => {
  let log = '';
  const timer = setTimeout(() => done(new Error(`Server startup timed out: ${log}`)), 20000);
  function done(error) {
    clearTimeout(timer);
    child.stdout.off('data', onData);
    child.stderr.off('data', onData);
    child.off('exit', onExit);
    error ? reject(error) : resolve();
  }
  function onData(chunk) { log += chunk; if (log.includes('Server listening')) done(); }
  function onExit(code) { done(new Error(`Server exited (${code}): ${log}`)); }
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', onExit);
});
const entry = (html, href) => [...html.matchAll(/<a class="article-entry[^>]*>[\s\S]*?<\/a>/g)]
  .map((match) => match[0]).find((row) => row.includes(`href="${href}"`));

test('covered and text-only articles render correctly in the built site', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rra-cover-render-'));
  const mock = createNotionMock();
  // Keep the fixture publish dates in the past regardless of the test clock.
  for (const page of mock.state.pages) {
    const date = page.properties.Date.date;
    if (date && date.start.startsWith('2026')) date.start = date.start.replace('2026', '2020');
  }
  const textOnly = mock.state.pages.find((page) => page.id === ID.twin);
  textOnly.properties.Slug.rich_text = [{ plain_text: 'text-only', text: { content: 'text-only' } }];
  textOnly.properties.Page.title = [{ plain_text: '无图文章 <notes>', text: { content: '无图文章 <notes>' } }];
  textOnly.properties.Excerpt.rich_text = [{ plain_text: '摘要 & words', text: { content: '摘要 & words' } }];
  textOnly.properties.Tags.multi_select = [{ name: '小说' }];
  const noSummary = structuredClone(textOnly);
  noSummary.id = '77777777-7777-4777-8777-777777777777';
  noSummary.properties.Slug.rich_text = [{ plain_text: 'no-summary', text: { content: 'no-summary' } }];
  noSummary.properties.Page.title = [{ plain_text: 'LongUnbrokenEnglishTitle'.repeat(8), text: { content: 'LongUnbrokenEnglishTitle'.repeat(8) } }];
  noSummary.properties.Excerpt.rich_text = [];
  noSummary.properties.Tags.multi_select = [];
  mock.state.pages.push(noSummary);
  mock.state.blocks[compact(ID.twin)] = [{ object: 'block', id: 'text', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ type: 'text', plain_text: 'A text-only body.', text: { content: 'A text-only body.' }, annotations: {} }] } }];
  const notion = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const target = req.url.startsWith('/files/') ? `${FILES}${req.url.slice(6)}` : `${API}${req.url.replace(/^\/v1/, '')}`;
    const response = await mock.fetch(target, { method: req.method, body: Buffer.concat(chunks).toString() || undefined });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  let child;
  try {
    const notionPort = await listen(notion);
    const reservation = createTcpServer();
    const port = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    child = spawn(process.execPath, ['dist/server/entry.mjs'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(dir, 'site.db'),
        MEDIA_CACHE_DIR: path.join(dir, 'media'), UPLOAD_DIR: path.join(dir, 'uploads'),
        NOTION_TOKEN: 'mock-token', NOTION_DATABASE_ID: DB, NOTION_API_BASE: `http://127.0.0.1:${notionPort}/v1`, SITE_URL: 'https://archive.test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await ready(child);
    const get = async (url) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`);
      assert.equal(response.status, 200, url);
      return response.text();
    };
    const listing = await get('/articles?lang=zh-CN');
    const plain = entry(listing, '/articles/text-only');
    const covered = entry(listing, '/articles/first-light');
    assert.ok(plain && covered, 'both kinds of entry appear together');
    assert.doesNotMatch(plain, /has-cover|article-cover|<img/);
    assert.match(plain, /无图文章 &lt;notes&gt;/);
    assert.match(plain, /摘要 &amp; words/);
    assert.match(plain, /article-date/);
    assert.match(plain, /article-tags/);
    assert.match(plain, /article-arrow/);
    assert.match(covered, /has-cover/);
    assert.match(covered, /<img class="article-cover"[^>]*alt=""/);
    assert.match(covered, /article-arrow/);
    const minimal = entry(listing, '/articles/no-summary');
    assert.ok(minimal);
    assert.doesNotMatch(minimal, /article-excerpt|article-tags|article-cover/);
    assert.match(minimal, /LongUnbrokenEnglishTitle/);
    assert.match(minimal, /article-arrow/);
    const search = await get('/search?q=%E6%97%A0%E5%9B%BE');
    assert.match(entry(search, '/articles/text-only'), /article-arrow/);
    const detail = await get('/articles/text-only');
    assert.match(detail, /class="article-body text-only"/);
    assert.match(detail, /A text-only body/);
    assert.doesNotMatch(detail, /<img class="cover"|property="og:image"/);
    assert.match(detail, /name="twitter:card" content="summary"/);
    const coveredDetail = await get('/articles/first-light');
    assert.match(coveredDetail, /<img class="cover"/);
    assert.match(coveredDetail, /property="og:image"/);
    assert.doesNotMatch(coveredDetail, /article-body text-only/);
    const rss = await get('/rss.xml');
    const rssItems = [...rss.matchAll(/<item>[\s\S]*?<\/item>/g)].map((match) => match[0]);
    const plainItem = rssItems.find((item) => item.includes('/articles/text-only'));
    const coveredItem = rssItems.find((item) => item.includes('/articles/first-light'));
    assert.ok(plainItem && coveredItem);
    assert.doesNotMatch(plainItem, /<enclosure/);
    assert.match(coveredItem, /<enclosure/);
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await new Promise((resolve) => notion.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
