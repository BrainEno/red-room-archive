import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_LIMIT,
  PASSAGE_LIMIT,
  annotationStorageKey,
  characterCount,
  isNearlyWholeArticle,
  parseAnnotations,
  watermarkedCopy,
} from '../src/shared/article-annotations.ts';

const data = {
  title: 'A Room', siteName: 'SureShot Archive', articleUrl: 'https://archive.example/articles/a-room',
  copyrightUrl: 'https://archive.example/copyright', year: 2026, locale: 'en',
};

test('copy watermark preserves the excerpt and appends article, source and reuse terms', () => {
  const result = watermarkedCopy('A selected passage.\n', data);
  assert.match(result, /^A selected passage\.\n\n— A Room/);
  assert.match(result, /SureShot Archive · https:\/\/archive\.example\/articles\/a-room/);
  assert.match(result, /All rights reserved/);
  assert.match(result, /Reuse terms: https:\/\/archive\.example\/copyright$/);
  const zh = watermarkedCopy('选段', { ...data, locale: 'zh-CN' });
  assert.match(zh, /——《A Room》/);
  assert.match(zh, /来源：SureShot Archive/);
  assert.match(zh, /转载请注明出处/);
});

test('annotation parsing keeps valid local records and rejects malformed or oversized data', () => {
  const key = annotationStorageKey('a-room');
  assert.equal(key, 'rra-article-annotations-v1:a-room');
  const valid = { id: 'one', start: 2, end: 9, text: 'passage', prefix: 'a ', suffix: ' room', note: 'remember', createdAt: 1, updatedAt: 2 };
  assert.deepEqual(parseAnnotations(JSON.stringify([valid, null, { id: 'bad' }]))[0], valid);
  assert.deepEqual(parseAnnotations('{broken'), []);
  assert.deepEqual(parseAnnotations(JSON.stringify([{ ...valid, text: '字'.repeat(PASSAGE_LIMIT + 1) }])), []);
  assert.deepEqual(parseAnnotations(JSON.stringify([{ ...valid, note: 'x'.repeat(NOTE_LIMIT + 1) }])), []);
});

test('character and full-article checks are Unicode aware and leave shorter quotations available', () => {
  assert.equal(characterCount('A👨‍👩‍👧‍👦字'), 9);
  assert.equal(isNearlyWholeArticle(90, 100), true);
  assert.equal(isNearlyWholeArticle(89, 100), false);
  assert.equal(isNearlyWholeArticle(0, 0), false);
});
