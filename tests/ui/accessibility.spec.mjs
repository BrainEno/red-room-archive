import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const route of ['/articles', '/zh-CN/articles/connect-notion', '/articles/notes-on-light', '/zh-CN/articles/a-room-with-red-curtains', '/search', '/search?q=no-such-article', '/zh-CN/more', '/copyright', '/zh-CN/copyright', '/topics', '/zh-CN/archive', '/admin', 'http://127.0.0.1:4179/zh-CN/articles', 'http://127.0.0.1:4179/profile-editor.html']) {
  test(`automated accessibility scan: ${route}`, async ({ page }) => {
    await page.goto(route);
    if (route === '/admin') await expect(page.locator('#tk')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
  });
}

test('home and article skip links move keyboard focus to main content', async ({ page }) => {
  for (const route of ['/', '/articles']) {
    await page.goto(route);
    if (route === '/') await expect(page.locator('.loader')).not.toBeInViewport({ timeout: 25_000 });
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  }
});

test('admin tabs expose relationships and support keyboard navigation', async ({ page }) => {
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  const list = page.getByRole('tablist', { name: 'Admin sections' });
  const overview = list.getByRole('tab', { name: 'Overview' });
  const articles = list.getByRole('tab', { name: 'Articles' });
  const more = list.getByRole('tab', { name: 'More' });
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Overview' }).locator('.ov-stats')).toBeVisible();
  await expect(more).toHaveAttribute('tabindex', '-1');
  await articles.click();
  await page.keyboard.press('ArrowRight');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'More' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(list.getByRole('tab', { name: 'Files' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(overview).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(list.getByRole('tab', { name: 'Files' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(overview).toBeFocused();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
  await list.getByRole('tab', { name: 'Settings' }).click();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
  await list.getByRole('tab', { name: 'More' }).click();
  await page.locator('.me-card summary').first().click();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
});

test('publication actions are separate from the disclosure and restore focus after moving', async ({ page }) => {
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'More' }).click();
  const first = page.locator('.me-card').first();
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('open', '');
  await expect(first.locator('summary button')).toHaveCount(0);
  await first.getByRole('button', { name: 'Move down' }).click();
  const moved = page.locator('details[data-id="sample-pub-1"]');
  await expect(moved).toHaveAttribute('open', '');
  await expect(moved.getByRole('button', { name: 'Move down' })).toBeFocused();
  await expect(page.locator('.me-card').nth(1)).toHaveAttribute('data-id', 'sample-pub-1');
});

test('focused or hovered links retain text contrast', async ({ page }) => {
  for (const [route, selector] of [
    ['/articles/connect-notion', '.prose .kicker a'],
    ['/more', '.mp-index a'],
    ['/articles', '.site-footer a[href^="mailto:"]'],
    ['/articles/connect-notion', '.prevnext a'],
  ]) {
    await page.goto(route);
    await page.locator(selector).first().hover();
    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
  }
});

test('admin reports a failed login and permits retry', async ({ page }) => {
  await page.route('**/api/auth', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Service temporarily unavailable. Please try again.' }) }));
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await expect(page.getByRole('alert')).toHaveText('Service temporarily unavailable. Please try again.');
  await expect(page.locator('#tk')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.unroute('**/api/auth');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await expect(page.getByRole('tab', { name: 'Articles' })).toBeVisible();
});

test('admin distinguishes configured Notion settings from a verified connection', async ({ page }) => {
  await page.route('**/api/settings', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    data.status.notion = true;
    data.values.hasToken = true;
    data.values.NOTION_TOKEN = '••••1234';
    data.values.NOTION_DATABASE_ID = '0123456789abcdef0123456789abcdef';
    await route.fulfill({ response, json: data });
  });
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.locator('#notion-config-status')).toContainText('Notion settings are configured');
  await expect(page.locator('#notion-config-status')).toContainText('not yet verified');
  await expect(page.locator('input[name="NOTION_TOKEN"]')).toHaveAttribute('placeholder', /configured/);
  await expect(page.locator('input[name="NOTION_TOKEN"]')).toHaveValue('');
});

test('admin speaks Chinese: saved choice, translated shell, grouped settings, unsaved indicator', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByRole('button', { name: '进入' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  const list = page.getByRole('tablist', { name: '后台栏目' });
  await expect(list.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-panel=Overview] .ov-stats')).toContainText('文章');
  await expect(page.locator('.ov-checks')).toContainText('尚未配置 Notion');
  await expect(page.getByRole('button', { name: 'Notion 设置 →' })).toBeVisible();
  await list.getByRole('tab', { name: '设置' }).click();
  await expect(page).toHaveURL(/#settings$/);
  const nav = page.getByRole('navigation', { name: '设置分组' });
  await expect(nav.getByRole('link')).toHaveText(['站点', '首页文案', '主题', '邮件订阅', 'Notion', '备份与静态部署']);
  await expect(page.locator('#sf-state')).toHaveText('所有修改已保存');
  await page.getByRole('textbox', { name: '标语 — 中文' }).fill('测试标语');
  await expect(page.locator('#sf-state')).toHaveText('有未保存的修改');
  await nav.getByRole('link', { name: 'Notion' }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator('#notion-config-status')).toContainText('Notion 尚未完整配置');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
  // The choice is remembered; switching back is one click.
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('rra.admin.lang'))).toBe('en');
});
