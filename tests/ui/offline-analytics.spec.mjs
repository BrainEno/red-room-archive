import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SSR = 'http://127.0.0.1:4178';
const STATIC = 'http://127.0.0.1:4179';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const summary = (enabled = true) => ({
  enabled, storage: 'netlify-blobs', retentionDays: 90,
  range: { days: 7, from: '2026-10-25', to: '2026-10-31' },
  totals: { pageviews: 3, today: 2 },
  daily: [{ date: '2026-10-30', views: 1 }, { date: '2026-10-31', views: 2 }],
  pages: [{ key: '/articles/light', views: 2 }, { key: '/zh-CN/more', views: 1 }],
  referrers: [{ key: '(direct)', views: 2 }, { key: 'news.example', views: 1 }],
  locales: [{ key: 'en', views: 2 }, { key: 'zh-CN', views: 1 }],
});

async function waitForWorker(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // The install has populated the two localised fallbacks before ready resolves.
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function setOutage(page, base, id, value) {
  const mode = value === true ? 1 : value === false ? 0 : value;
  const response = await page.request.post(`${base || SSR}/__harness/outage?id=${id}&value=${mode}`);
  expect(response.status()).toBe(204);
}

for (const origin of ['', STATIC]) {
  test(`offline reload and uncached fallback (${origin ? 'static' : 'SSR'})`, async ({ page }) => {
    const base = origin || '';
    const id = `offline-${origin ? 'static' : 'ssr'}-${test.info().project.name}-${test.info().workerIndex}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    await page.context().addCookies([{ name: 'rra_harness_outage', value: id, url: base || SSR }]);
    await setOutage(page, base, id, false);
    try {
      await page.goto(`${base}/articles/notes-on-light`, { waitUntil: 'networkidle' });
      await waitForWorker(page);
      // This navigation is intercepted and saved by the active worker.
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('[data-article-title]')).toBeVisible();
      // Refuse the actual origin connection. Browser-level offline emulation
      // does not reliably reach workers in Firefox and can crash WebKit reload.
      await setOutage(page, base, id, true);
      const saved = await page.reload({ waitUntil: 'domcontentloaded' });
      expect(saved?.fromServiceWorker()).toBe(true);
      await expect(page.locator('[data-article-title]')).toHaveText('Notes on light');
      await expect(page.locator('h1')).toHaveText('Notes on light');
      await setOutage(page, base, id, 503);
      const degraded = await page.reload({ waitUntil: 'domcontentloaded' });
      expect(degraded?.fromServiceWorker()).toBe(true);
      await expect(page.locator('h1')).toHaveText('Notes on light');
      await setOutage(page, base, id, true);
      const fallback = await page.goto(`${base}/topics`, { waitUntil: 'domcontentloaded' });
      expect(fallback?.fromServiceWorker()).toBe(true);
      await expect(page.locator('h1')).toHaveText('The connection is out');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      await page.goto(`${base}/zh-CN/topics`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1')).toHaveText('连接已中断');
    } finally {
      await setOutage(page, base, id, false);
    }
  });
}

// Playwright WebKit does not reliably route intercepted POST bodies
// after a worker controls the page. Offline behaviour is covered above; these
// API tests deliberately isolate the application requests from that driver bug.
test.describe('analytics APIs without service-worker routing', () => {
  test.use({ serviceWorkers: 'block' });

test('public collector sends only path and referrer host; the owner sees real SQLite aggregates', async ({ page }) => {
  const beacons = [];
  const beaconResponses = [];
  await page.route('**/api/analytics/collect', async (route) => {
    beacons.push(JSON.parse(route.request().postData() || '{}'));
    const response = await route.fetch();
    beaconResponses.push({ status: response.status(), body: await response.text() });
    await route.fulfill({ response });
  });
  await page.goto('/articles/notes-on-light', { waitUntil: 'networkidle' });
  await expect.poll(() => beacons.length).toBe(1);
  expect(beacons[0]).toEqual({ path: '/articles/notes-on-light', referrer: '' });
  expect(JSON.stringify(beacons[0])).not.toContain('query');
  await page.locator('.site-header a[href="/more"]').click();
  await page.waitForURL('**/more');
  await expect.poll(() => beacons.length).toBe(2);
  expect(beacons[1]).toEqual({ path: '/more', referrer: '(internal)' });
  await page.goto('/zh-CN/more', { waitUntil: 'networkidle' });
  await expect.poll(() => beacons.length).toBe(3);
  expect(beacons[2]).toEqual({ path: '/zh-CN/more', referrer: '' });
  expect(beaconResponses).toEqual([{ status: 204, body: '' }, { status: 204, body: '' }, { status: 204, body: '' }]);
  expect(await page.evaluate(() => ({ cookies: document.cookie, local: localStorage.length, session: sessionStorage.length }))).toEqual({ cookies: '', local: 0, session: 0 });

  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'Pageviews', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Pageviews' });
  await expect(panel.locator('#an-pages')).toContainText('/articles/notes-on-light');
  await expect(panel.locator('#an-pages')).toContainText('/zh-CN/more');
  await expect(panel.locator('#an-referrers')).toContainText('Internal navigation');
  await expect(panel.locator('#an-storage')).toContainText('SQLite');
  await expect(panel.locator('#an-enabled')).toBeChecked();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
});

test('static admin analytics: range, pause, CSV and clear use the same bearer API', async ({ page }) => {
  let enabled = true;
  let days = 30;
  let cleared = false;
  const calls = [];
  await page.route(`${STATIC}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/analytics/')) return json(route, { error: 'Not found', code: 'not_found' }, 404);
    if (request.headers().authorization !== 'Bearer ui-test-only') return json(route, { error: 'Unauthorized', code: 'unauthorized' }, 401);
    calls.push(`${request.method()} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/analytics/admin/summary') {
      days = Number(url.searchParams.get('days') || 30);
      return json(route, { ...summary(enabled), range: { days, from: '2026-10-01', to: '2026-10-31' } });
    }
    if (url.pathname === '/api/analytics/admin/settings' && request.method() === 'PATCH') {
      enabled = request.postDataJSON().enabled;
      return json(route, { enabled });
    }
    if (url.pathname === '/api/analytics/admin/export') {
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="pageviews.csv"' }, body: '\ufeffdate,metric,key,pageviews\r\n2026-10-31,total,,3\r\n' });
    }
    if (url.pathname === '/api/analytics/admin/data' && request.method() === 'DELETE') {
      cleared = true;
      return json(route, { cleared: true });
    }
    return json(route, { error: 'Not found', code: 'not_found' }, 404);
  });
  await page.goto(`${STATIC}/admin`);
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  const tabs = page.getByRole('tablist').getByRole('tab');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveText('Pageviews');
  const panel = page.getByRole('tabpanel', { name: 'Pageviews' });
  await expect(panel.locator('#an-storage')).toContainText('Netlify Blobs');
  await panel.locator('#an-range').selectOption('7');
  await expect.poll(() => days).toBe(7);
  await panel.locator('#an-enabled').uncheck();
  await expect(panel.locator('#an-disabled')).toBeVisible();
  const download = page.waitForEvent('download');
  await panel.locator('#an-export').click();
  expect((await download).suggestedFilename()).toBe('pageviews.csv');
  page.once('dialog', (dialog) => dialog.accept());
  await panel.locator('#an-clear').click();
  await expect.poll(() => cleared).toBe(true);
  expect(calls.some((call) => call.startsWith('PATCH /api/analytics/admin/settings'))).toBe(true);
  expect(calls.some((call) => call.startsWith('GET /api/analytics/admin/export?days=7'))).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('DNT and GPC requests are ignored by the real Node endpoint', async ({ page }) => {
  for (const headers of [{ DNT: '1' }, { 'Sec-GPC': '1' }]) {
    const response = await page.request.post('/api/analytics/collect', { headers, data: { path: '/articles/privacy-signal', referrer: '' } });
    expect(response.status()).toBe(204);
  }
  const report = await page.request.get('/api/analytics/admin/summary?days=7', { headers: { Authorization: 'Bearer ui-test-only' } });
  const body = await report.json();
  expect(body.pages.some((item) => item.key === '/articles/privacy-signal')).toBe(false);
});
});
