/**
 * Disk cache for Notion-hosted files.
 *
 * Notion serves uploaded images and files from signed S3 URLs that expire
 * after about an hour, so they cannot be put into cached HTML. The site emits
 * `/media/notion/<id>` instead and keeps a copy here: `<id>` (bytes) next to
 * `<id>.json` (content type, size, and the article revision it belongs to).
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { payloadTooLarge, upstreamError } from '../../core/errors.ts';
import { config } from '../config.ts';

export interface CachedMedia {
  path: string;
  size: number;
  mtime: number;
  mime: string;
  /** `last_edited_time` of the article when the file was fetched. */
  revision: string;
}

const ID = /^[0-9a-f]{32}$/;

const dir = () => {
  const directory = config.mediaDir();
  mkdirSync(directory, { recursive: true });
  return directory;
};

const fileFor = (id: string) => {
  if (!ID.test(id)) throw new Error(`invalid media id: ${id}`);
  return path.join(dir(), id);
};

export async function readCached(id: string): Promise<CachedMedia | null> {
  try {
    const file = fileFor(id);
    const meta = JSON.parse(await readFile(`${file}.json`, 'utf8')) as { mime: string; revision: string };
    const info = await stat(file);
    return { path: file, size: info.size, mtime: Math.floor(info.mtimeMs / 1000), mime: meta.mime, revision: meta.revision };
  } catch {
    return null;
  }
}

/** Only types a browser can safely show inline; anything else is served as a download. */
const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/i;
export const inlineSafe = (mime: string) => SAFE_INLINE.test(mime);

/** Stream `response` to disk (atomic rename), refusing bodies over `maxBytes`. */
export async function store(id: string, response: Response, revision: string, maxBytes = config.maxMediaBytes()): Promise<CachedMedia> {
  const file = fileFor(id);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw payloadTooLarge('Notion file is larger than MAX_MEDIA_MB');
  }
  if (!response.body) throw upstreamError('empty response from Notion file storage');

  const mime = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
  const temp = `${file}.${process.pid}.${Date.now()}.part`;
  let total = 0;
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
  source.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > maxBytes) source.destroy(payloadTooLarge('Notion file is larger than MAX_MEDIA_MB'));
  });
  try {
    await pipeline(source, createWriteStream(temp));
    await rename(temp, file);
    await writeFile(`${file}.json`, JSON.stringify({ mime, revision }));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  const info = await stat(file);
  return { path: file, size: info.size, mtime: Math.floor(info.mtimeMs / 1000), mime, revision };
}

export async function removeMedia(ids: string[]) {
  await Promise.all(
    ids.filter((id) => ID.test(id)).flatMap((id) => [rm(fileFor(id), { force: true }), rm(`${fileFor(id)}.json`, { force: true })]),
  );
}

export async function clearMedia() {
  const directory = dir();
  const names = await readdir(directory).catch(() => [] as string[]);
  await Promise.all(names.map((name) => rm(path.join(directory, name), { force: true })));
}
