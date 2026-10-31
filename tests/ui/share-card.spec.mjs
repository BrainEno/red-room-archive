import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

for (const mode of ['ssr', 'static']) {
  const base = mode === 'ssr' ? '' : 'http://127.0.0.1:4179';
  test(`${mode}: article generates a real PNG card, downloads it and copies the clean URL`, async ({ page }) => {
    const articleUrl = `${base || 'http://127.0.0.1:4178'}/articles/connect-notion`;
    await page.goto(`${articleUrl}#reader`);
    await page.evaluate(() => {
      window.__copiedShareUrl = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copiedShareUrl = text; } } });
    });
    const open = page.locator('[data-share-open]');
    await expect(open).toBeVisible();
    await open.click();
    const dialog = page.locator('[data-share-dialog]');
    await expect(dialog).toBeVisible();
    await expect(page.locator('.share-preview-label')).toContainText('Card preview');
    await expect(page.locator('[data-share-bluesky]')).toHaveAttribute('href', `https://bsky.app/intent/compose?text=${encodeURIComponent(articleUrl)}`);
    expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toBeTruthy();
    expect(await page.locator('meta[property="og:description"]').getAttribute('content')).toBeTruthy();
    expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toBeTruthy();
    const downloadButton = page.locator('[data-share-download]');
    await expect(downloadButton).toBeEnabled({ timeout: 15_000 });
    const canvas = page.locator('[data-share-canvas]');
    expect(await canvas.evaluate((node) => [node.width, node.height])).toEqual([1200, 630]);
    const colors = await canvas.evaluate((node) => {
      const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
      let red = false; let light = false;
      for (let index = 0; index < pixels.length; index += 160) {
        if (pixels[index] > 180 && pixels[index + 1] < 110 && pixels[index + 2] < 120) red = true;
        if (pixels[index] > 200 && pixels[index + 1] > 190 && pixels[index + 2] > 175) light = true;
      }
      return { red, light };
    });
    expect(colors, 'the canvas contains both the red room accent and readable article type').toEqual({ red: true, light: true });
    const downloaded = page.waitForEvent('download');
    await downloadButton.click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('connect-notion-share.png');
    const bytes = await readFile(await file.path());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    expect(bytes.length).toBeGreaterThan(1_000);
    expect(bytes.length).toBeLessThan(1_000_000);
    await page.locator('[data-share-copy]').click();
    await expect(page.locator('[data-share-status]')).toHaveText('Link copied.');
    expect(await page.evaluate(() => window.__copiedShareUrl)).toBe(articleUrl);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('permission denied'); } } });
      Object.defineProperty(document, 'execCommand', { configurable: true, value: (command) => {
        window.__fallbackShareUrl = document.activeElement?.value;
        return command === 'copy';
      } });
    });
    await page.locator('[data-share-copy]').click();
    expect(await page.evaluate(() => window.__fallbackShareUrl)).toBe(articleUrl);
    await expect(page.locator('[data-share-copy]')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(open).toBeFocused();
  });
}

test('static zh-CN: a supported device shares the generated file and article URL', async ({ page }) => {
  await page.addInitScript(() => {
    window.__sharedCard = null;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => data.files?.[0]?.type === 'image/png' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => {
      window.__sharedCard = { title: data.title, url: data.url, name: data.files[0].name, type: data.files[0].type, size: data.files[0].size };
    } });
  });
  await page.goto('http://127.0.0.1:4179/zh-CN/articles/connect-notion');
  await page.locator('[data-share-open]').click();
  await expect(page.getByRole('heading', { name: '分享这篇文章' })).toBeVisible();
  const share = page.locator('[data-share-native]');
  await expect(share).toBeVisible({ timeout: 15_000 });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
  await share.click();
  await expect(page.locator('[data-share-status]')).toHaveText('卡片已分享。');
  const shared = await page.evaluate(() => window.__sharedCard);
  expect(shared.title).toBe(await page.locator('[data-article-share]').getAttribute('data-title'));
  expect(shared.url).toBe('http://127.0.0.1:4179/zh-CN/articles/connect-notion');
  expect(shared.name).toBe('connect-notion-share.png');
  expect(shared.type).toBe('image/png');
  expect(shared.size).toBeGreaterThan(1_000);
});

test('static: the share trigger stays hidden without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4179/articles/connect-notion');
  await expect(page.locator('[data-article-share]')).toBeHidden();
  await context.close();
});
