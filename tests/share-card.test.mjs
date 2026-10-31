import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShareCard, wrapCardText, shareCardPng } from '../src/ui/scripts/site/share-card.ts';

const context = {
  measureText(text) {
    const length = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)).length;
    return { width: length * 10 };
  },
};

test('share card wraps Latin text at words and normalizes whitespace', () => {
  const lines = wrapCardText(context, 'The   red\nroom remembers', 90, 4, 'en');
  assert.deepEqual(lines, ['The red', 'room', 'remembers']);
  assert.ok(lines.every((line) => context.measureText(line).width <= 90));
});

test('share card wraps CJK without horizontal overflow and ellipsizes only the final line', () => {
  const lines = wrapCardText(context, '红室收藏小说诗歌以及其他文字', 40, 3, 'zh-CN');
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => context.measureText(line).width <= 40));
  assert.ok(lines.at(-1).endsWith('…'));
  assert.ok(lines.slice(0, -1).every((line) => !line.endsWith('…')));
});

test('share card rebalances a short CJK tail instead of orphaning punctuation', () => {
  const text = '一二三四五六七八九十甲乙。';
  const lines = wrapCardText(context, text, 120, undefined, 'zh-CN');
  assert.equal(lines.join(''), text);
  assert.ok(Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(lines.at(-1))).length > 2);
});

test('share card keeps extended graphemes intact when a long run must be shortened', () => {
  const lines = wrapCardText(context, '👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 10, 1, 'en');
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('\u200d'));
  assert.ok(context.measureText(lines[0]).width <= 10);
  assert.deepEqual(wrapCardText(context, '  \n ', 100, 2), []);
});

function renderCard(overrides = {}) {
  const drawn = [];
  const gradient = { addColorStop() {} };
  const context = {
    font: '16px serif', textBaseline: 'top', textAlign: 'left', fillStyle: '', strokeStyle: '', lineWidth: 1,
    measureText(text) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || 16);
      const width = Array.from(text).reduce((total, character) => total + (/\p{Script=Han}/u.test(character) ? size : size * .55), 0);
      return { width };
    },
    fillText(text, x, y) { drawn.push({ text, x, y }); },
    fillRect() {}, strokeRect() {}, save() {}, restore() {}, drawImage() {},
    createRadialGradient() { return gradient; }, createLinearGradient() { return gradient; },
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const ok = drawShareCard(canvas, {
    title: 'A Room', excerpt: '', date: '2026-10-31', siteName: 'SureShot Archive', tags: 'Fiction',
    articleUrl: 'https://archive.example/articles/a-room', locale: 'zh-CN', ...overrides,
  });
  assert.equal(ok, true);
  return drawn;
}

test('cards keep a complete 200-character excerpt or passage and show the article URL', () => {
  const excerpt = '摘'.repeat(200);
  const excerptCard = renderCard({ excerpt });
  assert.ok(excerptCard.map((line) => line.text).join('').includes(excerpt));
  assert.ok(excerptCard.every((line) => !line.text.includes('…')));

  const quote = '选'.repeat(200);
  const note = '注'.repeat(280);
  const passageCard = renderCard({ quote, note });
  assert.ok(passageCard.map((line) => line.text).join('').includes(quote));
  assert.ok(passageCard.map((line) => line.text).join('').includes(note));
  assert.ok(passageCard.every((line) => !line.text.includes('…')));
  assert.ok(passageCard.filter((line) => /^[选注]+$/u.test(line.text)).every((line) => line.y < 528), 'reader text stays above the URL footer');
  assert.ok(passageCard.map((line) => line.text).join('').includes('https://archive.example/articles/a-room'));
});

test('share card PNG encoding reports browser failures instead of downloading an empty file', async () => {
  const canvas = { toBlob(callback) { callback(null); } };
  await assert.rejects(shareCardPng(canvas), /PNG encoding failed/);
});
