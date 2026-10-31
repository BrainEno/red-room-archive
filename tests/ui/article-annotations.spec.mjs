import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function selectPassage(page, length = 42) {
  return page.evaluate((size) => {
    const body = document.querySelector('.article-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.data.trim().length >= 24 && !node.parentElement?.closest('.code-copy')) break;
    }
    if (!node) throw new Error('No selectable article text');
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(size, node.data.length));
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return range.toString().trim();
  }, length);
}

async function dispatchCopy(page) {
  return page.evaluate(() => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData });
    document.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      text: clipboardData.getData('text/plain'),
      notice: document.querySelector('[data-article-toast]')?.textContent || '',
    };
  });
}

const storedRecords = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('rra-article-annotations-v1:connect-notion') || '[]'));

for (const mode of ['ssr', 'static']) {
  const base = mode === 'ssr' ? '' : 'http://127.0.0.1:4179';

  test(`${mode}: passage highlights and notes persist and flow into a share card`, async ({ page }) => {
    await page.goto(`${base}/articles/connect-notion`);
    const selected = await selectPassage(page);
    const tools = page.locator('[data-selection-tools]');
    await expect(tools).toBeVisible();
    await expect(page.locator('[data-selection-highlight]')).toBeEnabled();
    await page.locator('[data-selection-highlight]').click();
    await expect(page.locator('[data-annotation-shelf]')).toBeVisible();
    expect(await storedRecords(page)).toHaveLength(1);
    const painted = await page.evaluate(() => {
      const highlight = window.CSS?.highlights?.get('rra-saved-passage');
      return highlight ? Array.from(highlight).map((range) => range.toString()) : null;
    });
    if (painted) expect(painted).toContain(selected);

    await page.reload();
    await expect(page.locator('[data-annotation-shelf]')).toBeVisible();
    await expect(page.locator('.annotation-quote')).toHaveText(selected);
    expect(await storedRecords(page)).toHaveLength(1);

    await selectPassage(page);
    await page.locator('[data-selection-note]').click();
    const noteDialog = page.locator('[data-note-dialog]');
    await expect(noteDialog).toBeVisible();
    if (mode === 'ssr') {
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(accessibility.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
    }
    await page.locator('[data-note-input]').fill('A private reading note');
    await page.locator('[data-note-save]').click();
    await expect(noteDialog).not.toBeVisible();
    await expect.poll(async () => (await storedRecords(page))[0]?.note).toBe('A private reading note');

    await selectPassage(page);
    await page.locator('[data-selection-share]').click();
    const shareDialog = page.locator('[data-share-dialog]');
    await expect(shareDialog).toBeVisible();
    await expect(page.locator('[data-share-quote]')).toHaveText(selected);
    await expect(page.locator('[data-share-note]')).toHaveValue('A private reading note');
    const downloadButton = page.locator('[data-share-download]');
    await expect(downloadButton).toBeEnabled({ timeout: 15_000 });
    const beforeNote = await page.locator('[data-share-canvas]').evaluate((canvas) => canvas.toDataURL());
    await page.locator('[data-share-note]').fill('A note for the card');
    await expect(downloadButton).toBeEnabled({ timeout: 15_000 });
    await expect.poll(async () => (await storedRecords(page))[0]?.note).toBe('A note for the card');
    await expect.poll(() => page.locator('[data-share-canvas]').evaluate((canvas) => canvas.toDataURL())).not.toBe(beforeNote);

    await page.evaluate(() => {
      window.__copiedAnnotation = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copiedAnnotation = text; } } });
    });
    await page.locator('[data-share-copy-passage]').click();
    await expect(page.locator('[data-share-status]')).toHaveText('Passage and source copied.');
    const copiedPassage = await page.evaluate(() => window.__copiedAnnotation);
    expect(copiedPassage).toContain(selected);
    expect(copiedPassage).toContain('A note for the card');
    expect(copiedPassage).toContain('SureShot Archive');
    expect(copiedPassage).toContain('Reuse terms:');
    await page.locator('[data-share-copy]').click();
    expect(await page.evaluate(() => window.__copiedAnnotation)).toContain('#:~:text=');

    const downloaded = page.waitForEvent('download');
    await downloadButton.click();
    expect((await downloaded).suggestedFilename()).toBe('connect-notion-passage-share.png');
    await page.locator('[data-share-close]').click();
    await expect(shareDialog).not.toBeVisible();
  });

  test(`${mode}: selection limits, partial-copy watermark and whole-article copy blocking`, async ({ page }) => {
    await page.goto(`${base}/articles/connect-notion`);
    await page.evaluate(() => {
      const body = document.querySelector('.article-body');
      const range = document.createRange();
      range.selectNodeContents(body);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('[data-selection-tools]')).toBeVisible();
    await expect(page.locator('[data-selection-highlight]')).toBeDisabled();
    const full = await dispatchCopy(page);
    expect(full.prevented).toBe(true);
    expect(full.text).toBe('');
    expect(full.notice).toBe('Copying the whole article is disabled. Highlight or share a shorter passage instead.');

    const selected = await selectPassage(page);
    const partial = await dispatchCopy(page);
    expect(partial.prevented).toBe(true);
    expect(partial.text).toContain(selected);
    expect(partial.text).toContain('— Connect your Notion database');
    expect(partial.text).toContain('SureShot Archive');
    expect(partial.text).toContain('All rights reserved');
    expect(partial.notice).toBe('Copied with source and copyright notice.');
  });

  test(`${mode}: article cover can be included or removed from the local PNG`, async ({ page }) => {
    // Demo articles intentionally have no cover. Supply the same component markup
    // and a deterministic same-origin image before any browser module executes.
    await page.route('**/articles/connect-notion', async (route) => {
      const response = await route.fetch();
      const html = (await response.text())
        .replace(/data-article-share(?:="")?/, 'data-article-share data-cover="/og/card.jpg"')
        .replace('</canvas>', '</canvas><label class="share-cover-option"><input type="checkbox" data-share-cover checked><span>Include article cover</span></label>');
      await route.fulfill({ response, body: html });
    });
    await page.goto(`${base}/articles/connect-notion`);
    await page.locator('[data-share-open]').click();
    const cover = page.locator('[data-share-cover]');
    await expect(cover).toBeVisible();
    await expect(cover).toBeChecked();
    const download = page.locator('[data-share-download]');
    await expect(download).toBeEnabled({ timeout: 15_000 });
    const canvas = page.locator('[data-share-canvas]');
    const withCover = await canvas.evaluate((node) => node.toDataURL());
    await cover.setChecked(false);
    await expect(download).toBeEnabled({ timeout: 15_000 });
    await expect.poll(() => canvas.evaluate((node) => node.toDataURL())).not.toBe(withCover);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
}
