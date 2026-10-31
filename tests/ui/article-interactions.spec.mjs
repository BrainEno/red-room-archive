import { test, expect } from '@playwright/test';

test('article rows use a typographic hover/focus without a panel or pink arrow', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/articles');
  const entry = page.locator('.article-entry').first();
  const before = await entry.locator('.article-excerpt').evaluate((node) => Number(getComputedStyle(node).opacity));
  if (testInfo.project.use.hasTouch) await entry.focus();
  else await entry.hover();
  await expect(entry.locator('.article-excerpt')).toHaveCSS('opacity', '0.78');
  const styles = await entry.evaluate((node) => ({
    background: getComputedStyle(node).backgroundImage,
    arrow: getComputedStyle(node.querySelector('.article-arrow')).color,
    arrowOpacity: getComputedStyle(node.querySelector('.article-arrow')).opacity,
    titleDecoration: getComputedStyle(node.querySelector('.article-title')).textDecorationLine,
    excerptOpacity: Number(getComputedStyle(node.querySelector('.article-excerpt')).opacity),
    excerptTransition: getComputedStyle(node.querySelector('.article-excerpt')).transitionDuration,
  }));
  expect(styles.background).toBe('none');
  expect(styles.arrow).toBe('rgb(241, 238, 230)');
  expect(styles.arrowOpacity).toBe('1');
  expect(styles.titleDecoration).toContain('underline');
  expect(styles.excerptOpacity).toBeGreaterThan(before);
  expect(styles.excerptTransition).toBe('0s');
  if ((testInfo.project.use.viewport?.width || 0) >= 1000) {
    const widths = await entry.evaluate((node) => ({
      copy: node.querySelector('.article-copy').getBoundingClientRect().width,
      excerpt: node.querySelector('.article-excerpt').getBoundingClientRect().width,
    }));
    expect(widths.excerpt, 'the excerpt keeps its narrower editorial measure').toBeLessThan(widths.copy);
  }
});

for (const base of ['', 'http://127.0.0.1:4179']) {
  test(`read aloud underlines the current word, follows passages and remembers the opt-out (${base ? 'static' : 'SSR'})`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, spoken: [], getVoices: () => [],
        speak(value) { this.spoken.push(value); },
        pause() { this.paused = true; }, resume() { this.paused = false; }, cancel() {},
      } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    await page.goto(`${base}/articles/connect-notion`);
    const follow = page.locator('[data-follow]');
    await expect(follow).toBeChecked();
    await page.locator('[data-play]').click();
    await page.evaluate(() => window.speechSynthesis.spoken[0].onboundary({ charIndex: 0, charLength: 7 }));
    const tracking = await page.evaluate(() => {
      const highlight = window.CSS?.highlights?.get('read-aloud-current');
      return {
        supported: Boolean(window.Highlight && window.CSS?.highlights),
        words: highlight ? Array.from(highlight).map((range) => range.toString()) : [],
        block: document.querySelector('.read-aloud-current-block')?.textContent || '',
      };
    });
    if (tracking.supported) expect(tracking.words).toEqual(['Connect']);
    else expect(tracking.block).toContain('Connect your Notion database');
    const betweenPassages = await page.evaluate(() => {
      window.speechSynthesis.spoken[0].onend();
      return {
        highlight: window.CSS?.highlights?.has('read-aloud-current') || false,
        blocks: document.querySelectorAll('.read-aloud-current-block').length,
      };
    });
    if (tracking.supported) {
      expect(betweenPassages, 'no whole-paragraph flash before the next word boundary').toEqual({ highlight: false, blocks: 0 });
    }

    await page.evaluate(() => {
      for (let index = 0; index < 8 && window.scrollY === 0; index++) window.speechSynthesis.spoken.at(-1).onend();
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await follow.setChecked(false);
    expect(await page.evaluate(() => localStorage.getItem('rra-read-aloud-follow'))).toBe('0');
    const stoppedAt = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.speechSynthesis.spoken.at(-1).onend());
    expect(await page.evaluate(() => window.scrollY)).toBe(stoppedAt);
    expect(await page.evaluate(() => ({
      highlight: window.CSS?.highlights?.has('read-aloud-current'),
      blocks: document.querySelectorAll('.read-aloud-current-block').length,
    }))).toEqual({ highlight: false, blocks: 0 });

    await page.reload();
    await expect(follow).not.toBeChecked();
    await follow.setChecked(true);
    await page.locator('[data-play]').click();
    expect(await page.evaluate(() => localStorage.getItem('rra-read-aloud-follow'))).toBe('1');
    await expect(page.locator('[data-read-aloud]')).toHaveAttribute('data-state', 'playing');
  });
}
