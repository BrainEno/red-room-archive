// Bookmark previews: the guarded fetch (against a loopback test server), the
// SQLite cache rules and the article body integration. No real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB, ID, compact, createNotionMock } from './fixtures/notion-mock.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-preview-'));
process.env.DB_PATH = ':memory:';
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.NOTION_TOKEN = 'secret_env_token';
process.env.NOTION_DATABASE_ID = DB;
process.env.NOTION_API_BASE = API;
delete process.env.LINK_PREVIEWS;
const mock = createNotionMock();
const realFetch = globalThis.fetch;
globalThis.fetch = mock.fetch;

const { fetchLinkPreview, linkPreviews, setLinkPreviewFetcher } = await import('../src/server/services/link-preview.ts');
const { linkPreviewsRepository } = await import('../src/server/db/link-previews.repository.ts');
const { syncArticles, articleBody, findArticle } = await import('../src/server/services/articles.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');
const { BlockedUrlError, fetchPublicHtml } = await import('../src/server/net/safe-fetch.ts');

/* ── loopback test server ──────────────────────────────────────────── */

const page = (head) => `<!doctype html><html><head>${head}</head><body>${'<p>filler</p>'.repeat(50)}</body></html>`;
const server = http.createServer((request, response) => {
  const html = (body, headers = {}) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers });
    response.end(body);
  };
  switch (request.url) {
    case '/og': return html(page('<title>Plain</title><meta property="og:title" content="OG Title"><meta property="og:description" content="Desc"><meta property="og:site_name" content="Loop">'));
    case '/redirect': response.writeHead(302, { location: '/og' }); return response.end();
    case '/to-private': response.writeHead(301, { location: 'http://127.0.0.1/og' }); return response.end();
    case '/loop': response.writeHead(302, { location: '/loop' }); return response.end();
    case '/gzip':
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      return response.end(zlib.gzipSync(page('<title>Zipped</title>')));
    case '/gbk':
      response.writeHead(200, { 'content-type': 'text/html; charset=gbk' });
      return response.end(Buffer.concat([Buffer.from('<html><head><title>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('</title></head></html>')]));
    case '/json': response.writeHead(200, { 'content-type': 'application/json' }); return response.end('{"title":"no"}');
    case '/missing': response.writeHead(404, { 'content-type': 'text/html' }); return response.end('<title>Not found</title>');
    case '/huge': {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<html><head><title>Huge</title></head><body>');
      const chunk = 'x'.repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 64 && response.write(chunk)) sent++;
        if (sent < 64) response.once('drain', pump);
        else response.end();
      };
      return pump();
    }
    case '/slow': return setTimeout(() => html(page('<title>Too late</title>')), 2000);
    default: response.writeHead(404); return response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const loopback = (hostname, options, callback) => callback(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
/** What the test server needs: a fake DNS answer and permission to reach loopback. */
const viaTestServer = { lookup: loopback, allowAddress: () => true, testPort: port, timeoutMs: 1000 };

test.after(() => {
  globalThis.fetch = realFetch;
  server.close();
  closeConnection();
  rmSync(dir, { recursive: true, force: true });
});

test('previews are read from the page head, through redirects, gzip and declared charsets', async () => {
  assert.deepEqual(await fetchLinkPreview('http://site.test/og', viaTestServer), { title: 'OG Title', description: 'Desc', site: 'Loop' });
  assert.equal((await fetchLinkPreview('http://site.test/redirect', viaTestServer))?.title, 'OG Title');
  assert.equal((await fetchLinkPreview('http://site.test/gzip', viaTestServer))?.title, 'Zipped');
  assert.equal((await fetchLinkPreview('http://site.test/gbk', viaTestServer))?.title, '中文');
  assert.equal((await fetchLinkPreview('http://site.test/huge', { ...viaTestServer, maxBytes: 32 * 1024 }))?.title, 'Huge', 'stops reading after maxBytes');
});

test('non-HTML, errors, redirect loops and slow servers give no preview', async () => {
  assert.equal(await fetchLinkPreview('http://site.test/json', viaTestServer), null);
  assert.equal(await fetchLinkPreview('http://site.test/missing', viaTestServer), null);
  assert.equal(await fetchLinkPreview('http://site.test/loop', viaTestServer), null);
  const started = Date.now();
  assert.equal(await fetchLinkPreview('http://site.test/slow', { ...viaTestServer, timeoutMs: 200 }), null);
  assert.ok(Date.now() - started < 1500, 'one deadline for the whole fetch');
});

test('the guard refuses private targets: by name, by DNS answer and by redirect', async () => {
  // Default guard + a hostname that resolves to loopback (DNS rebinding style).
  assert.equal(await fetchLinkPreview('http://rebind.test/og', { lookup: loopback, testPort: port, timeoutMs: 1000 }), null);
  await assert.rejects(fetchPublicHtml('http://rebind.test/og', { lookup: loopback, testPort: port, timeoutMs: 1000 }), BlockedUrlError);
  await assert.rejects(fetchPublicHtml('http://site.test/to-private', viaTestServer), BlockedUrlError);
  // A public page redirecting to a private address.
  assert.equal(await fetchLinkPreview('http://site.test/to-private', viaTestServer), null);
  assert.equal(await fetchLinkPreview('http://localhost/og'), null);
  assert.equal(await fetchLinkPreview('http://169.254.169.254/latest/meta-data/'), null);
});

/* ── cache rules ───────────────────────────────────────────────────── */

test('previews are cached; failures retry later and keep the last good copy', async () => {
  const calls = [];
  let answer = { title: 'Fresh', description: 'd', site: 's' };
  setLinkPreviewFetcher(async (url) => (calls.push(url), answer));
  try {
    const url = 'https://cache.example/a';
    assert.deepEqual([...(await linkPreviews([url, url]))], [[url, answer]], 'deduplicated');
    assert.equal(calls.length, 1);
    await linkPreviews([url]);
    assert.equal(calls.length, 1, 'served from the cache');

    // 15 days later the preview is refreshed; the page is down now.
    const [row] = linkPreviewsRepository.many([url]);
    linkPreviewsRepository.save({ ...row, fetched_at: Date.now() - 15 * 86_400_000 });
    answer = null;
    assert.equal((await linkPreviews([url])).get(url)?.title, 'Fresh', 'a failed refresh keeps the last good preview');
    assert.equal(calls.length, 2);
    await linkPreviews([url]);
    assert.equal(calls.length, 2, 'and is not retried on every render');

    // A page that never had a preview is retried after a day, not before.
    const broken = 'https://cache.example/broken';
    assert.equal((await linkPreviews([broken])).has(broken), false);
    await linkPreviews([broken]);
    assert.equal(calls.filter((u) => u === broken).length, 1);
    const [failed] = linkPreviewsRepository.many([broken]);
    assert.equal(failed.ok, 0);
    linkPreviewsRepository.save({ ...failed, fetched_at: Date.now() - 2 * 86_400_000 });
    answer = { title: 'Back', description: '', site: '' };
    assert.equal((await linkPreviews([broken])).get(broken)?.title, 'Back');
  } finally {
    setLinkPreviewFetcher(null);
  }
});

test('at most four pages are fetched at once; LINK_PREVIEWS=off disables fetching', async () => {
  let active = 0;
  let peak = 0;
  setLinkPreviewFetcher(async (url) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active--;
    return { title: url, description: '', site: '' };
  });
  try {
    const urls = Array.from({ length: 10 }, (_, i) => `https://many.example/${i}`);
    assert.equal((await linkPreviews(urls)).size, 10);
    assert.equal(peak, 4);

    process.env.LINK_PREVIEWS = 'off';
    let called = false;
    setLinkPreviewFetcher(async () => ((called = true), null));
    assert.equal((await linkPreviews(['https://off.example/'])).size, 0);
    assert.equal(called, false);
  } finally {
    delete process.env.LINK_PREVIEWS;
    setLinkPreviewFetcher(null);
  }
});

/* ── article bodies ────────────────────────────────────────────────── */

test('bookmark previews are looked up while a body renders and stored with it', async () => {
  const seen = [];
  setLinkPreviewFetcher(async (url) => (seen.push(url), { title: 'Linked essay', description: 'What it is about', site: 'Elsewhere' }));
  try {
    await syncArticles();
    mock.state.blocks[compact(ID.first)].push({ id: 'bm1', type: 'bookmark', has_children: false, bookmark: { url: 'https://elsewhere.example/essay', caption: [] } });
    const article = await findArticle('first-light');
    const body = await articleBody(article, { refresh: true });
    assert.deepEqual(seen, ['https://elsewhere.example/essay']);
    assert.match(body.html, /<a class="bookmark has-preview" href="https:\/\/elsewhere\.example\/essay"[^>]*><span class="bookmark-title">Linked essay<\/span><span class="bookmark-desc">What it is about<\/span><span class="bookmark-url">Elsewhere<\/span><\/a>/);
    await articleBody(article);
    assert.equal(seen.length, 1, 'cached bodies never fetch again');
  } finally {
    setLinkPreviewFetcher(null);
  }
});
