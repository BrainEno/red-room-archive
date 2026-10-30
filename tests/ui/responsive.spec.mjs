import { test, expect } from '@playwright/test';

const noHorizontalOverflow = async (page) => {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  const offenders = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 && r.width > 0; }).slice(0, 12).map((el) => `${el.tagName}.${el.className} (${Math.round(el.getBoundingClientRect().right)})`));
  expect(dimensions.document, `horizontal overflow: ${JSON.stringify(dimensions)} ${offenders.join(', ')}`).toBeLessThanOrEqual(dimensions.viewport + 1);
};

for (const mode of ['ssr', 'static']) {
  for (const lang of ['en', 'zh-CN']) {
    // The same path URLs on the SSR server and the static snapshot.
    const url = (route) => `${mode === 'ssr' ? '' : 'http://127.0.0.1:4179'}${lang === 'zh-CN' ? `/zh-CN${route === '/' ? '' : route}` : route}`;

    test(`${mode} ${lang}: public layouts fit the viewport`, async ({ page }) => {
      for (const route of ['/', '/articles', '/articles/connect-notion', '/topics', '/archive', '/search', '/more']) {
        const response = await page.goto(url(route), { waitUntil: 'domcontentloaded' });
        expect(response?.status(), route).toBe(200);
        await expect(page.locator('h1').first(), route).toBeAttached();
        await page.evaluate(() => document.fonts.ready);
        await noHorizontalOverflow(page);
      }
    });

    test(`${mode} ${lang}: contents adapts and remains usable`, async ({ page }, testInfo) => {
      await page.goto(url('/articles/connect-notion'));
      const inline = page.locator('.article-inline-toc');
      const rail = page.locator('.article-aside');
      if (testInfo.project.use.viewport.width <= 1100) {
        await expect(inline).toBeVisible();
        await expect(rail).toBeHidden();
        await inline.locator('summary').click();
        await inline.locator('a').first().click();
      } else {
        await expect(inline).toBeHidden();
        await expect(rail).toBeVisible();
        await rail.locator('a').first().click();
      }
      await expect(page.locator('#database-columns')).toBeInViewport();
      await noHorizontalOverflow(page);
    });

    test(`${mode} ${lang}: search and navigation remain usable`, async ({ page }) => {
      await page.goto(url('/search'));
      await page.locator('input[name=q]').fill('Notion');
      await page.locator('form[role=search] button').click();
      await expect(page.locator('.article-entry').first()).toBeVisible();
      await noHorizontalOverflow(page);
      await page.locator('.article-entry').first().click();
      await expect(page.locator('.article-body')).toBeVisible();
      await noHorizontalOverflow(page);
    });
  }
}

test('SSR admin login and tabs fit small screens', async ({ page }) => {
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await expect(page.locator('[data-tab="More"]')).toBeVisible();
  await expect(page.locator('[data-panel="Overview"] .ov-stats')).toBeVisible();
  await noHorizontalOverflow(page);
  for (const tab of ['Overview', 'Articles', 'More', 'Settings', 'Files']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator(`[data-panel="${tab}"]`)).toBeVisible();
    if (tab === 'Articles') {
      await expect(page.locator('.table-scroll')).toBeVisible();
      await expect(page.locator('.table-scroll')).toHaveAttribute('tabindex', '0');
    }
    if (tab === 'More') {
      await page.locator('.me-card summary').first().click();
      await expect(page.locator('.me-card').first()).toHaveAttribute('open', '');
    }
    await noHorizontalOverflow(page);
  }
});

test('inner pages expose keyboard focus and skip navigation', async ({ page }) => {
  await page.goto('/articles');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip')).toBeFocused();
  await expect(page.locator('.skip')).toBeVisible();
  const outline = await page.locator('.skip').evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('home navigation is not blocked by the loader with reduced motion', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.locator('.loader')).not.toBeInViewport({ timeout: 25_000 });
  const latest = page.locator('.bar a[href="#latest"]');
  await expect(latest).toBeVisible();
  await latest.click();
  await expect(page.locator('#latest')).toBeInViewport();
});

test('long unbroken titles and site names do not expand the layout', async ({ page }) => {
  await page.goto('/articles');
  await page.evaluate(() => {
    document.querySelector('.site-brand').textContent = 'Averylongunbrokenarchivename'.repeat(5);
    document.querySelector('.listing h1').textContent = 'LongUnbrokenTitle'.repeat(9);
    document.querySelector('.article-title').textContent = 'LongUnbrokenArticleTitle'.repeat(9);
  });
  await noHorizontalOverflow(page);
  await page.goto('/');
  await page.evaluate(() => { document.querySelector('.row .t').textContent = 'LongUnbrokenArticleTitle'.repeat(9); });
  await noHorizontalOverflow(page);
});

test('read aloud controls respond to supported and unsupported speech APIs', async ({ browser, baseURL }, testInfo) => {
  const { contextOptions, ...projectOptions } = testInfo.project.use;
  const options = { ...projectOptions, ...contextOptions, baseURL };
  // Provide a deterministic fake; no audio is produced and no platform voice is assumed.
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, getVoices: () => [], speak: () => {}, pause: () => {}, resume: () => {}, cancel: () => {},
      } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    await page.goto('/articles/connect-notion');
    await expect(page.locator('[data-read-aloud]')).toBeVisible();
    await page.locator('[data-play]').click();
    await expect(page.locator('[data-read-aloud]')).toHaveAttribute('data-state', 'playing');
    await page.locator('[data-play]').click();
    await expect(page.locator('[data-read-aloud]')).toHaveAttribute('data-state', 'paused');
    await page.locator('[data-stop]').click();
    await expect(page.locator('[data-read-aloud]')).toHaveAttribute('data-state', 'idle');
    await noHorizontalOverflow(page);
  } finally { await context.close(); }
  const unsupported = await browser.newContext(options);
  try {
    const page = await unsupported.newPage();
    await page.addInitScript(() => { Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined }); });
    await page.goto('/articles/connect-notion');
    await expect(page.locator('[data-read-aloud]')).toBeHidden();
  } finally { await unsupported.close(); }
});

test('home remains navigable without WebGL or JavaScript', async ({ browser, baseURL }, testInfo) => {
  const { contextOptions, ...projectOptions } = testInfo.project.use;
  const options = { ...projectOptions, ...contextOptions, baseURL };
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.startsWith('webgl') ? null : original.call(this, type, ...args);
      };
    });
    await page.goto('/');
    await expect(page.locator('.loader')).not.toBeInViewport({ timeout: 25_000 });
    await page.locator('.bar a[href="#latest"]').click();
    await expect(page.locator('#latest')).toBeInViewport();
  } finally { await context.close(); }
  const noJs = await browser.newContext({ ...options, javaScriptEnabled: false });
  try {
    const page = await noJs.newPage();
    await page.goto('/');
    await expect(page.locator('.loader')).toBeHidden();
    await page.locator('.bar a[href="#latest"]').click();
    await expect(page.locator('#latest')).toBeInViewport();
  } finally { await noJs.close(); }
});

test('long content wraps and code and tables scroll within the article', async ({ page }) => {
  await page.goto('/articles/connect-notion');
  const body = page.locator('.article-body');
  await body.evaluate((node) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'UnbrokenContent'.repeat(60) + ' 中文内容'.repeat(30);
    node.append(paragraph);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'x'.repeat(300);
    pre.append(code); node.append(pre);
  });
  await noHorizontalOverflow(page);
  const pre = body.locator('pre').last();
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const table = body.locator('.table-wrap');
  await expect(table).toBeVisible();
  expect(await table.evaluate((el) => el.clientWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('search with no matches communicates the empty state', async ({ page }) => {
  await page.goto('/search');
  await page.locator('input[name=q]').fill('no-such-article-4839');
  await page.locator('form[role=search] button').click();
  await expect(page.locator('[role=status]')).toContainText('0 results');
  await expect(page.locator('.empty')).toBeVisible();
  await noHorizontalOverflow(page);
});

test('the language switcher moves between path URLs and is remembered', async ({ page }) => {
  await page.goto('/articles/page/1');
  await expect(page).toHaveURL(/\/articles$/);
  await page.locator('.site-header [data-lang-switch="zh-CN"]').click();
  await expect(page).toHaveURL(/\/zh-CN\/articles$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.goto('/topics');
  await expect(page, 'the cookie sends unprefixed pages to Chinese').toHaveURL(/\/zh-CN\/topics$/);
  await page.locator('.site-header [data-lang-switch="en"]').click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // The static snapshot has no server to remember a choice: the switcher is a plain path link.
  await page.goto('http://127.0.0.1:4179/archive');
  await page.locator('.site-header [data-lang-switch="zh-CN"]').click();
  await expect(page).toHaveURL('http://127.0.0.1:4179/zh-CN/archive');
});

test('formulas, highlighted code with a copy button and bookmark cards render in articles', async ({ page, context, browserName }) => {
  await page.goto('/articles/notes-on-light');
  const body = page.locator('.article-body');
  await expect(body.locator('.equation math[display="block"]')).toBeVisible();
  await expect(body.locator('p math').first()).toBeVisible();
  expect(await body.locator('math').first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(10);
  await expect(body.locator('a.bookmark')).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Photon');
  await noHorizontalOverflow(page);

  await page.goto('/zh-CN/articles/a-room-with-red-curtains');
  const figure = page.locator('.article-body figure.code');
  await expect(figure.locator('.hljs-string')).toHaveText("'the red room'");
  const copy = figure.getByRole('button', { name: '复制' });
  await expect(copy).toBeAttached();
  await figure.hover();
  await expect(copy).toBeVisible();
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await copy.click();
    await expect(figure.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("console.log('the red room');");
  }
  await noHorizontalOverflow(page);
});

test('a cover that fails to load falls back to the text-only layout', async ({ page }) => {
  await page.goto('/articles');
  const entry = await page.evaluate(async () => {
    const item = document.createElement('div');
    item.className = 'article-entry has-cover';
    item.id = 'broken-cover-probe';
    const image = document.createElement('img');
    image.className = 'article-cover';
    image.src = '/media/notion/00000000000000000000000000000000.png';
    item.append(image);
    document.querySelector('main')?.append(item);
    await new Promise((resolve) => image.addEventListener('error', resolve, { once: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { hasCover: item.classList.contains('has-cover'), images: item.querySelectorAll('img').length };
  });
  expect(entry).toEqual({ hasCover: false, images: 0 });
});

test('admin shows the Notion webhook endpoint and its state', async ({ page }) => {
  await page.goto('/admin');
  await page.locator('#tk').fill('ui-test-only');
  await page.locator('#lg button').click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  const hook = page.locator('#webhook');
  await expect(hook.locator('#webhook-state')).toHaveAttribute('data-state', 'off');
  await expect(hook.locator('#webhook-url')).toHaveValue('https://example.invalid/api/webhooks/notion');
  await expect(hook.locator('#webhook-reset')).toHaveCount(0);
  await noHorizontalOverflow(page);
});
