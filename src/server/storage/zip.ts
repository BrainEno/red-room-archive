/**
 * Minimal ZIP reader/writer for export and import (no dependency).
 *
 * Writes deflated entries with UTF-8 names. Reads "stored" and "deflate"
 * entries from any ordinary ZIP (macOS Finder, Windows, `zip`, our export);
 * encrypted and ZIP64 archives are rejected. Reading is bounded by entry count
 * and total uncompressed size, so a hostile archive cannot exhaust memory.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { badRequest, payloadTooLarge } from '../../core/errors.ts';

export interface ZipEntry {
  name: string;
  data: Buffer;
  mtime?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time (local fields, 2-second resolution). */
const dosTime = (date: Date) => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

const UTF8_FLAG = 0x0800;

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ''), 'utf8');
    const raw = entry.data;
    const deflated = deflateRawSync(raw);
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const crc = crc32(raw);
    const { time, date } = dosTime(entry.mtime ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: Unix, spec 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const isZip = (data: Uint8Array) =>
  data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05);

export interface ReadZipLimits {
  maxEntries?: number;
  maxTotalBytes?: number;
}

export function readZip(zip: Buffer, limits: ReadZipLimits = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 5000;
  const maxTotal = limits.maxTotalBytes ?? 200 * 1024 * 1024;
  const corrupt = () => badRequest('not a valid ZIP archive');

  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw corrupt();

  const count = zip.readUInt16LE(eocd + 10);
  const dirOffset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw badRequest('ZIP64 archives are not supported');
  if (count > maxEntries) throw payloadTooLarge(`archive has more than ${maxEntries} entries`);

  const entries: ZipEntry[] = [];
  let total = 0;
  let pointer = dirOffset;
  for (let n = 0; n < count; n++) {
    if (pointer + 46 > zip.length || zip.readUInt32LE(pointer) !== 0x02014b50) throw corrupt();
    const flags = zip.readUInt16LE(pointer + 8);
    const method = zip.readUInt16LE(pointer + 10);
    const crc = zip.readUInt32LE(pointer + 16);
    const compressed = zip.readUInt32LE(pointer + 20);
    const size = zip.readUInt32LE(pointer + 24);
    const nameLength = zip.readUInt16LE(pointer + 28);
    const extraLength = zip.readUInt16LE(pointer + 30);
    const commentLength = zip.readUInt16LE(pointer + 32);
    const localOffset = zip.readUInt32LE(pointer + 42);
    const nameBytes = zip.subarray(pointer + 46, pointer + 46 + nameLength);
    const name = nameBytes.toString(flags & UTF8_FLAG ? 'utf8' : 'latin1');
    pointer += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw badRequest('encrypted ZIP entries are not supported', { name });
    total += size;
    if (total > maxTotal) throw payloadTooLarge('archive expands beyond the import limit');

    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) throw corrupt();
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const body = zip.subarray(start, start + compressed);
    if (body.length !== compressed) throw corrupt();

    let data: Buffer;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) {
      try {
        data = inflateRawSync(body, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw corrupt();
      }
    } else throw badRequest(`unsupported ZIP compression method ${method}`, { name });
    if (data.length !== size || crc32(data) !== crc) throw corrupt();
    entries.push({ name, data });
  }
  return entries;
}
