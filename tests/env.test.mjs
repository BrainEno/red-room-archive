import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, readEnv } from '../src/lib/env.ts';

test('parseEnv understands comments, export, quotes and inline comments', () => {
  const env = parseEnv([
    '# comment',
    'ADMIN_TOKEN=abc123',
    'export NOTION_TOKEN="secret_x"',
    "EMPTY=''",
    'WITH_COMMENT=value # trailing note',
    'SPACED =  padded  ',
    'not a pair',
  ].join('\n'));
  assert.equal(env.ADMIN_TOKEN, 'abc123');
  assert.equal(env.NOTION_TOKEN, 'secret_x');
  assert.equal(env.EMPTY, '');
  assert.equal(env.WITH_COMMENT, 'value');
  assert.equal(env.SPACED, 'padded');
  assert.ok(!('not a pair' in env));
});

test('parseEnv lets later files override earlier values', () => {
  const env = parseEnv('A=1\nB=2', parseEnv('A=0'));
  assert.deepEqual(env, { A: '1', B: '2' });
});

test('readEnv prefers process.env over everything else', () => {
  process.env.RRA_ENV_TEST = 'from-process';
  try { assert.equal(readEnv('RRA_ENV_TEST'), 'from-process'); }
  finally { delete process.env.RRA_ENV_TEST; }
  assert.equal(readEnv('RRA_DEFINITELY_NOT_SET'), undefined);
});
