import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const both = (en, zh = en) => ({ en, 'zh-CN': zh });

async function expectPublicationLayout(page) {
  const viewport = page.viewportSize();
  const rows = await page.locator('.pub').evaluateAll((elements) => elements.map((element) => {
    const row = element.getBoundingClientRect();
    const cover = element.querySelector('.pub-cover').getBoundingClientRect();
    const body = element.querySelector('.pub-body').getBoundingClientRect();
    const style = getComputedStyle(element);
    const bodyStyle = getComputedStyle(element.querySelector('.pub-body'));
    return {
      gridContainer: element.classList.contains('grid12'), display: style.display, clear: style.clear,
      tracks: style.gridTemplateColumns.split(' ').length, x: row.x, y: row.y, bottom: row.bottom,
      coverRight: cover.right, coverBottom: cover.bottom, bodyX: body.x, bodyY: body.y,
      bodyPaddingLeft: bodyStyle.paddingLeft, bodyMarginLeft: bodyStyle.marginLeft,
    };
  }));
  expect(rows).toHaveLength(3);
  rows.forEach((row, index) => {
    expect(row.gridContainer).toBe(true);
    expect(row.display).toBe('grid');
    expect(row.clear).toBe('both');
    if (index > 0) expect(row.y).toBeGreaterThanOrEqual(rows[index - 1].bottom - 1);
    if (viewport.width > 900) {
      expect(row.bodyX).toBeGreaterThanOrEqual(row.coverRight);
      expect(row.tracks).toBe(12);
    } else {
      expect(row.tracks).toBe(1);
      expect(row.bodyY).toBeGreaterThanOrEqual(row.coverBottom - 1);
      expect(Math.abs(row.bodyX - row.x)).toBeLessThanOrEqual(1);
      expect(row.bodyPaddingLeft).toBe('0px');
      expect(row.bodyMarginLeft).toBe('0px');
    }
  });
  const sections = await page.locator('.mp-sec').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).clear));
  expect(sections).toEqual(['both', 'both']);
  const contact = page.locator('.reachout');
  await expect(contact).toHaveClass(/grid12/);
  expect(await contact.evaluate((element) => getComputedStyle(element).display)).toBe('grid');
  expect(await contact.evaluate((element) => getComputedStyle(element).clear)).toBe('both');
}

for (const locale of ['en', 'zh-CN']) {
  const chinese = locale === 'zh-CN';
  const route = chinese ? '/zh-CN/more' : '/more';
  test(`${locale}: More renders supplied publications, statuses and safe CTAs`, async ({ page }) => {
    await page.goto(route);
    await page.evaluate(() => document.fonts.ready);
    const publications = page.locator('.pub');
    await expect(publications).toHaveCount(3);
    await expect(page.locator('#mp-pub')).toContainText(chinese ? '纸本出版物' : 'Print editions');
    await expect(page.locator('#mp-else')).toContainText(chinese ? '联系' : 'Elsewhere');
    await expect(publications.nth(0).locator('.pub-title')).toHaveText(chinese ? '孱弱的恶' : 'The Weak Demon');
    await expect(publications.nth(1).locator('.pub-title')).toHaveText(chinese ? '动物标本' : 'Animal Specimens');
    await expect(publications.nth(2).locator('.pub-title')).toHaveText(chinese ? '自然研究' : 'Studies in Nature');
    await expect(publications.nth(0).locator('.pub-status')).toContainText(chinese ? '已售罄' : 'Sold out');
    await expect(publications.nth(1).locator('.pub-status')).toContainText(chinese ? '可联系作者' : 'Available by enquiry');
    await expect(publications.nth(2).locator('.pub-status')).toContainText(chinese ? '整理中' : 'In preparation');
    await expect(publications.nth(2).locator('.pub-n')).toContainText(chinese ? '2026–2027（预计）' : '2026–2027 (planned)');
    const firstRun = publications.nth(0).locator('.pub-specs > div').first();
    await expect(firstRun.locator('dt')).toHaveText(chinese ? '印数' : 'Print run');
    await expect(firstRun.locator('dd')).toHaveText(chinese ? '20 本' : '20 copies');
    await expect(publications.nth(2).locator('.pub-specs')).toContainText(chinese ? '预计首印' : 'Planned print run');

    await expect(publications.nth(0).locator('.btn')).toHaveCount(0);
    await expect(publications.nth(0).locator('.pub-description')).toHaveCount(0);
    await expect(publications.nth(1).locator('.pub-description')).toHaveText(chinese
      ? '可联系我安排邮寄。定价由出版方制定，我可以协助联系购买渠道。'
      : 'Contact me to arrange a copy by post. The price is set by the publisher; I can help put you in touch with the sales channel.');
    await expect(publications.nth(2).locator('.pub-description')).toHaveText(chinese
      ? '预计于 2026 年底至 2027 年初印刷，首印暂定 20 本。现可提前联系登记预订意向；印刷时间和数量仍可能调整。'
      : 'Printing is tentatively planned for late 2026 or early 2027, with an initial run of 20 copies. You can contact me to register your interest; the schedule and quantity may change.');
    await expect(page.locator('.pub-excerpt')).toHaveCount(0);
    await expect(page.locator('.pub-cover img')).toHaveCount(0);
    await expect(page.locator('.type-cover')).toHaveCount(3);
    await expect(page.locator('.channels')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('your-handle');

    const emailHref = await page.locator('.mail-big').getAttribute('href');
    expect(emailHref).toMatch(/^mailto:.+@/);
    const contact = publications.nth(1).locator('.btn');
    const preorder = publications.nth(2).locator('.btn');
    await expect(contact).toContainText(chinese ? '联系作者' : 'Contact the author');
    await expect(preorder).toContainText(chinese ? '登记预订意向' : 'Register interest');
    const contactHref = await contact.getAttribute('href');
    const preorderHref = await preorder.getAttribute('href');
    expect(contactHref?.startsWith(`${emailHref}?subject=`)).toBe(true);
    expect(preorderHref?.startsWith(`${emailHref}?subject=`)).toBe(true);
    expect(new URL(contactHref).searchParams.get('subject')).toBe(chinese ? '关于《动物标本》' : 'About “Animal Specimens”');
    expect(new URL(preorderHref).searchParams.get('subject')).toBe(chinese ? '《自然研究》预订意向' : 'Pre-order interest: “Studies in Nature”');

    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    await expectPublicationLayout(page);
  });
}

for (const locale of ['en', 'zh-CN']) {
  const chinese = locale === 'zh-CN';
  test(`${locale}: homepage points to print editions, excerpts and Elsewhere`, async ({ page }) => {
    await page.goto(chinese ? '/zh-CN/' : '/');
    await expect(page.locator('.go-hint')).toHaveText(chinese
      ? '部分重要作品，暂时不打算放在这里。'
      : 'Some important works are not available here, for now.');
    await expect(page.locator('#more .reach .what')).toHaveText(chinese
      ? '纸本出版物 · 选读 · 联系方式'
      : 'Print editions · Excerpts · Elsewhere');
  });
}

test('More grid keeps cover-left/text-right at 1024px and clears rows in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/more');
  await page.evaluate(() => document.fonts.ready);
  await expectPublicationLayout(page);
  await page.goto('/zh-CN/more');
  await page.evaluate(() => document.fonts.ready);
  await expectPublicationLayout(page);
});

test('admin More edits, saves, exports and imports status and description without losing existing fields', async ({ page }) => {
  let document = {
    intro: both('Editor fixture'),
    publications: [{
      id: 'editor-book',
      title: both('Editor Book', '编辑用书'),
      subtitle: both('Fixture'),
      description: both('Before editing', '编辑前'),
      year: both('2026'),
      availability: 'contact',
      format: both(''),
      pages: null,
      edition: both('20 copies', '20 本'),
      size: both('A5'),
      cover: '/uploads/existing-cover.png',
      excerpt: both(''),
      excerptSource: both(''),
      link: 'https://example.test/existing-link',
      linkLabel: both('Existing link', '现有链接'),
    }],
    channels: [{ id: 'editor-channel', name: both('Channel'), handle: 'fixture', href: 'https://example.test/channel', qr: '/uploads/existing-qr.png', note: both('') }],
  };
  let saved;
  await page.route('**/api/more/document', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ document, custom: true, updated: null }) });
      return;
    }
    if (request.method() === 'PUT') {
      const incoming = request.postDataJSON();
      document = {
        ...incoming,
        publications: incoming.publications.map((publication) => ({
          description: both(''),
          ...publication,
          year: typeof publication.year === 'string' ? both(publication.year) : publication.year,
        })),
      };
      saved = structuredClone(document);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ document, custom: true, updated: '2026-10-31T00:00:00.000Z' }) });
      return;
    }
    await route.fulfill({ status: 405 });
  });

  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'More' }).click();
  const card = page.locator('details[data-id="editor-book"]');
  await card.locator('summary').click();
  await expect(card).toHaveAttribute('open', '');
  await card.locator('[data-path="publications.0.availability"]').selectOption('preorder');
  await card.locator('[data-path="publications.0.description.en"]').fill('Multiline note\nSecond line');
  await card.locator('[data-path="publications.0.description.zh-CN"]').fill('第一行\n第二行');
  await page.locator('#me-save').click();
  await expect.poll(() => saved?.publications[0].availability).toBe('preorder');
  expect(saved.publications[0].description).toEqual({ en: 'Multiline note\nSecond line', 'zh-CN': '第一行\n第二行' });
  expect(saved.publications[0].cover).toBe('/uploads/existing-cover.png');
  expect(saved.publications[0].link).toBe('https://example.test/existing-link');
  expect(saved.channels[0].qr).toBe('/uploads/existing-qr.png');

  const downloadEvent = page.waitForEvent('download');
  await page.locator('#me-export').click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.document.publications[0].availability).toBe('preorder');
  expect(exported.document.publications[0].description.en).toBe('Multiline note\nSecond line');
  expect(exported.document.publications[0].cover).toBe('/uploads/existing-cover.png');
  expect(exported.document.channels).toHaveLength(1);

  const legacy = exported.document;
  delete legacy.publications[0].availability;
  delete legacy.publications[0].description;
  page.once('dialog', (dialog) => dialog.accept());
  const chooserEvent = page.waitForEvent('filechooser');
  await page.locator('#me-import').click();
  const chooser = await chooserEvent;
  await chooser.setFiles({ name: 'legacy-more.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ document: legacy })) });
  await expect.poll(() => saved?.publications[0].description.en).toBe('');
  expect(saved.publications[0].availability).toBeUndefined();
  await expect(card.locator('[data-path="publications.0.availability"]')).toHaveValue('');
  await expect(card.locator('[data-path="publications.0.description.en"]')).toHaveValue('');
  await expect(card.locator('[data-path="publications.0.cover"]')).toHaveValue('/uploads/existing-cover.png');
  await expect(card.locator('[data-path="publications.0.link"]')).toHaveValue('https://example.test/existing-link');
  await expect(page.locator('details[data-id="editor-channel"]')).toHaveCount(1);
});
