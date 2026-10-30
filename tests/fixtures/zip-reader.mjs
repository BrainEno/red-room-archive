// Test helper: parse a stored-only ZIP and assert every header, size and CRC.
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';

/** Read a stored-only ZIP and verify every header, size and CRC. */
export function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, 'central header');
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(flags & 0x0800, 0x0800, 'UTF-8 names');
    assert.equal(method, 0, 'stored');
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50, `local header for ${name}`);
    assert.equal(buffer.readUInt32LE(offset + 14), crc, 'local CRC matches central');
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const data = buffer.subarray(start, start + size);
    assert.equal(crc32(data) >>> 0, crc, `CRC of ${name}`);
    files.set(name, data);
    at += 46 + nameLength + extra + comment;
  }
  return files;
}
