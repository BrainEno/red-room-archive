import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapCardText, shareCardPng } from '../src/ui/scripts/site/share-card.ts';

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

test('share card keeps extended graphemes intact when a long run must be shortened', () => {
  const lines = wrapCardText(context, '👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 10, 1, 'en');
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('\u200d'));
  assert.ok(context.measureText(lines[0]).width <= 10);
  assert.deepEqual(wrapCardText(context, '  \n ', 100, 2), []);
});

test('share card PNG encoding reports browser failures instead of downloading an empty file', async () => {
  const canvas = { toBlob(callback) { callback(null); } };
  await assert.rejects(shareCardPng(canvas), /PNG encoding failed/);
});
