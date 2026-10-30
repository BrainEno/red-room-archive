/**
 * Minimal streaming ZIP writer (stored entries, no compression).
 *
 * Bundle contents are JPEG/PNG/WebP/GLB (already compressed) plus small JSON,
 * so deflate would buy little. Each file's CRC-32 is computed in a first pass,
 * which keeps memory flat for large uploads and lets every local header carry
 * exact sizes (no data descriptors — the most widely readable layout).
 *
 * Limits: no ZIP64, so each entry and the archive must stay below 4 GiB.
 */
import { createReadStream, statSync } from 'node:fs';
import { crc32 } from 'node:zlib';

export type ZipEntry =
  | { name: string; data: string | Uint8Array; mtime?: Date }
  | { name: string; path: string; mtime?: Date };

const LIMIT = 0xffffffff;
const UTF8_FLAG = 0x0800;

/** MS-DOS date/time (local fields, 2-second precision, 1980–2107). */
function dosTime(date: Date): { time: number; day: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Reject names that could escape the extraction directory. */
export function safeEntryName(name: string): string {
  const clean = String(name).replaceAll('\\', '/');
  if (!clean || clean.startsWith('/') || clean.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe zip entry name: ${name}`);
  }
  return clean;
}

async function fileCrc(path: string): Promise<number> {
  let value = 0;
  for await (const chunk of createReadStream(path)) value = crc32(chunk as Buffer, value);
  return value >>> 0;
}

interface Prepared {
  name: Buffer;
  crc: number;
  size: number;
  stamp: { time: number; day: number };
  offset: number;
}

function localHeader(entry: Prepared): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed: 2.0
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(entry.stamp.time, 10);
  header.writeUInt16LE(entry.stamp.day, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.name]);
}

function centralHeader(entry: Prepared): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.stamp.time, 12);
  header.writeUInt16LE(entry.stamp.day, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  // extra, comment, disk start, internal attrs = 0
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, rw-r--r--
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

/** Stream a ZIP archive of `entries` (names must be unique). */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  async function* generate(): AsyncGenerator<Uint8Array> {
    const seen = new Set<string>();
    const written: Prepared[] = [];
    let offset = 0;
    for (const entry of entries) {
      const name = safeEntryName(entry.name);
      if (seen.has(name)) throw new Error(`duplicate zip entry: ${name}`);
      seen.add(name);
      const inline = 'data' in entry ? (typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data)) : null;
      const size = inline ? inline.length : statSync((entry as { path: string }).path).size;
      if (size >= LIMIT || offset >= LIMIT) throw new Error('zip archive too large (ZIP64 is not supported)');
      const prepared: Prepared = {
        name: Buffer.from(name, 'utf8'),
        crc: inline ? crc32(inline) >>> 0 : await fileCrc((entry as { path: string }).path),
        size,
        stamp: dosTime(entry.mtime ?? new Date()),
        offset,
      };
      const header = localHeader(prepared);
      yield header;
      if (inline) yield inline;
      else {
        let streamed = 0;
        for await (const chunk of createReadStream((entry as { path: string }).path)) {
          streamed += (chunk as Buffer).length;
          yield chunk as Buffer;
        }
        if (streamed !== size) throw new Error(`file changed while zipping: ${name}`);
      }
      offset += header.length + size;
      written.push(prepared);
    }
    const central = Buffer.concat(written.map(centralHeader));
    if (offset + central.length >= LIMIT) throw new Error('zip archive too large (ZIP64 is not supported)');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(written.length, 8);
    end.writeUInt16LE(written.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    yield central;
    yield end;
  }
  const iterator = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
