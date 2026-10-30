// Homepage facts text, profile format v2 (and v1 compatibility), and the ZIP
// writer behind GET /api/content-bundle. Pure modules only — no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { factsError, formatFacts, parseFacts, MAX_FACTS } from '../src/core/facts.ts';
import { PROFILE_KEYS, PROFILE_VERSION, makeProfile, validateProfile } from '../public/profile-format.js';
import { safeEntryName, zipStream } from '../src/server/storage/zip.ts';
import { readZip } from './fixtures/zip-reader.mjs';

const DEFAULTS = [{ key: 'Based in', value: 'Your city' }];

test('facts: empty → defaults, "-" hides, first colon splits, full-width colon works', () => {
  assert.deepEqual(parseFacts('', DEFAULTS), DEFAULTS);
  assert.deepEqual(parseFacts(undefined, DEFAULTS), DEFAULTS);
  assert.deepEqual(parseFacts(' - ', DEFAULTS), []);
  assert.deepEqual(parseFacts('Open: 10:00–18:00\n所在：台北\n\n  ', DEFAULTS), [
    { key: 'Open', value: '10:00–18:00' },
    { key: '所在', value: '台北' },
  ]);
  // Rendering is lenient: malformed lines are skipped, extras dropped.
  const many = Array.from({ length: 9 }, (_, i) => `K${i}: v${i}`).join('\n');
  assert.equal(parseFacts(`no separator\n${many}`, DEFAULTS).length, MAX_FACTS);
});

test('facts: strict validation for saving', () => {
  assert.equal(factsError(''), null);
  assert.equal(factsError('-'), null);
  assert.equal(factsError('Based in: Taipei\n写作：随笔'), null);
  assert.match(factsError('just text'), /Label: value/);
  assert.match(factsError('Label:'), /line 1/);
  assert.match(factsError(Array.from({ length: 7 }, (_, i) => `K${i}: v`).join('\n')), /at most 6/);
  assert.match(factsError(`${'x'.repeat(41)}: v`), /label/);
  assert.match(factsError(`k: ${'x'.repeat(201)}`), /value/);
});

test('facts: format is the inverse of parse', () => {
  const facts = [{ key: 'A', value: 'b: c' }, { key: '所在', value: '台北' }];
  assert.deepEqual(parseFacts(formatFacts(facts), []), facts);
  assert.equal(formatFacts(facts, '：').split('\n')[1], '所在：台北');
  assert.equal(formatFacts([]), '-');
});

test('profile format v2 includes facts; v1 files are upgraded with empty facts', () => {
  assert.equal(PROFILE_VERSION, 2);
  assert.ok(PROFILE_KEYS.includes('site_facts') && PROFILE_KEYS.includes('site_facts_zh'));
  const v2 = makeProfile(Object.fromEntries(PROFILE_KEYS.map((key) => [key, key === 'site_facts' ? 'A: b' : ''])));
  assert.equal(v2.version, 2);
  assert.equal(v2.settings.site_facts, 'A: b');

  const v1Keys = PROFILE_KEYS.filter((key) => !key.startsWith('site_facts'));
  const v1 = { format: 'red-room-site-profile', version: 1, settings: Object.fromEntries(v1Keys.map((key) => [key, ''])) };
  v1.settings.site_name = 'Old file';
  const upgraded = validateProfile(v1);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.settings.site_name, 'Old file');
  assert.equal(upgraded.settings.site_facts, '');
  assert.equal(upgraded.settings.site_facts_zh, '');

  // Each version must list exactly its own keys.
  assert.throws(() => validateProfile({ ...v1, version: 2 }), /exactly/);
  assert.throws(() => validateProfile({ ...v2, version: 1 }), /exactly/);
  assert.throws(() => validateProfile({ ...v2, version: 3 }), /version/);
});

test('zip: inline and file entries round-trip with correct CRCs and UTF-8 names', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rra-zip-'));
  try {
    const big = Buffer.alloc(300_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
    writeFileSync(path.join(dir, 'model.glb'), big);
    const bytes = Buffer.from(await new Response(zipStream([
      { name: 'site-profile.json', data: '{"a":1}\n' },
      { name: 'uploads/封面.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'uploads/venus.glb', path: path.join(dir, 'model.glb') },
    ])).arrayBuffer());
    const files = readZip(bytes);
    assert.deepEqual([...files.keys()], ['site-profile.json', 'uploads/封面.png', 'uploads/venus.glb']);
    assert.equal(files.get('site-profile.json').toString(), '{"a":1}\n');
    assert.ok(files.get('uploads/venus.glb').equals(big));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zip: unsafe or duplicate names are rejected', async () => {
  for (const name of ['../x', '/abs', 'a//b', 'a/./b', '']) assert.throws(() => safeEntryName(name), /unsafe/);
  assert.equal(safeEntryName('a\\b.txt'), 'a/b.txt');
  const duplicate = zipStream([{ name: 'a', data: '1' }, { name: 'a', data: '2' }]);
  await assert.rejects(new Response(duplicate).arrayBuffer(), /duplicate/);
});
