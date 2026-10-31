/** Build a read-only public snapshot using the same SSR views and Notion renderer.
 * The temporary database and server are never copied into the published output. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, cp, rm, writeFile, readFile, readdir, stat, copyFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse, parseFragment, serialize } from 'parse5';
import { validateProfile, PROFILE_MAX_BYTES } from '../public/profile-format.js';
import { imageSize, IMAGE_HEADER_BYTES } from './lib/image-size.mjs';

const root = process.cwd();
// UI harnesses have disposable outputs and never overwrite a user's snapshot.
const destName = process.env.PAGES_TEST_SNAPSHOT === '1' ? '.ui-test-pages-snapshot' : process.env.UI_TEST_SNAPSHOT === '1' ? '.ui-test-snapshot' : 'static-dist';
const dest = path.join(root, destName);
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
const requestedBasePath = (process.env.STATIC_BASE_PATH || '').trim();
const staticHost = (process.env.STATIC_HOST || '').trim();
let basePath = '';
let githubPages = false;
let githubPagesSecurity = null;
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
// The server already renders path URLs (shared/routes.ts, shared/i18n.ts):
// `/zh-CN/…` for Chinese, `/topics/<slug>` for topics. Mirror that here.
const LANGS = ['en', 'zh-CN'];
const localized = (route, lang) => (lang === 'zh-CN' ? (route === '/' ? '/zh-CN' : `/zh-CN${route}`) : route);
const PAGE_SIZE = 20;
const pageCount = (n) => Math.max(1, Math.ceil(n / PAGE_SIZE));
// Topic slugs only contain letters, digits and '-' (topicSlug), so they are safe
// file names; write() still refuses anything that escapes the output folder.
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
      const notice = parseFragment('<div role="status" data-demo-preview>DEMO PREVIEW · Notion not configured / 演示预览 · 未连接 Notion</div>').childNodes[0];
      notice.parentNode = node; node.childNodes.push(notice);
    }
  });
};
const withBase = (value) => basePath && value.startsWith('/') && !value.startsWith('//') ? `${basePath}${value}` : value;
const rewritePublicUrl = (value) => {
  if (!basePath || !value) return value;
  if (value === siteUrl) return `${siteUrl}${basePath}`;
  if (value.startsWith(`${siteUrl}/`)) return `${siteUrl}${withBase(value.slice(siteUrl.length))}`;
  return withBase(value);
};
const rewriteAbsoluteText = (value) => basePath ? value.replaceAll(`${siteUrl}/`, `${siteUrl}${basePath}/`) : value;
const rewriteCssUrls = (value) => basePath ? value.replace(/url\(\s*(["']?)(\/(?!\/)[^)"']+)\1\s*\)/g, (_match, quote, url) => `url(${quote}${withBase(url)}${quote})`) : value;
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'poster', 'content', 'data-model', 'data-cover', 'data-copyright-path']);
const metaNode = (parent, attributes) => ({ nodeName: 'meta', tagName: 'meta', attrs: Object.entries(attributes).map(([name, value]) => ({ name, value })), namespaceURI: 'http://www.w3.org/1999/xhtml', childNodes: [], parentNode: parent });
const rewriteDocument = (doc, noReferrer = false) => {
  walk(doc, (node) => {
    if (node.tagName === 'html') {
      if (basePath) setAttr(node, 'data-base-path', basePath);
      if (githubPages) setAttr(node, 'data-static-host', 'github-pages');
    }
    for (const attr of node.attrs || []) if (URL_ATTRIBUTES.has(attr.name)) attr.value = rewritePublicUrl(attr.value);
    if (node.tagName === 'script' && getAttr(node, 'type') === 'application/ld+json') {
      for (const child of node.childNodes || []) if (child.nodeName === '#text') child.value = rewriteAbsoluteText(child.value);
    }
    // GitHub Pages ignores _headers. Keep the two protections HTML can express;
    // the deployment guide records the headers that Pages cannot provide.
    if (node.tagName === 'head' && githubPagesSecurity) {
      node.childNodes.push(
        metaNode(node, { 'http-equiv': 'Content-Security-Policy', content: githubPagesSecurity.csp }),
        metaNode(node, { name: 'referrer', content: noReferrer ? 'no-referrer' : githubPagesSecurity.referrer }),
      );
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
// Intrinsic sizes for <img> without width/height (covers, Notion images, More covers):
// with them the browser reserves the space before the file arrives, so the text
// does not jump down while the reader starts scrolling (iOS Safari has no scroll
// anchoring). Local files are read from the output; external images (e.g. a
// Cloudinary cover) are probed with one ranged request for the first 64 KiB.
// Any failure leaves the tag as it was. STATIC_IMAGE_PROBE=0 skips external hosts.
const sizes = new Map();
const readHead = async (file) => {
  const handle = await open(file);
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(IMAGE_HEADER_BYTES), 0, IMAGE_HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
};
const imageHead = async (src) => {
  let url; try { url = new URL(src, siteUrl); } catch { return null; }
  if (url.origin === new URL(siteUrl).origin) {
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
    for (const dir of [dest, path.join(root, 'public')]) {
      const file = path.resolve(dir, '.' + pathname);
      if (!file.startsWith(dir + path.sep)) return null;
      try { return await readHead(file); } catch { /* not in this directory */ }
    }
    return null;
  }
  if (process.env.STATIC_IMAGE_PROBE === '0' || !/^https?:$/.test(url.protocol)) return null;
  try {
    const response = await fetch(url, { headers: { Range: `bytes=0-${IMAGE_HEADER_BYTES - 1}` }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    while (size < IMAGE_HEADER_BYTES) {                   // stop after the header even if Range was ignored
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); size += value.length;
    }
    await reader.cancel().catch(() => {});
    return Buffer.concat(parts).subarray(0, IMAGE_HEADER_BYTES);
  } catch { return null; }
};
const sizeOf = (src) => {
  if (!sizes.has(src)) sizes.set(src, imageHead(src).then((head) => (head ? imageSize(head) : null), () => null));
  return sizes.get(src);
};
const needsSize = (node) => node.tagName === 'img' && getAttr(node, 'src') && !getAttr(node, 'width') && !getAttr(node, 'height') &&
  !(getAttr(node, 'class') ?? '').split(/\s+/).includes('callout-icon');   // fixed-size icon

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
  if (requestedBasePath && requestedBasePath !== '/') {
    const valid = requestedBasePath.startsWith('/') && !requestedBasePath.endsWith('/') && !requestedBasePath.includes('//') && requestedBasePath.split('/').slice(1)
      .every((segment) => /^[A-Za-z0-9._~-]+$/.test(segment) && segment !== '.' && segment !== '..');
    if (!valid) throw new Error('STATIC_BASE_PATH must be / or an absolute URL path without a trailing slash.');
  }
  basePath = requestedBasePath === '/' ? '' : requestedBasePath;
  if (!['', 'github-pages'].includes(staticHost)) throw new Error('STATIC_HOST must be empty or github-pages.');
  githubPages = staticHost === 'github-pages';
  if ((!token || !database) && !demo) throw new Error('Set NOTION_TOKEN and NOTION_DATABASE_ID, or explicitly set STATIC_DEMO=1 for a demo.');
  if (demo && (token || database)) throw new Error('STATIC_DEMO cannot be combined with Notion credentials.');
  if (previewDemo) console.warn('Netlify Deploy Preview: no Notion credentials; generating labelled demo content, not production articles.');
  // Admin-edited content for static builds: unzip the /admin content bundle
  // into site-content/ (site-profile.json, more.json, uploads/). The UI test
  // harness ignores a user's folder unless SITE_CONTENT_DIR is set explicitly.
  const contentName = process.env.SITE_CONTENT_DIR || (process.env.UI_TEST_SNAPSHOT === '1' || process.env.PAGES_TEST_SNAPSHOT === '1' ? '' : 'site-content');
  const contentDir = contentName ? path.resolve(root, contentName) : '';
  const isDir = async (p) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };
  if (process.env.SITE_CONTENT_DIR && !(await isDir(contentDir))) throw new Error(`SITE_CONTENT_DIR is not a directory: ${contentDir}`);
  const hasContent = contentDir ? await isDir(contentDir) : false;
  const exists = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };
  // Profile precedence: SITE_PROFILE_PATH, site-content/site-profile.json, ./site-profile.json.
  // The file is build input, not a published asset. An explicitly configured
  // path must exist; never silently ship defaults after a failed import.
  const bundledProfile = hasContent && await exists(path.join(contentDir, 'site-profile.json')) ? path.join(contentDir, 'site-profile.json') : '';
  const profileName = process.env.SITE_PROFILE_PATH || bundledProfile || (process.env.UI_TEST_SNAPSHOT === '1' || process.env.PAGES_TEST_SNAPSHOT === '1' ? '' : 'site-profile.json');
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
  // The snapshot server renders pages only. Newsletter credentials belong to the
  // Netlify Function (server-side env), never to the build server or its output.
  const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NEWSLETTER_')));
  child = spawn(process.execPath, [path.join(root, 'dist/server/entry.mjs')], {
    cwd: temp, env: { ...buildEnv, HOST: '127.0.0.1', PORT: String(port), ADMIN_TOKEN: secret,
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
  const pageHeaders = (await get('/')).headers;
  const security = ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']
    .map((name) => [name, pageHeaders.get(name)]);
  if (security.some(([, value]) => !value)) throw new Error('The snapshot server did not send the expected security headers.');
  if (githubPages) githubPagesSecurity = { csp: pageHeaders.get('Content-Security-Policy'), referrer: pageHeaders.get('Referrer-Policy') };
  await cp(path.join(root, 'dist/client'), dest, { recursive: true });
  const articles = [];
  let total = 0;
  do {
    const data = await api(`/api/articles?limit=100&offset=${articles.length}`);
    total = data.total; articles.push(...data.articles);
    if (!data.articles.length && articles.length < total) throw new Error('Could not enumerate all articles');
  } while (articles.length < total);
  const topics = (await api('/api/tags?lang=en')).tags;
  // Newsletter pages are static shells; their form and links call /api/newsletter/*,
  // which netlify/functions/newsletter.mts serves on the static deployment.
  const routes = ['/', '/more', '/copyright', '/search', '/offline', '/topics', '/archive', '/subscribe', '/newsletter/confirm', '/newsletter/unsubscribe'];
  for (let p = 1; p <= pageCount(total); p++) routes.push(p === 1 ? '/articles' : `/articles/page/${p}`);
  for (const topic of topics) {
    for (let p = 1; p <= pageCount(topic.count); p++) routes.push(`/topics/${encodeURIComponent(topic.slug)}${p > 1 ? `/page/${p}` : ''}`);
  }
  // The detail API propagates failures instead of silently rendering an unavailable body.
  for (const article of articles) { await api(`/api/articles/${encodeURIComponent(article.slug)}`); routes.push(article.href); }
  // Tag names in both languages, so a search on the Chinese page also finds `Fiction`.
  const byLang = {};
  for (const lang of LANGS) {
    const list = [];
    for (let offset = 0; offset < total; offset += 100) list.push(...(await api(`/api/articles?limit=100&offset=${offset}&lang=${lang}`)).articles);
    byLang[lang] = new Map(list.map((article) => [article.href, article]));
  }
  const search = { en: [], 'zh-CN': [] };
  for (const lang of LANGS) {
    for (const route of routes) {
      const doc = parse(await (await get(localized(route, lang))).text(), { scriptingEnabled: false });
      markDemoPreview(doc);
      const changes = [], images = [];
      let articleBody;
      walk(doc, (node) => {
        if (getAttr(node, 'class')?.split(/\s+/).includes('article-body')) articleBody = node;
        if (needsSize(node)) images.push(node);
        const href = getAttr(node, 'href');
        const src = getAttr(node, 'src');
        for (const [key, value] of [['href', href], ['src', src], ['content', getAttr(node, 'content')], ['data-model', getAttr(node, 'data-model')], ['data-cover', getAttr(node, 'data-cover')]]) {
          if (!value) continue;
          let url; try { url = new URL(value, siteUrl); } catch { continue; }
          if (url.origin === new URL(siteUrl).origin && /^\/uploads\/[^/]+$/.test(url.pathname)) changes.push(exportUpload(url.pathname));
          if (url.origin === new URL(siteUrl).origin && /^\/media\/notion\/[0-9a-f]{32}$/i.test(url.pathname)) changes.push(exportMedia(url.pathname).then((p) => setAttr(node, key, value.startsWith('http') ? siteUrl + p : p)));
        }
        // The switcher's `?lang=` asks the server to remember the choice; a static host cannot.
        if (href && getAttr(node, 'data-lang-switch')) {
          const u = new URL(href, base);
          u.searchParams.delete('lang');
          setAttr(node, 'href', u.pathname + u.search + u.hash);
        }
      });
      await Promise.all(changes);
      await Promise.all(images.map(async (node) => {
        const size = await sizeOf(getAttr(node, 'src'));
        if (size) { setAttr(node, 'width', String(size.width)); setAttr(node, 'height', String(size.height)); }
      }));
      if (articleBody) {
        const item = byLang[lang].get(route);
        if (item) {
          const searchTags = [...new Set(LANGS.flatMap((code) => byLang[code].get(route)?.tags ?? []))];
          search[lang].push({ ...item, searchTags, href: localized(item.href, lang), text: textContent(articleBody) });
        }
      }
      if (route === '/search') {
        walk(doc, (node) => { if (node.tagName === 'body') node.childNodes.push({ nodeName: 'script', tagName: 'script', attrs: [{ name: 'src', value: '/static-search.js' }, { name: 'defer', value: '' }], namespaceURI: 'http://www.w3.org/1999/xhtml', childNodes: [], parentNode: node }); });
      }
      rewriteDocument(doc, route.startsWith('/newsletter/'));
      await write(localized(route, lang), serialize(doc));
    }
  }
  const missing = await fetch(base + '/404');
  if (missing.status !== 404) throw new Error('Expected the 404 page to return 404.');
  const missingDoc = parse(await missing.text(), { scriptingEnabled: false });
  markDemoPreview(missingDoc);
  rewriteDocument(missingDoc);
  await writeFile(path.join(dest, '404.html'), serialize(missingDoc));
  // The admin shell (no data, no secrets): on the static site it probes the
  // newsletter and analytics Functions and shows only modules that respond.
  const adminDoc = parse(await (await get('/admin')).text(), { scriptingEnabled: false });
  rewriteDocument(adminDoc);
  await write('/admin', serialize(adminDoc));
  const profileEditorFile = path.join(dest, 'profile-editor.html');
  const profileEditorDoc = parse(await readFile(profileEditorFile, 'utf8'), { scriptingEnabled: false });
  rewriteDocument(profileEditorDoc);
  await writeFile(profileEditorFile, serialize(profileEditorDoc));
  const basedSearch = Object.fromEntries(Object.entries(search).map(([lang, items]) => [lang, items.map((item) => ({ ...item, href: withBase(item.href) }))]));
  await writeFile(path.join(dest, 'static-search.json'), JSON.stringify(basedSearch));
  await cp(path.join(root, 'scripts/static-search.js'), path.join(dest, 'static-search.js'));
  await writeFile(path.join(dest, 'rss.xml'), rewriteAbsoluteText(await (await get('/rss.xml')).text()));
  await writeFile(path.join(dest, 'llms.txt'), rewriteAbsoluteText(await (await get('/llms.txt')).text()));
  // /subscribe is always built (direct links keep working) but listed only when the
  // public sign-up entries are on: SHOW_NEWSLETTER_SIGNUP (the build has no saved settings).
  const signupListed = /^(1|true|on|yes)$/i.test((process.env.SHOW_NEWSLETTER_SIGNUP ?? '').trim());
  const listed = routes.filter((r) => !['/search', '/offline'].includes(r) && !r.includes('/page/') && !r.startsWith('/newsletter/') && (signupListed || r !== '/subscribe'));
  const urls = listed.map((route) => {
    const article = articles.find((item) => item.href === route);
    const latest = article?.updated || article?.date || (['/articles', '/archive'].includes(route) ? articles[0]?.updated : '');
    const lastmod = /^\d{4}-\d{2}-\d{2}/.test(latest || '') ? `<lastmod>${String(latest).slice(0, 10)}</lastmod>` : '';
    const alternates = [
      ...LANGS.map((lang) => [lang, localized(route, lang)]),
      ['x-default', localized(route, 'en')],
    ].map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${xml(siteUrl + withBase(href))}"/>`).join('');
    return LANGS.map((lang) => `<url><loc>${xml(siteUrl + withBase(localized(route, lang)))}</loc>${lastmod}${alternates}</url>`).join('\n');
  });
  await writeFile(path.join(dest, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('\n')}</urlset>`);
  // robots.txt from the server (ui/feeds.ts): the AI-training crawler block stays in one place.
  const robotsText = previewDemo ? 'User-agent: *\nDisallow: /\n' : rewriteAbsoluteText(await (await get('/robots.txt')).text())
    .replace('Disallow: /admin\n', `Disallow: ${withBase('/admin')}\n`)
    .replace('Disallow: /api/\n', `Disallow: ${withBase('/api/')}\n`);
  await writeFile(path.join(dest, 'robots.txt'), robotsText);
  if (basePath) {
    const manifestFile = path.join(dest, 'manifest.webmanifest');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    for (const key of ['id', 'start_url', 'scope']) if (manifest[key]) manifest[key] = withBase(manifest[key]);
    for (const icon of manifest.icons || []) icon.src = withBase(icon.src);
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const rewriteCssTree = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await rewriteCssTree(file);
        else if (entry.isFile() && entry.name.endsWith('.css')) await writeFile(file, rewriteCssUrls(await readFile(file, 'utf8')));
      }
    };
    await rewriteCssTree(dest);
  }
  // Pages would otherwise run Jekyll and can ignore the _astro asset directory.
  if (githubPages) await writeFile(path.join(dest, '.nojekyll'), '');
  // Same security headers as the Node server (server/http/security.ts), copied
  // from what the snapshot server actually sent, so the two cannot drift apart.
  await writeFile(path.join(dest, '_headers'), [
    '/*', ...security.map(([name, value]) => `  ${name}: ${value}`),
    '/_astro/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/models/*', '  Cache-Control: public, max-age=86400, stale-while-revalidate=604800',
    '/sw.js', '  Cache-Control: no-cache',
    '/manifest.webmanifest', '  Cache-Control: public, max-age=3600',
    '/media/notion/*', "  Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    '/admin', '  Cache-Control: no-store', '  X-Robots-Tag: noindex, nofollow',
    '/admin/*', '  Cache-Control: no-store', '  X-Robots-Tag: noindex, nofollow',
    ...['/newsletter/*', '/zh-CN/newsletter/*'].flatMap((route) => [route, '  Referrer-Policy: no-referrer', '  X-Robots-Tag: noindex']),
    '',
  ].join('\n'));
  // Last line of defence: no server-side secret may appear anywhere in the output.
  const secrets = [secret, token, process.env.ADMIN_TOKEN, ...Object.entries(process.env).filter(([key]) => /^NEWSLETTER_(SECRET|EMAIL_API_KEY)$/.test(key)).map(([, value]) => value)]
    .filter((value) => typeof value === 'string' && value.length >= 12);
  const scan = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await scan(file); continue; }
      const content = await readFile(file);
      if (secrets.some((value) => content.includes(value))) throw new Error(`A server-side secret was found in ${path.relative(dest, file)}; no snapshot published.`);
      if (/\.(?:db|sqlite3?)(?:-wal|-shm)?$/i.test(entry.name)) throw new Error(`Database file in the snapshot: ${path.relative(dest, file)}`);
    }
  };
  await scan(dest);
  console.log(`Static snapshot built: ${articles.length} published articles, ${media.size} media files, ${uploads.size} uploaded files.`);
} catch (error) {
  await rm(dest, { recursive: true, force: true });
  throw error;
} finally {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await rm(temp, { recursive: true, force: true });
}
