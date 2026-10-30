import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { makeProfile, PROFILE_KEYS } from '../../public/profile-format.js';
import path from 'node:path';
import { API, DB, FILES, ID, compact, createNotionMock } from '../fixtures/notion-mock.mjs';

async function run(env) {
  const child = spawn(process.execPath, ['scripts/static-snapshot.mjs'], { env: { ...process.env, SITE_PROFILE_PATH: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const env = { NETLIFY: 'true', CONTEXT: 'production', SITE_URL: 'https://archive.test', NOTION_TOKEN: 'never-publish-this-secret', NOTION_DATABASE_ID: DB, NOTION_API_BASE: `${base}/v1`, STATIC_DEMO: '' };
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
    assert.match(await read('topics/fiction/page/2/index.html'), /article-entry/);
    assert.match(await read('zh-CN/topics/fiction/index.html'), /href="\/zh-CN\/topics\/fiction\/page\/2"/);
    // Tags are arbitrary user input: the slug keeps letters and digits only.
    assert.match(await read('topics/unsafe/index.html'), /Extra 0/);
    assert.match(await read('topics/index.html'), /href="\/topics\/fiction"/);
    assert.match(await read('zh-CN/archive/index.html'), /href="\/zh-CN\/articles\/extra-0"/);
    const switcher = await read('zh-CN/articles/page/2/index.html');
    assert.match(switcher, /href="\/articles\/page\/2" hreflang="en"/);
    assert.doesNotMatch(switcher, /\?lang=/, 'a static host cannot remember ?lang=');
    assert.match(switcher, /rel="canonical" href="https:\/\/archive\.test\/zh-CN\/articles\/page\/2"/);
    const home = await read('index.html');
    assert.match(home, /id="home"/);
    // Share cards and structured data (SITE_URL is set, so URLs are absolute).
    assert.match(home, /<meta property="og:image" content="https:\/\/archive\.test\/og\/card\.jpg">/);
    assert.match(home, /<meta property="og:image:width" content="1200">/);
    const ld = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1]);
    assert.equal(ld(home)['@type'], 'WebSite');
    assert.equal(ld(home).potentialAction.target.urlTemplate, 'https://archive.test/search?q={search_term_string}');
    const graph = ld(en)['@graph'];
    assert.deepEqual(graph.map((item) => item['@type']), ['BlogPosting', 'BreadcrumbList']);
    assert.equal(graph[0].url, 'https://archive.test/articles/first-light');
    assert.match(en, /<meta property="article:published_time" content="[^"]+">/);
    assert.match(en, /<meta property="og:locale:alternate" content="zh_CN">/);
    assert.equal(ld(await read('topics/fiction/index.html'))['@type'], 'BreadcrumbList');
    assert.match(home, /href="\/articles\/extra-0"/);
    assert.match(home, /Extra 0/);
    assert.doesNotMatch(home, /data-demo-preview|href="\/articles\/connect-notion"|href="\/articles\/draft"/);
    const rss = await read('rss.xml'); assert.equal((rss.match(/<item>/g) || []).length, 25);
    assert.match(await read('sitemap.xml'), /\/articles\/extra-0/);
    const index = await read('static-search.json');
    assert.match(index, /Unique searchable text/); assert.doesNotMatch(index, /never-publish-this-secret|SECRET child page content/);
    await assert.rejects(access('static-dist/articles/draft/index.html'));
    await assert.rejects(access('static-dist/admin/index.html'));
    // Configured previews use the actual Notion mock rather than falling back to demo.
    const preview = await run({ ...env, CONTEXT: 'deploy-preview' });
    assert.equal(preview.code, 0, preview.output);
    assert.match(await read('index.html'), /href="\/articles\/extra-0"/);
    assert.doesNotMatch(await read('index.html'), /data-demo-preview|href="\/articles\/connect-notion"/);
    assert.match(await read('articles/first-light/index.html'), /light through the curtain/);
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

test('a portable profile is applied on each static rebuild and rejected safely when invalid', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rra-profile-'));
  const profilePath = path.join(dir, 'site-profile.json');
  const profile = makeProfile(Object.fromEntries(PROFILE_KEYS.map((key) => [key, ''])));
  Object.assign(profile.settings, { site_name: 'Portable Archive', site_about: 'Portable description', site_intro_zh: '中文迁移简介', site_email: 'portable@example.test' });
  const env = { SITE_URL: 'https://portable.test', STATIC_DEMO: '1', SITE_PROFILE_PATH: profilePath,
    NOTION_TOKEN: '', NOTION_API_SECRET: '', NOTION_DATABASE_ID: '', DATABASE_ID: '', NOTION_DB_WRITING: '' };
  try {
    await writeFile(profilePath, JSON.stringify(profile));
    for (let n = 0; n < 2; n++) {
      const result = await run(env); assert.equal(result.code, 0, result.output);
      const en = await readFile('static-dist/index.html', 'utf8');
      const zh = await readFile('static-dist/zh-CN/index.html', 'utf8');
      assert.match(en, /Portable Archive/); assert.match(en, /Portable description/);
      assert.match(zh, /中文迁移简介/);
      assert.match(await readFile('static-dist/rss.xml', 'utf8'), /Portable Archive/);
      await assert.rejects(access('static-dist/site-profile.json'));
      await assert.rejects(access('static-dist/admin/index.html'));
      assert.match(await readFile('static-dist/profile-editor.html', 'utf8'), /does not log you in/);
    }
    profile.settings.NOTION_TOKEN = 'never-accept-me';
    await writeFile(profilePath, JSON.stringify(profile));
    const invalid = await run(env); assert.notEqual(invalid.code, 0); assert.match(invalid.output, /supported public fields/);
    await assert.rejects(access('static-dist/index.html'));
    const missing = await run({ ...env, SITE_PROFILE_PATH: path.join(dir, 'missing.json') });
    assert.notEqual(missing.code, 0); assert.match(missing.output, /Cannot load site profile/);
    await assert.rejects(access('static-dist/index.html'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('a content bundle folder supplies the profile (with facts), the More page and its uploads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rra-content-'));
  const profile = makeProfile(Object.fromEntries(PROFILE_KEYS.map((key) => [key, ''])));
  Object.assign(profile.settings, { site_name: 'Bundled Archive', site_facts: 'Based in: Kaohsiung\nOpen: 10:00–18:00', site_facts_zh: '-' });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const more = { format: 'red-room-more', version: 1, document: {
    intro: { en: 'Bundled intro paragraph', 'zh-CN': '打包的介绍' }, channels: [],
    publications: [{ title: { en: 'Bundled Zine', 'zh-CN': '' }, cover: '/uploads/zine-cover.png' }] } };
  const env = { SITE_URL: 'https://bundle.test', STATIC_DEMO: '1', SITE_CONTENT_DIR: dir,
    NOTION_TOKEN: '', NOTION_API_SECRET: '', NOTION_DATABASE_ID: '', DATABASE_ID: '', NOTION_DB_WRITING: '' };
  try {
    await mkdir(path.join(dir, 'uploads'));
    await writeFile(path.join(dir, 'site-profile.json'), JSON.stringify(profile));
    await writeFile(path.join(dir, 'more.json'), JSON.stringify(more));
    await writeFile(path.join(dir, 'uploads', 'zine-cover.png'), png);
    await writeFile(path.join(dir, 'uploads', 'unused.png'), png);
    const result = await run(env); assert.equal(result.code, 0, result.output);
    assert.match(result.output, /profile yes, More page yes, 2 upload\(s\)/);
    const home = await readFile('static-dist/index.html', 'utf8');
    assert.match(home, /Bundled Archive/);
    assert.match(home, /<dt[^>]*>Based in<\/dt><dd[^>]*>Kaohsiung<\/dd>/);
    assert.match(home, /10:00–18:00/);
    assert.doesNotMatch(await readFile('static-dist/zh-CN/index.html', 'utf8'), /class="facts"/, '"-" hides the Chinese facts');
    const page = await readFile('static-dist/more/index.html', 'utf8');
    assert.match(page, /Bundled Zine/); assert.match(page, /Bundled intro paragraph/);
    assert.match(page, /src="\/uploads\/zine-cover\.png"/);
    assert.ok((await readFile('static-dist/uploads/zine-cover.png')).equals(png), 'referenced upload is published');
    await assert.rejects(access('static-dist/uploads/unused.png'), 'unreferenced uploads are not published');
    await assert.rejects(access('static-dist/more.json'));

    // An explicit SITE_PROFILE_PATH still wins over the bundled profile.
    const override = makeProfile({ ...profile.settings, site_name: 'Explicit Profile' });
    await writeFile(path.join(dir, 'explicit.json'), JSON.stringify(override));
    const explicit = await run({ ...env, SITE_PROFILE_PATH: path.join(dir, 'explicit.json') });
    assert.equal(explicit.code, 0, explicit.output);
    assert.match(await readFile('static-dist/index.html', 'utf8'), /Explicit Profile/);

    // Invalid bundled content fails closed with the server's reason.
    await writeFile(path.join(dir, 'more.json'), JSON.stringify({ document: { publications: [{ cover: 'javascript:alert(1)' }] } }));
    const bad = await run(env); assert.notEqual(bad.code, 0); assert.match(bad.output, /More page import failed \(400: .*cover/);
    await assert.rejects(access('static-dist/index.html'));
    const missing = await run({ ...env, SITE_CONTENT_DIR: path.join(dir, 'nope') });
    assert.notEqual(missing.code, 0); assert.match(missing.output, /SITE_CONTENT_DIR is not a directory/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Netlify preview without Notion credentials is an explicitly marked demo; production and partial config fail', async () => {
  const env = { NETLIFY: 'true', CONTEXT: 'deploy-preview', URL: 'https://archive.netlify.app', SITE_URL: '',
    STATIC_DEMO: '', NOTION_TOKEN: '', NOTION_API_SECRET: '', NOTION_DATABASE_ID: '', DATABASE_ID: '', NOTION_DB_WRITING: '' };
  const preview = await run(env);
  assert.equal(preview.code, 0, preview.output);
  assert.match(preview.output, /generating labelled demo content/);
  const home = await readFile('static-dist/index.html', 'utf8');
  assert.match(home, /data-demo-preview/);
  assert.match(home, /DEMO PREVIEW/);
  assert.match(home, /name="robots" content="noindex,nofollow"/);
  assert.match(home, /href="\/articles\/connect-notion"/);
  assert.match(await readFile('static-dist/404.html', 'utf8'), /data-demo-preview/);
  assert.match(await readFile('static-dist/robots.txt', 'utf8'), /Disallow: \/$/m);
  // The same security headers as the Node server, and pages that satisfy them:
  // no inline scripts, <style> blocks, style attributes or event handlers.
  const headers = await readFile('static-dist/_headers', 'utf8');
  assert.match(headers, /^\/\*\n {2}Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';/);
  assert.match(headers, /frame-ancestors 'self'/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.doesNotMatch(headers.split('/media/notion/*')[0], /unsafe-inline/);
  for (const file of ['index.html', 'zh-CN/index.html', 'articles/index.html', 'search/index.html', 'more/index.html', '404.html', 'articles/connect-notion/index.html', 'profile-editor.html']) {
    const html = await readFile(path.join('static-dist', file), 'utf8');
    // JSON-LD is a data block browsers never execute; anything else inline is forbidden.
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)(?![^>]*\stype="application\/ld\+json")[^>]*>\s*\S/, `${file}: inline script`);
    assert.doesNotMatch(html, /<style[\s>]/, `${file}: <style> block`);
    assert.doesNotMatch(html, /\sstyle=/, `${file}: style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+=/, `${file}: event handler attribute`);
  }
  for (const patch of [{ CONTEXT: 'production' }, { NOTION_TOKEN: 'only-token' }, { NOTION_DATABASE_ID: DB }, { STATIC_DEMO: '0' }, { NETLIFY: '', SITE_URL: 'https://archive.test' }]) {
    const result = await run({ ...env, ...patch });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Set NOTION_TOKEN and NOTION_DATABASE_ID/);
    await assert.rejects(access('static-dist/index.html'));
  }
});
