import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-uploads-'));
process.env.UPLOAD_DIR = dir;
process.env.MAX_UPLOAD_MB = '1';

const { ext, safeName, supported, resolveInDir, saveStream, renameUpload, removeUpload, listUploads, uniqueName, MODEL_NAME } =
  await import('../src/server/storage/uploads.ts');
const { parseRange } = await import('../src/server/http/endpoints/uploads.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

const streamOf = (bytes) => new Blob([bytes]).stream();

test('safeName normalizes to a filesystem-safe name but keeps the extension', () => {
  assert.equal(safeName('My Great Track.MP3'), 'my-great-track.mp3');
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('曲 名.flac'), '曲-名.flac');
  assert.equal(safeName('.mp3'), 'file.mp3');
});

test('supported() only allows known media/document extensions', () => {
  assert.ok(supported('a.mp3'));
  assert.ok(supported('a.GLB'));
  assert.ok(!supported('a.exe'));
  assert.ok(!supported('a'));
  assert.equal(ext('a.MP4'), '.mp4');
});

test('resolveInDir rejects traversal, nested paths and temp files', () => {
  assert.ok(resolveInDir('a.mp3'));
  assert.equal(resolveInDir('../a.mp3'), null);
  assert.equal(resolveInDir('sub/a.mp3'), null);
  assert.equal(resolveInDir(''), null);
  assert.equal(resolveInDir('..'), null);
  assert.equal(resolveInDir('a.mp3.part'), null);
});

test('saveStream writes the file, then uniqueName avoids overwriting it', async () => {
  const saved = await saveStream(streamOf('hello'), 'Song One.mp3');
  assert.equal(saved.name, 'song-one.mp3');
  assert.equal(saved.size, 5);
  assert.equal(saved.url, '/uploads/song-one.mp3');
  assert.notEqual(uniqueName('Song One.mp3'), 'song-one.mp3');
});

test('saveStream aborts oversized uploads and leaves no partial file', async () => {
  const big = new Uint8Array(1024 * 1024 + 10);
  await assert.rejects(saveStream(streamOf(big), 'big.mp4'), (error) => error.status === 413);
  assert.ok(!readdirSync(dir).some((name) => name.endsWith('.part')), 'no .part leftovers');
  assert.ok(!readdirSync(dir).includes('big.mp4'));
});

test('saveStream validates type and the model target', async () => {
  await assert.rejects(saveStream(streamOf('x'), 'virus.exe'), (error) => error.status === 400);
  await assert.rejects(saveStream(streamOf('x'), 'a.mp3', { asModel: true }), /\.glb/);
  const model = await saveStream(streamOf('glb'), 'statue.glb', { asModel: true });
  assert.equal(model.name, MODEL_NAME);
});

test('rename keeps the extension, refuses conflicts; remove reports 404', async () => {
  await saveStream(streamOf('a'), 'a.mp3');
  await saveStream(streamOf('b'), 'b.mp3');
  assert.throws(() => renameUpload('a.mp3', 'a.wav'), (error) => error.status === 400);
  assert.throws(() => renameUpload('a.mp3', 'b.mp3'), (error) => error.status === 409);
  assert.equal(renameUpload('a.mp3', 'Renamed A.mp3'), 'renamed-a.mp3');
  removeUpload('renamed-a.mp3');
  assert.throws(() => removeUpload('renamed-a.mp3'), (error) => error.status === 404);
  assert.ok(listUploads().every((file) => !file.name.endsWith('.part')));
});

test('parseRange handles open, closed, suffix and invalid ranges', () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'invalid');
  assert.equal(parseRange('bytes=-', 100), 'invalid');
});

test('concurrent uploads never clobber one another or leave partial files', async () => {
  const files = await Promise.all(Array.from({ length: 30 }, (_, i) => saveStream(streamOf(`payload-${i}`), 'same.mp3')));
  assert.equal(new Set(files.map((file) => file.name)).size, 30);
  const { readFileSync } = await import('node:fs');
  assert.equal(new Set(files.map((file) => readFileSync(path.join(dir, file.name), 'utf8'))).size, 30);
  assert.ok(!readdirSync(dir).some((name) => name.endsWith('.part')));
});

test('rename failure rolls back target while preserving original and existing conflicts', async () => {
  await saveStream(streamOf('original'), 'rollback.mp3');
  assert.throws(() => renameUpload('rollback.mp3', 'new.mp3', () => { throw new Error('injected database failure'); }), /injected/);
  assert.ok(readdirSync(dir).includes('rollback.mp3'));
  assert.ok(!readdirSync(dir).includes('new.mp3'));
  await saveStream(streamOf('existing'), 'new.mp3');
  assert.throws(() => renameUpload('rollback.mp3', 'new.mp3'), (error) => error.status === 409);
  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(path.join(dir, 'rollback.mp3'), 'utf8'), 'original');
  assert.equal(readFileSync(path.join(dir, 'new.mp3'), 'utf8'), 'existing');
});
