import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:4184';
const base = `${origin}/red-room-archive`;

test('GitHub Pages project path keeps navigation, search and sharing inside the site', async ({ page }) => {
  const failures = [];
  const apiRequests = [];
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });

  await page.goto(`${base}/`);
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-base-path', '/red-room-archive');
  await page.goto(`${base}/articles`);
  await expect(page.locator('.article-entry').first()).toBeVisible();
  await page.goto(`${base}/articles/connect-notion`);
  await expect(page.locator('[data-article-title]')).toContainText('Connect your Notion database');
  await page.locator('[data-share-open]').click();
  await expect(page.locator('[data-share-download]')).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('[data-share-canvas]')).toHaveAttribute('aria-label', /\/red-room-archive\/articles\/connect-notion/);
  const articleUrl = `${base}/articles/connect-notion`;
  await expect(page.locator('[data-share-bluesky]')).toHaveAttribute('href', `https://bsky.app/intent/compose?text=${encodeURIComponent(articleUrl)}`);
  await page.locator('[data-share-close]').click();

  await page.goto(`${base}/search?q=Notion`);
  await expect(page.locator('.results .article-entry').first()).toBeVisible();
  await expect(page.locator('.results .article-entry').first()).toHaveAttribute('href', '/red-room-archive/articles/connect-notion');
  await page.goto(`${base}/profile-editor.html`);
  await expect(page.locator('h1')).toContainText('Offline site profile editor');
  await expect(page.locator('a').first()).toHaveAttribute('href', '/red-room-archive/');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#profile-form button').click();
  expect((await downloadEvent).suggestedFilename()).toBe('site-profile.json');
  expect(failures, 'no same-origin asset or page escapes the project path').toEqual([]);
  expect(apiRequests, 'Pages has no collector or function endpoints').toEqual([]);
});

test('GitHub Pages service worker and manifest stay inside the project scope', async ({ page }) => {
  await page.goto(`${base}/`);
  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((registration) => registration.scope));
  expect(scope).toBe(`${base}/`);
  const offline = await page.evaluate(async () => ({
    names: await caches.keys(),
    fallback: Boolean(await caches.match(`${location.origin}/red-room-archive/offline`)),
    chineseFallback: Boolean(await caches.match(`${location.origin}/red-room-archive/zh-CN/offline`)),
  }));
  expect(offline.names).toContain('rra-red-room-archive-pages-v1');
  expect(offline.fallback).toBe(true);
  expect(offline.chineseFallback).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch(`${location.origin}/red-room-archive/manifest.webmanifest`)).json());
  expect(manifest.id).toBe('/red-room-archive/');
  expect(manifest.start_url).toBe('/red-room-archive/');
  expect(manifest.scope).toBe('/red-room-archive/');
  expect(manifest.icons.every((icon) => icon.src.startsWith('/red-room-archive/'))).toBe(true);
});

test('GitHub Pages worker cleans only caches from its exact project scope', async ({ page }) => {
  await page.goto(`${base}/`);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.unregister();
    await Promise.all([
      'rra-red-room-archive-pages-v0',
      'rra-red-room-archive-extra-pages-v0',
      'rra-red-room-archive%2Fnested-pages-v0',
      'rra-pages-v0',
    ].map((name) => caches.open(name)));
  });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(async () => {
    const names = await caches.keys();
    return names.includes('rra-red-room-archive-pages-v1') && !names.includes('rra-red-room-archive-pages-v0');
  })).toBe(true);
  const names = await page.evaluate(() => caches.keys());
  expect(names).toEqual(expect.arrayContaining([
    'rra-red-room-archive-extra-pages-v0',
    'rra-red-room-archive%2Fnested-pages-v0',
    'rra-pages-v0',
  ]));
});
