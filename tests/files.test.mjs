import test from 'node:test';
import assert from 'node:assert/strict';
import { ext, safeName, supported, resolveInDir } from '../src/lib/files.ts';

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

test('resolveInDir rejects traversal and nested paths', () => {
  assert.ok(resolveInDir('a.mp3'));
  assert.equal(resolveInDir('../a.mp3'), null);
  assert.equal(resolveInDir('sub/a.mp3'), null);
  assert.equal(resolveInDir(''), null);
  assert.equal(resolveInDir('..'), null);
});
