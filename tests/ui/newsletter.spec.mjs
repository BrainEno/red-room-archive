import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const STATIC = 'http://127.0.0.1:4179';
const TOKEN = 'Ab3_' + 'x'.repeat(39);
const axe = async (page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
};
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** A configured newsletter backend, simulated in the browser (no email is sent anywhere). */
async function mockBackend(page, handlers = {}) {
  const calls = [];
  await page.route('**/api/newsletter/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/newsletter/', '');
    calls.push({ path, method: request.method(), body: request.postData() });
    const handler = handlers[path];
    if (handler) return handler(route, request);
    if (path === 'status') return json(route, 200, { enabled: true });
    return json(route, 404, { error: 'Not found', code: 'not_found' });
  });
  return calls;
}

test('Node server without email configuration: the form says so and stores nothing', async ({ page }) => {
  await page.goto('/subscribe');
  const status = page.locator('.letters-page .letters-status').first();
  await expect(status).toContainText('not configured');
  await expect(status).toContainText('Nothing was saved');
  await expect(page.getByLabel('Email address')).toBeDisabled();
  await axe(page);
});

test('static host without the newsletter function: honest "cannot be reached", in both languages', async ({ page }) => {
  await page.goto(`${STATIC}/subscribe`);
  await expect(page.locator('.letters-status').first()).toContainText('cannot be reached');
  await expect(page.getByLabel('Email address')).toBeDisabled();
  await page.goto(`${STATIC}/zh-CN/subscribe`);
  await expect(page.locator('h1')).toHaveText('来信');
  await expect(page.locator('.letters-status').first()).toContainText('无法连接订阅服务');
});

test('sign-up: client validation, then a JSON request; "check your inbox" only after the server accepted', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = await mockBackend(page, { subscribe: async (route) => { await gate; return json(route, 202, { status: 'check-inbox' }); } });
  await page.goto('/subscribe');
  const form = page.locator('.letters-page');
  const input = form.getByLabel('Email address');
  await input.fill('not-an-address');
  await form.getByRole('button', { name: /Subscribe/ }).click();
  await expect(form.locator('.letters-status')).toHaveText('That does not look like an email address.');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(calls.filter((c) => c.path === 'subscribe')).toHaveLength(0);

  await input.fill('Reader@Example.com');
  await form.getByRole('button', { name: /Subscribe/ }).click();
  await expect(form.getByRole('button', { name: /Sending/ })).toBeDisabled();
  await expect(form.locator('.letters-status')).not.toContainText('inbox'); // nothing claimed before the answer
  release();
  await expect(form.locator('.letters-status')).toContainText('check your inbox');
  await expect(form.locator('.letters-status')).toContainText('only when you confirm');
  const sent = calls.find((c) => c.path === 'subscribe');
  expect(JSON.parse(sent.body)).toEqual({ email: 'Reader@Example.com', locale: 'en', source: 'subscribe-page', website: '' });
  await expect(input).toHaveAttribute('readonly', '');
  await axe(page);
});

test('sign-up failures are reported as failures', async ({ page }) => {
  const answers = [
    [503, { error: 'sign-up is paused until tomorrow (UTC): the daily email limit has been reached. You have not been subscribed.', code: 'unavailable', details: { reason: 'daily-limit' } }, 'paused for today'],
    [503, { error: 'sign-up is paused until next month: the monthly email limit has been reached. You have not been subscribed.', code: 'unavailable', details: { reason: 'monthly-limit' } }, 'paused until next month'],
    [502, { error: 'The confirmation email could not be sent. Nothing was activated.', code: 'upstream_error' }, 'could not send'],
    [429, { error: 'Too many requests', code: 'rate_limited' }, 'Too many attempts'],
  ];
  let answer;
  await mockBackend(page, { subscribe: (route) => json(route, answer[0], answer[1]) });
  await page.goto('/subscribe');
  const form = page.locator('.letters-page');
  for (answer of answers) {
    await form.getByLabel('Email address').fill('reader@example.com');
    await form.getByRole('button', { name: /Subscribe/ }).click();
    await expect(form.locator('.letters-status')).toContainText(answer[2]);
    await expect(form.locator('.letters-status')).toHaveAttribute('data-state', 'error');
    await expect(form.getByRole('button', { name: /Subscribe/ })).toBeEnabled(); // retry is possible
  }
});

test('confirm page: token leaves the address bar, nothing happens until the click, then confirmed', async ({ page }) => {
  const calls = await mockBackend(page, { confirm: (route) => json(route, 200, { status: 'confirmed' }) });
  await page.goto(`/newsletter/confirm#token=${TOKEN}`);
  await expect(page).toHaveURL(/\/newsletter\/confirm$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const button = page.getByRole('button', { name: /Confirm subscription/ });
  await expect(button).toBeVisible();
  await axe(page);
  expect(calls.filter((c) => c.path === 'confirm')).toHaveLength(0); // link scanners that only load the page do nothing
  await button.click();
  await expect(page.getByRole('status')).toContainText('You are subscribed');
  expect(JSON.parse(calls.find((c) => c.path === 'confirm').body)).toEqual({ token: TOKEN });
  await expect(page.getByRole('link', { name: 'Read the latest writing' })).toBeVisible();
  await expect(button).toBeHidden();
});

test('confirm page: expired, invalid, repeated and incomplete links', async ({ page }) => {
  let answer = [410, { error: 'expired', code: 'gone', details: { reason: 'expired' } }];
  await mockBackend(page, { confirm: (route) => json(route, ...answer) });
  await page.goto(`/zh-CN/newsletter/confirm#token=${TOKEN}`);
  await page.getByRole('button', { name: /确认订阅/ }).click();
  await expect(page.getByRole('status')).toContainText('已过期');
  await expect(page.getByRole('link', { name: '重新订阅' })).toBeVisible();

  answer = [400, { error: 'invalid', code: 'bad_request', details: { reason: 'invalid' } }];
  await page.goto(`/newsletter/confirm?token=${TOKEN}`);
  await expect(page).toHaveURL(/\/newsletter\/confirm$/);
  await page.getByRole('button', { name: /Confirm subscription/ }).click();
  await expect(page.getByRole('status')).toContainText('invalid or was replaced');

  answer = [200, { status: 'already-confirmed' }];
  await page.goto('about:blank'); // a link opened from an email is a fresh load, not a #hash change
  await page.goto(`/newsletter/confirm#token=${TOKEN}`);
  await page.getByRole('button', { name: /Confirm subscription/ }).click();
  await expect(page.getByRole('status')).toContainText('already confirmed');

  await page.goto('/newsletter/confirm');
  await expect(page.getByRole('status')).toContainText('incomplete');
  await expect(page.getByRole('button', { name: /Confirm subscription/ })).toBeHidden();
});

test('unsubscribe page acts on click and is idempotent from the reader’s point of view', async ({ page }) => {
  const calls = await mockBackend(page, { unsubscribe: (route) => json(route, 200, { status: 'unsubscribed' }) });
  await page.goto(`/zh-CN/newsletter/unsubscribe#token=abc.${'d'.repeat(20)}`);
  await expect(page).toHaveURL(/\/zh-CN\/newsletter\/unsubscribe$/);
  await page.getByRole('button', { name: /退订/ }).click();
  await expect(page.getByRole('status')).toContainText('已退订');
  await expect(page.getByRole('link', { name: '改变主意了？重新订阅' })).toBeVisible();
  expect(calls.filter((c) => c.path === 'unsubscribe')).toHaveLength(1);
  await axe(page);
});

test('entry points are hidden by default; /subscribe and the admin switch keep working', async ({ page }) => {
  await mockBackend(page);
  // The Node harness runs without SHOW_NEWSLETTER_SIGNUP and nothing saved: off.
  await page.goto('/articles/notes-on-light');
  await expect(page.locator('[data-article-title]')).toBeVisible();
  await expect(page.locator('.letters-aside')).toHaveCount(0);
  await expect(page.locator('a[href="/subscribe"]')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('a[href="/subscribe"]')).toHaveCount(0);
  await page.goto('/subscribe');
  await expect(page.locator('.letters-page')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).not.toContain('/subscribe<');

  // Admin → Settings → Newsletter. The browser projects share one server, so the
  // save is answered by a stub (the server side is covered by the API tests).
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  const box = page.getByRole('checkbox', { name: /Show the sign-up on public pages/ });
  await expect(box).not.toBeChecked();
  await expect(page.locator('#newsletter-hint')).toContainText('SHOW_NEWSLETTER_SIGNUP');
  let sent;
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    sent = JSON.parse(route.request().postData() || '{}');
    const current = await (await page.request.get('/api/settings', { headers: { Authorization: 'Bearer ui-test-only' } })).json();
    return json(route, 200, { ...current, values: { ...current.values, newsletter_signup: 'on' } });
  });
  await box.check();
  await page.locator('#sf-save').click();
  await expect.poll(() => sent?.newsletter_signup).toBe('on');
  await page.unroute('**/api/settings');
  await page.getByRole('tab', { name: 'Newsletter', exact: true }).click();
  await expect(page.locator('#nl-entries')).toContainText('Settings');
});

test('with SHOW_NEWSLETTER_SIGNUP=1 the static build links article end, footer and home to the sign-up', async ({ page }) => {
  // The UI snapshot (4179) is built with SHOW_NEWSLETTER_SIGNUP=1, like a Netlify site that opted in.
  await mockBackend(page);
  await page.goto(`${STATIC}/articles/notes-on-light`);
  const aside = page.locator('.letters-aside');
  await expect(aside.getByRole('heading', { name: 'Receive new writing by email.' })).toBeVisible();
  await expect(aside.locator('form')).toHaveAttribute('data-source', 'article');
  await expect(page.locator('.site-footer a[href="/subscribe"]')).toHaveText('Letters');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.goto(`${STATIC}/zh-CN/articles/notes-on-light`);
  await expect(page.locator('.letters-aside h2')).toHaveText('通过邮件接收新文章。');
  await expect(page.locator('.site-footer a[href="/zh-CN/subscribe"]')).toHaveText('邮件订阅');
  await page.goto(`${STATIC}/`);
  await expect(page.locator('.reach a[href="/subscribe"]')).toHaveText('Receive new writing by email');
  expect(await (await page.request.get(`${STATIC}/sitemap.xml`)).text()).toContain('/subscribe<');
});

test('admin Newsletter module on the Node server: counts, delivery state, empty list', async ({ page }) => {
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'Newsletter', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Newsletter' });
  await expect(panel.locator('#nl-counts')).toContainText('Total');
  await expect(panel.locator('#nl-counts')).toContainText('Unsubscribed');
  await expect(panel.locator('#nl-delivery')).toContainText('not configured');
  await expect(panel.locator('#nl-delivery')).toContainText('NEWSLETTER_SECRET');
  await expect(panel.locator('#nl-rows')).toContainText('No subscribers yet.');
  await axe(page);
});

test('admin on the static site: Newsletter still works when Analytics is unavailable', async ({ page }) => {
  const subscribers = [
    { id: 2, email: 'b@example.com', status: 'pending', locale: 'zh-CN', source: 'article', createdAt: '2026-10-02T08:00:00.000Z', confirmedAt: null, unsubscribedAt: null, lastError: 'send_failed', lastErrorAt: '2026-10-02T08:00:01.000Z' },
    { id: 1, email: 'a@example.com', status: 'active', locale: 'en', source: 'subscribe-page', createdAt: '2026-10-01T08:00:00.000Z', confirmedAt: '2026-10-01T08:05:00.000Z', unsubscribedAt: null, lastError: null, lastErrorAt: null },
  ];
  const seen = [];
  await page.route(`${STATIC}/api/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/analytics/')) return json(route, 503, { error: 'Analytics storage unavailable', code: 'unavailable' });
    if (!url.pathname.startsWith('/api/newsletter/')) return route.fulfill({ status: 404, body: 'Not found' }); // a static host
    if (route.request().headers().authorization !== 'Bearer ui-test-only') return json(route, 401, { error: 'Unauthorized', code: 'unauthorized' });
    seen.push(url.pathname + url.search);
    if (url.pathname === '/api/newsletter/admin/export') return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="subscribers.csv"' }, body: '\ufeffemail,status\r\n' });
    const q = url.searchParams.get('q') ?? '';
    const rows = subscribers.filter((s) => s.email.includes(q));
    return json(route, 200, { subscribers: rows, total: rows.length, counts: { total: 2, active: 1, pending: 1, unsubscribed: 0 },
      delivery: { configured: true, provider: 'resend', missing: [], storage: 'netlify-blobs', dailyLimit: 90, sentToday: 3 } });
  });
  await page.goto(`${STATIC}/admin`);
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await expect(page.locator('.nl-static')).toBeVisible();
  const tabs = page.getByRole('tablist').getByRole('tab');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveText('Newsletter');
  const panel = page.getByRole('tabpanel', { name: 'Newsletter' });
  await expect(panel.locator('#nl-delivery')).toContainText('resend');
  await expect(panel.locator('#nl-rows tr')).toHaveCount(2);
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(width.document, 'the wide table scrolls inside its region, not the page').toBeLessThanOrEqual(width.viewport);
  await expect(panel.locator('#nl-rows')).toContainText('last send failed');
  await expect(panel.getByRole('button', { name: 'Resend confirmation' })).toHaveCount(1); // pending rows only
  await panel.locator('#nl-q').fill('a@');
  await expect(panel.locator('#nl-rows tr')).toHaveCount(1);
  await axe(page);
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('subscribers.csv');
  expect(seen.some((s) => s.startsWith('/api/newsletter/admin/export'))).toBe(true);
});
