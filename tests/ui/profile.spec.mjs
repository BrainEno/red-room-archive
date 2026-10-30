import { test, expect } from '@playwright/test';
import { PROFILE_KEYS } from '../../public/profile-format.js';

const profile = (name = 'Portable Archive') => ({ format: 'red-room-site-profile', version: 1,
  settings: { ...Object.fromEntries(PROFILE_KEYS.map((key) => [key, ''])), site_name: name, site_about: 'Portable description', site_intro_zh: '中文迁移内容' } });
const upload = (json) => ({ name: 'site-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
const readDownload = async (download) => { let text = ''; for await (const chunk of await download.createReadStream()) text += chunk; return JSON.parse(text); };

test('Node admin exports only saved public fields and imports a profile', async ({ page }) => {
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export site profile' }).click();
  const data = await readDownload(await download);
  expect(Object.keys(data.settings).sort()).toEqual([...PROFILE_KEYS].sort());
  expect(JSON.stringify(data)).not.toContain('ui-test-only');
  page.on('dialog', dialog => dialog.accept());
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import site profile' }).click();
  await (await chooser).setFiles(upload(profile()));
  await expect(page.locator('input[name=site_name]')).toHaveValue('Portable Archive');
  await expect(page.locator('textarea[name=site_intro_zh]')).toHaveValue('中文迁移内容');
  await page.goto('/articles?lang=en');
  await expect(page.locator('body')).toContainText('Portable Archive');
  const restore = await page.request.post('/api/settings/profile', { headers: { Authorization: 'Bearer ui-test-only' }, data });
  expect(restore.ok()).toBeTruthy();
});

test('static profile editor is local-only and round-trips the public JSON', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/profile-editor.html');
  await expect(page.locator('body')).toContainText('does not log you in');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#import').setInputFiles(upload(profile('Static Archive')));
  await expect(page.locator('input[name=site_name]')).toHaveValue('Static Archive');
  await expect(page.locator('#message')).toContainText('editor only');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export site-profile.json' }).click();
  expect(await readDownload(await download)).toEqual(profile('Static Archive'));
  const bad = profile(); bad.settings.NOTION_TOKEN = 'secret';
  await page.locator('#import').setInputFiles(upload(bad));
  await expect(page.locator('#message')).toContainText('supported public fields');
  await expect(page.locator('input[name=site_name]')).toHaveValue('Static Archive');
});
