import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSlug, slugify } from '../src/core/slug.ts';

test('slugify keeps unicode letters and collapses separators', () => {
  assert.equal(slugify('A Quiet Room'), 'a-quiet-room');
  assert.equal(slugify('  红房间 / Red Room  '), '红房间-red-room');
  assert.equal(slugify('Über—uns'), 'uber-uns');
  assert.equal(slugify(''), '');
});

test('cleanSlug strips traversal characters and dotted edges', () => {
  assert.equal(cleanSlug('../../etc/passwd'), 'etc-passwd');
  assert.equal(cleanSlug('hello?x=1#frag'), 'hello-x-1-frag');
  assert.equal(cleanSlug('.hidden.'), 'hidden');
  assert.equal(cleanSlug('a'.repeat(120)).length, 80);
});
