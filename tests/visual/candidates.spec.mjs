import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('visual-candidates');
const cases = [
  { name: 'desktop-articles-en', width: 1280, height: 900, url: '/articles' },
  { name: 'phone-articles-zh', width: 390, height: 844, url: '/zh-CN/articles' },
  { name: 'desktop-article-en', width: 1280, height: 900, url: '/articles/connect-notion' },
  { name: 'phone-search-empty', width: 390, height: 844, url: '/search?q=no-such-article' },
];

test('capture deterministic demo pages for review', async ({ page, browser }) => {
  await mkdir(out, { recursive: true });
  await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.goto(item.url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('main')).toBeVisible();
    await page.screenshot({ path: path.join(out, `${item.name}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
    if (process.env.VISUAL_COMPARE === '1') {
      await expect(page).toHaveScreenshot(`${item.name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' });
    }
  }
  await writeFile(path.join(out, 'environment.json'), JSON.stringify({ browser: browser.version(), platform: process.platform, arch: process.arch,
    environment: process.env.CI ? 'CI: mcr.microsoft.com/playwright:v1.56.1-noble' : 'local: not a reference container', font: '@docx-editor.dev/fonts-cjk@2.33.0', locale: 'en-US', timezone: 'UTC', fixedTime: '2026-01-01T12:00:00Z', cases }, null, 2));
});
