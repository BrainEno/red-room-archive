/** Build a read-only public snapshot using the same SSR views and Notion renderer.
 * The temporary database and server are never copied into the published output. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, cp, rm, writeFile, readFile, readdir, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { parse, parseFragment, serialize } from 'parse5';
import { validateProfile, PROFILE_MAX_BYTES } from '../public/profile-format.js';

const root = process.cwd();
// The UI harness has its own disposable output and never overwrites a user's snapshot.
const dest = path.join(root, process.env.UI_TEST_SNAPSHOT === '1' ? '.ui-test-snapshot' : 'static-dist');
const temp = await mkdtemp(path.join(tmpdir(), 'red-room-static-'));
// Netlify's URL is the primary site address, including on deploy previews.
// A deliberate SITE_URL always wins, including when it is invalid.
const siteUrl = (process.env.SITE_URL || (process.env.NETLIFY === 'true' ? process.env.URL : '') || '').replace(/\/+$/, '');
const token = process.env.NOTION_TOKEN || process.env.NOTION_API_SECRET;
const database = process.env.NOTION_DATABASE_ID || process.env.DATABASE_ID || process.env.NOTION_DB_WRITING;
// Only a Netlify Deploy Preview with *neither* credential may fall back to a
// clearly labelled demo. Production, other contexts, and partial credentials
// still fail closed. STATIC_DEMO=0 can explicitly disable this preview fallback.
const previewDemo = process.env.NETLIFY === 'true' && process.env.CONTEXT === 'deploy-preview' &&
  !token && !database && process.env.STATIC_DEMO !== '0';
const demo = process.env.STATIC_DEMO === '1' || previewDemo;
const secret = randomBytes(32).toString('hex');
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
let child;
const base = `http://127.0.0.1:${port}`;
const xml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const get = async (url, headers = {}) => {
  const response = await fetch(base + url, { headers, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Snapshot request failed: ${url} (${response.status})`);
  return response;
};
const api = async (url) => (await get(url)).json();
const admin = { Authorization: `Bearer ${secret}` };
const langPrefix = (lang) => lang === 'zh-CN' ? '/zh-CN' : '';
// Tags are arbitrary user input: never treat them as filesystem path segments.
const topicSegment = (key) => 't-' + createHash('sha256').update(key).digest('hex');
const pagePath = (url, lang, aliases) => {
  const u = new URL(url, base);
  let p = u.pathname;
  if (p === '/articles' || p === '/articles/') {
    const tag = u.searchParams.get('tag');
    const page = Math.max(1, Number(u.searchParams.get('page')) || 1);
    if (tag) p = `/topics/${topicSegment(aliases.get(tag.toLowerCase()) || tag)}`;
    else p = '/articles';
    if (page > 1) p += `/page/${page}`;
  }
  return `${langPrefix(lang)}${p === '/' ? '/' : p}`;
};
const getAttr = (node, key) => node.attrs?.find((a) => a.name === key)?.value;
const setAttr = (node, key, value) => { const a = node.attrs?.find((x) => x.name === key); if (a) a.value = value; else node.attrs?.push({ name: key, value }); };
const walk = (node, fn) => { fn(node); for (const child of node.childNodes || []) walk(child, fn); };
const textContent = (node) => (node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textContent).join(' '));
const markDemoPreview = (doc) => {
  if (!previewDemo) return;
  walk(doc, (node) => {
    if (node.tagName === 'head') {
      const meta = parseFragment('<meta name="robots" content="noindex,nofollow">').childNodes[0];
      meta.parentNode = node; node.childNodes.push(meta);
    }
    if (node.tagName === 'body') {
      const notice = parseFragment('<div role="status" data-demo-preview style="position:fixed;bottom:0;right:0;z-index:2147483647;background:#fff;color:#111;padding:8px 12px;font:600 14px/1.4 sans-serif;max-width:100%;box-sizing:border-box">DEMO PREVIEW · Notion not configured / 演示预览 · 未连接 Notion</div>').childNodes[0];
      notice.parentNode = node; node.childNodes.push(notice);
    }
  });
};
const write = async (url, content) => {
  const pathname = decodeURIComponent(new URL(url, base).pathname);
  const target = path.resolve(dest, '.' + pathname, 'index.html');
  if (!target.startsWith(dest + path.sep)) throw new Error('Invalid snapshot path');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};
const media = new Map();
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv' };
const exportMedia = async (url) => {
  const id = /^\/media\/notion\/([0-9a-f]{32})$/i.exec(url)?.[1];
  if (!id) return url;
  if (media.has(id)) return media.get(id);
  const response = await get(url);
  const mime = response.headers.get('content-type')?.split(';')[0];
  const ext = extensions[mime];
  if (!ext) throw new Error(`Unsupported media type ${mime} for ${url}; convert it to a supported image, audio, video or PDF.`);
  const target = `/media/notion/${id}.${ext}`;
  await mkdir(path.join(dest, 'media/notion'), { recursive: true });
  await writeFile(path.join(dest, target), Buffer.from(await response.arrayBuffer()));
  media.set(id, target);
  return target;
};
// Files uploaded in /admin (More covers, QR codes, the statue model) that a page references.
const uploads = new Set();
const exportUpload = async (pathname) => {
  let name;
  try { name = decodeURIComponent(pathname.slice('/uploads/'.length)); } catch { return; }
  if (!name || name !== path.basename(name) || name.startsWith('.') || uploads.has(name)) return;
  uploads.add(name);
  const response = await get('/uploads/' + encodeURIComponent(name));
  await mkdir(path.join(dest, 'uploads'), { recursive: true });
  await writeFile(path.join(dest, 'uploads', name), Buffer.from(await response.arrayBuffer()));
};
try {
  // Remove previous output before any failure so it cannot be mistaken for a new build.
  await rm(dest, { recursive: true, force: true });
  let origin;
  try { origin = new URL(siteUrl); } catch { throw new Error('Set SITE_URL to the public site origin before building (on Netlify, the built-in URL is used when SITE_URL is unset).'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('SITE_URL must be a plain HTTP(S) origin without credentials or a path.');
  if ((!token || !database) && !demo) throw new Error('Set NOTION_TOKEN and NOTION_DATABASE_ID, or explicitly set STATIC_DEMO=1 for a demo.');
  if (demo && (token || database)) throw new Error('STATIC_DEMO cannot be combined with Notion credentials.');
  if (previewDemo) console.warn('Netlify Deploy Preview: no Notion credentials; generating labelled demo content, not production articles.');
  // Admin-edited content for static builds: unzip the /admin content bundle
  // into site-content/ (site-profile.json, more.json, uploads/). The UI test
  // harness ignores a user's folder unless SITE_CONTENT_DIR is set explicitly.
  const contentName = process.env.SITE_CONTENT_DIR || (process.env.UI_TEST_SNAPSHOT === '1' ? '' : 'site-content');
  const contentDir = contentName ? path.resolve(root, contentName) : '';
  const isDir = async (p) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };
  if (process.env.SITE_CONTENT_DIR && !(await isDir(contentDir))) throw new Error(`SITE_CONTENT_DIR is not a directory: ${contentDir}`);
  const hasContent = contentDir ? await isDir(contentDir) : false;
  const exists = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };
  // Profile precedence: SITE_PROFILE_PATH, site-content/site-profile.json, ./site-profile.json.
  // The file is build input, not a published asset. An explicitly configured
  // path must exist; never silently ship defaults after a failed import.
  const bundledProfile = hasContent && await exists(path.join(contentDir, 'site-profile.json')) ? path.join(contentDir, 'site-profile.json') : '';
  const profileName = process.env.SITE_PROFILE_PATH || bundledProfile || (process.env.UI_TEST_SNAPSHOT === '1' ? '' : 'site-profile.json');
  const profilePath = profileName ? path.resolve(root, profileName) : '';
  let profile;
  try {
    if (profilePath) {
      const info = await stat(profilePath);
      if (!info.isFile() || info.size > PROFILE_MAX_BYTES) throw new Error('Site profile must be a file of at most 128 KiB');
      profile = validateProfile(JSON.parse(await readFile(profilePath, 'utf8')));
    }
  } catch (error) {
    if (error.code !== 'ENOENT' || process.env.SITE_PROFILE_PATH) throw new Error(`Cannot load site profile: ${error.message}`);
  }
  // more.json: the bundle wrapper ({ format: 'red-room-more', document }) or a bare document.
  let moreDocument;
  const morePath = hasContent ? path.join(contentDir, 'more.json') : '';
  if (morePath && await exists(morePath)) {
    if ((await stat(morePath)).size > 8 * 1024 * 1024) throw new Error('more.json is larger than 8 MiB');
    try {
      const parsed = JSON.parse(await readFile(morePath, 'utf8'));
      moreDocument = parsed && typeof parsed === 'object' && 'document' in parsed ? parsed.document : parsed;
    } catch (error) { throw new Error(`Cannot read ${morePath}: ${error.message}`); }
  }
  // Uploaded files go into the snapshot server's upload directory, so the
  // pages render exactly as on the Node server; referenced ones are exported below.
  const uploadDir = path.join(temp, 'uploads');
  await mkdir(uploadDir, { recursive: true });
  let bundledUploads = 0;
  if (hasContent && await isDir(path.join(contentDir, 'uploads'))) {
    for (const entry of await readdir(path.join(contentDir, 'uploads'), { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.') || entry.name.endsWith('.part') || entry.name !== path.basename(entry.name)) continue;
      await copyFile(path.join(contentDir, 'uploads', entry.name), path.join(uploadDir, entry.name));
      bundledUploads++;
    }
  }
  if (hasContent) console.log(`Using ${path.relative(root, contentDir) || contentDir}/: profile ${bundledProfile ? 'yes' : 'no'}, More page ${moreDocument ? 'yes' : 'no'}, ${bundledUploads} upload(s).`);
  child = spawn(process.execPath, [path.join(root, 'dist/server/entry.mjs')], {
    cwd: temp, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ADMIN_TOKEN: secret,
      DB_PATH: path.join(temp, 'snapshot.db'), UPLOAD_DIR: uploadDir, MEDIA_CACHE_DIR: path.join(temp, 'media'), SYNC_TTL_SECONDS: '31536000',
      NOTION_TOKEN: token || '', NOTION_DATABASE_ID: database || '', SITE_URL: siteUrl }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Snapshot server startup timed out')), 20000);
    const data = (chunk) => { log += chunk; if (log.includes('Server listening')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', data); child.stderr.on('data', data);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Snapshot server exited: ${code}\n${log}`)); });
  });
  if (profile) {
    const response = await fetch(base + '/api/settings/profile', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    if (!response.ok) throw new Error(`Site profile import failed (${response.status}: ${(await response.json().catch(() => ({}))).error || 'unknown error'}); no snapshot published.`);
  }
  if (moreDocument !== undefined) {
    const response = await fetch(base + '/api/more/document', { method: 'PUT', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify(moreDocument) });
    if (!response.ok) throw new Error(`More page import failed (${response.status}: ${(await response.json().catch(() => ({}))).error || 'unknown error'}); no snapshot published.`);
  }
  if (!demo) {
    const schema = await (await get('/api/notion/schema', admin)).json();
    if (!schema.mapping?.published?.property || !schema.mapping?.title?.property) throw new Error('A recognized Published column and title column are required for safe static publishing.');
    const sync = await fetch(base + '/api/sync', { method: 'POST', headers: admin });
    if (!sync.ok) throw new Error(`Notion synchronization failed (${sync.status}); no snapshot published.`);
  }
  await cp(path.join(root, 'dist/client'), dest, { recursive: true });
  const articles = [];
  let total = 0;
  do {
    const data = await api(`/api/articles?limit=100&offset=${articles.length}`);
    total = data.total; articles.push(...data.articles);
    if (!data.articles.length && articles.length < total) throw new Error('Could not enumerate all articles');
  } while (articles.length < total);
  const tagsEn = (await api('/api/tags?lang=en')).tags;
  const tagsZh = (await api('/api/tags?lang=zh-CN')).tags;
  const aliases = new Map();
  for (const tag of [...tagsEn, ...tagsZh]) { aliases.set(tag.key.toLowerCase(), tag.key); aliases.set(tag.name.toLowerCase(), tag.key); }
  const routes = [{ source: '/', target: '/' }, { source: '/more', target: '/more' }, { source: '/search', target: '/search' }];
  for (let p = 1; p <= Math.max(1, Math.ceil(total / 20)); p++) routes.push({ source: `/articles?page=${p}`, target: p === 1 ? '/articles' : `/articles/page/${p}` });
  for (const tag of tagsEn) for (let p = 1; p <= Math.max(1, Math.ceil(tag.count / 20)); p++) {
    routes.push({ source: `/articles?tag=${encodeURIComponent(tag.key)}&page=${p}`, target: `/topics/${topicSegment(tag.key)}${p > 1 ? `/page/${p}` : ''}` });
  }
  // The detail API propagates failures instead of silently rendering an unavailable body.
  for (const article of articles) { await api(`/api/articles/${encodeURIComponent(article.slug)}`); routes.push({ source: article.href, target: article.href }); }
  const search = { en: [], 'zh-CN': [] };
  for (const lang of ['en', 'zh-CN']) {
    const localArticles = [];
    for (let offset = 0; offset < total; offset += 100) localArticles.push(...(await api(`/api/articles?limit=100&offset=${offset}&lang=${lang}`)).articles);
    const localByHref = new Map(localArticles.map((article) => [article.href, article]));
    for (const route of routes) {
      const sourceUrl = new URL(route.source, base); sourceUrl.searchParams.set('lang', lang);
      const doc = parse(await (await get(sourceUrl.pathname + sourceUrl.search)).text());
      markDemoPreview(doc);
      const changes = [];
      let articleBody;
      walk(doc, (node) => {
        if (getAttr(node, 'class')?.split(/\s+/).includes('article-body')) articleBody = node;
        const href = getAttr(node, 'href');
        const src = getAttr(node, 'src');
        if (node.tagName === 'form' && getAttr(node, 'action') === '/search') setAttr(node, 'action', langPrefix(lang) + '/search');
        for (const [key, value] of [['href', href], ['src', src], ['content', getAttr(node, 'content')], ['data-model', getAttr(node, 'data-model')]]) {
          if (!value) continue;
          let url; try { url = new URL(value, siteUrl); } catch { continue; }
          if (url.origin === new URL(siteUrl).origin && /^\/uploads\/[^/]+$/.test(url.pathname)) changes.push(exportUpload(url.pathname));
          if (url.origin === new URL(siteUrl).origin && /^\/media\/notion\/[0-9a-f]{32}$/i.test(url.pathname)) changes.push(exportMedia(url.pathname).then((p) => setAttr(node, key, value.startsWith('http') ? siteUrl + p : p)));
        }
        if (!href || !href.startsWith('/') || href.startsWith('//')) return;
        if (/^\/(?:articles(?:\/|\?|$)|more(?:\/|\?|$)|search(?:\/|\?|$)|\?|$)/.test(href) || href === '/') {
          const code = getAttr(node, 'data-lang-switch') || lang;
          const u = new URL(href, base);
          setAttr(node, 'href', pagePath(href, code, aliases) + u.hash);
        }
      });
      await Promise.all(changes);
      // Replace runtime query-string SEO links with actual static language paths.
      walk(doc, (node) => {
        const rel = getAttr(node, 'rel');
        if (rel === 'canonical') setAttr(node, 'href', siteUrl + langPrefix(lang) + route.target);
        if (rel === 'alternate' && getAttr(node, 'hreflang')) setAttr(node, 'href', siteUrl + langPrefix(getAttr(node, 'hreflang') === 'zh-CN' ? 'zh-CN' : 'en') + route.target);
        if (getAttr(node, 'property') === 'og:url') setAttr(node, 'content', siteUrl + langPrefix(lang) + route.target);
      });
      if (articleBody) {
        const item = localByHref.get(route.target);
        if (item) {
          const keys = new Set(item.tags.map((name) => aliases.get(name.toLowerCase())));
          const searchTags = [...new Set([...item.tags, ...[...tagsEn, ...tagsZh].filter((tag) => keys.has(tag.key)).map((tag) => tag.name)])];
          search[lang].push({ ...item, searchTags, href: langPrefix(lang) + item.href, text: textContent(articleBody) });
        }
      }
      if (route.target === '/search') {
        walk(doc, (node) => { if (node.tagName === 'body') node.childNodes.push({ nodeName: 'script', tagName: 'script', attrs: [{ name: 'src', value: '/static-search.js' }, { name: 'defer', value: '' }], namespaceURI: 'http://www.w3.org/1999/xhtml', childNodes: [], parentNode: node }); });
      }
      await write(langPrefix(lang) + route.target, serialize(doc));
    }
  }
  const missing = await fetch(base + '/404?lang=en');
  if (missing.status !== 404) throw new Error('Expected the 404 page to return 404.');
  const missingDoc = parse(await missing.text());
  markDemoPreview(missingDoc);
  await writeFile(path.join(dest, '404.html'), serialize(missingDoc));
  await writeFile(path.join(dest, 'static-search.json'), JSON.stringify(search));
  await cp(path.join(root, 'scripts/static-search.js'), path.join(dest, 'static-search.js'));
  await writeFile(path.join(dest, 'rss.xml'), await (await get('/rss.xml')).text());
  const urls = routes.filter((r) => r.target !== '/search' && !r.target.includes('/page/')).flatMap((r) => ['en', 'zh-CN'].map((lang) => `<url><loc>${xml(siteUrl + langPrefix(lang) + r.target)}</loc></url>`));
  await writeFile(path.join(dest, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  await writeFile(path.join(dest, 'robots.txt'), previewDemo ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${siteUrl}/sitemap.xml\n`);
  await writeFile(path.join(dest, '_headers'), `/media/notion/*\n  Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox\n  X-Content-Type-Options: nosniff\n`);
  console.log(`Static snapshot built: ${articles.length} published articles, ${media.size} media files, ${uploads.size} uploaded files.`);
} catch (error) {
  await rm(dest, { recursive: true, force: true });
  throw error;
} finally {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await rm(temp, { recursive: true, force: true });
}
