import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { llmsGuide } from '../src/core/discovery.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('llms.txt uses public facts, bilingual routes and preserves TDM rights', () => {
  const guide = llmsGuide({
    origin: 'https://archive.example/', name: 'SureShot Studio', description: 'Fiction, poetry and other writings', email: 'letters@archive.example',
    articles: [{ id: '1', slug: 'light', title: 'A [small]\nlight', href: '/articles/light', date: '2026-10-01', updated: '', excerpt: 'An existing excerpt.', tags: [], topics: [], cover: null, rank: 0 }],
  });
  assert.match(guide, /# SureShot Studio/);
  assert.ok(guide.includes('A \\[small\\] light'));
  assert.match(guide, /https:\/\/archive\.example\/articles\/light/);
  assert.match(guide, /https:\/\/archive\.example\/zh-CN\/articles/);
  assert.match(guide, /An existing excerpt\./);
  assert.match(guide, /does not grant an AI-training/);
  assert.doesNotMatch(guide, /invented|unlimited permission/i);
});

test('install metadata uses existing local icons and no third-party URLs', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) assert.ok(existsSync(new URL(`../public${icon.src}`, import.meta.url)), icon.src);
  assert.doesNotMatch(JSON.stringify(manifest), /https?:\/\//);
});

test('service worker bounds caches and excludes private data and query URLs', () => {
  const worker = read('public/sw.js');
  assert.match(worker, /const MAX_PAGES = 60/);
  assert.match(worker, /const MAX_ASSETS = 140/);
  assert.match(worker, /\(\?:api\|admin\)/);
  assert.match(worker, /newsletter/);
  assert.match(worker, /if \(!url\.search\) await save\(PAGES/);
  assert.match(worker, /if \(!url\.search\) \{\s*const cached = await match\(request\)/);
  assert.match(worker, /request\.headers\.has\('range'\)/);
  assert.match(worker, /\/_astro\//);
  assert.doesNotMatch(worker, /cache\.addAll\(\['\/'/);
});

test('public shells load enhancements conditionally; admin has no collector', () => {
  const base = read('src/ui/layouts/Base.astro');
  assert.match(base, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(base, /\{offline && <script>import '\.\.\/scripts\/site\/offline\.ts';<\/script>\}/);
  assert.match(base, /\{analytics && <script>import '\.\.\/scripts\/site\/analytics\.ts';<\/script>\}/);
  const admin = read('src/ui/views/AdminView.astro');
  assert.doesNotMatch(admin, /analytics=|offline/);
  const collector = read('src/ui/scripts/site/analytics.ts');
  assert.match(collector, /globalPrivacyControl/);
  assert.match(collector, /location\.pathname/);
  assert.doesNotMatch(collector, /localStorage|sessionStorage|document\.cookie|location\.search/);
});

test('static snapshot and Node cache headers share the offline/performance contract', () => {
  const snapshot = read('scripts/static-snapshot.mjs');
  assert.match(snapshot, /'\/offline'/);
  assert.ok(snapshot.includes("!['/search', '/offline'].includes(r)"));
  assert.match(snapshot, /get\('\/llms\.txt'\)/);
  assert.match(snapshot, /\/_astro\/\*', '  Cache-Control: public, max-age=31536000, immutable/);
  assert.match(snapshot, /\/sw\.js', '  Cache-Control: no-cache/);
  const middleware = read('src/middleware.ts');
  assert.match(middleware, /max-age=31536000, immutable/);
  assert.match(middleware, /url\.pathname === '\/sw\.js'/);
});
