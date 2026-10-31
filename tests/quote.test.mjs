// The homepage quote: a trailing attribution (`……。——作者`) is split onto its own line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitQuote } from '../src/core/quote.ts';

test('a dash after the end of a sentence starts the attribution, in Chinese and English', () => {
  assert.deepEqual(splitQuote('写作就是艺术家为了自己的个性和荣誉跟大众进行的一场战斗。  ——维托尔德·贡布罗维奇'),
    { quote: '写作就是艺术家为了自己的个性和荣誉跟大众进行的一场战斗。', cite: '——维托尔德·贡布罗维奇' });
  assert.deepEqual(splitQuote('Writing is nothing less than the artist’s duel with the audience—waged for the sake of one’s own singularity and dignity. — Witold Gombrowicz'),
    { quote: 'Writing is nothing less than the artist’s duel with the audience—waged for the sake of one’s own singularity and dignity.', cite: '— Witold Gombrowicz' });
  assert.deepEqual(splitQuote('“Less is more.” -- Mies'), { quote: '“Less is more.”', cite: '-- Mies' });
});

test('dashes inside the quote, sentences after the dash and plain text are left alone', () => {
  const inner = 'Writing is the artist’s duel with the audience—waged for one’s own dignity.';
  assert.deepEqual(splitQuote(inner), { quote: inner, cite: '' });
  assert.deepEqual(splitQuote('He paused. — and then he left.'), { quote: 'He paused. — and then he left.', cite: '' });
  assert.deepEqual(splitQuote('中文引言'), { quote: '中文引言', cite: '' });
  assert.deepEqual(splitQuote(''), { quote: '', cite: '' });
  assert.deepEqual(splitQuote(undefined), { quote: '', cite: '' });
});
