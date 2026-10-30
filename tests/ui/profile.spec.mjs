import { test, expect } from '@playwright/test';
import { PROFILE_KEYS } from '../../public/profile-format.js';

const profile = (name = 'Portable Archive') => ({ format: 'red-room-site-profile', version: 2,
  settings: { ...Object.fromEntries(PROFILE_KEYS.map((key) => [key, ''])), site_name: name, site_about: 'Portable description', site_intro_zh: '中文迁移内容', site_facts: 'Based in: Portable City' } });
/** A file written before facts existed (version 1). */
const legacyProfile = (name) => {
  const { site_facts, site_facts_zh, ...settings } = profile(name).settings;
  return { format: 'red-room-site-profile', version: 1, settings };
};
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
  await expect(page.locator('textarea[name=site_facts]')).toHaveValue('Based in: Portable City');
  const bundle = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download content bundle' }).click();
  const zip = await bundle;
  expect(zip.suggestedFilename()).toMatch(/^red-room-content-\d{8}\.zip$/);
  let bytes = Buffer.alloc(0); for await (const chunk of await zip.createReadStream()) bytes = Buffer.concat([bytes, chunk]);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  expect(bytes.includes(Buffer.from('site-profile.json'))).toBeTruthy();
  expect(bytes.includes(Buffer.from('ui-test-only'))).toBeFalsy();
  await page.goto('/?lang=en');
  await expect(page.locator('.facts')).toContainText('Portable City');
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
  // Version 1 files still import; facts become empty (built-in defaults).
  await page.locator('#import').setInputFiles(upload(legacyProfile('Legacy Archive')));
  await expect(page.locator('input[name=site_name]')).toHaveValue('Legacy Archive');
  await expect(page.locator('textarea[name=site_facts]')).toHaveValue('');
});
