/**
 * Local upload storage (`UPLOAD_DIR`, default `data/uploads`).
 *
 * All names are reduced to a single safe basename; nothing outside the upload
 * directory can be read, written, renamed or deleted.
 */
import { createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { badRequest, conflict, notFound, payloadTooLarge } from '../../core/errors.ts';
import type { UploadFile, UploadUsage } from '../../shared/contracts.ts';
import { config } from '../config.ts';

/** Name the 3D statue model is stored under (see ui/scripts/site/scene.ts). */
export const MODEL_NAME = 'venus.glb';
/** The statue shipped in public/models (meshopt-compressed with gltfpack). */
export const BUNDLED_MODEL_URL = '/models/venus.glb';

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

export const uploadDir = (): string => {
  const dir = config.uploadDir();
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Lower-case extension; a bare `.mp3` counts as an extension too. */
export const ext = (name: string): string => {
  const base = path.basename(String(name ?? ''));
  const extension = path.extname(base).toLowerCase();
  if (extension) return extension;
  return /^\.[\w-]+$/.test(base) ? base.toLowerCase() : '';
};

export const supported = (name: string): boolean => Boolean(MIME[ext(name)]);

const mimeOf = (name: string): string => MIME[ext(name)] ?? 'application/octet-stream';

/** Filesystem-safe name that keeps the extension and any letters/digits. */
export const safeName = (name: string): string => {
  const raw = path.basename(String(name ?? ''));
  const extension = ext(raw);
  const stem = extension ? raw.slice(0, raw.length - extension.length) : raw;
  const clean = stem
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return (clean || 'file') + extension;
};

/** Absolute path for a name *already inside* the upload dir, or null. */
export const resolveInDir = (name: string): string | null => {
  const raw = String(name ?? '');
  const base = path.basename(raw);
  if (!base || base === '.' || base === '..' || base !== raw || base.endsWith('.part')) return null;
  return path.join(uploadDir(), base);
};

const publicUrl = (name: string) => `/uploads/${encodeURIComponent(name)}`;

const describe = (name: string): UploadFile | null => {
  try {
    const stat = statSync(path.join(uploadDir(), name));
    if (!stat.isFile()) return null;
    return { name, size: stat.size, mtime: stat.mtimeMs, url: publicUrl(name) };
  } catch {
    return null;
  }
};

export function listUploads(): UploadFile[] {
  return readdirSync(uploadDir())
    .filter((name) => !name.endsWith('.part') && !name.startsWith('.'))
    .map(describe)
    .filter((file): file is UploadFile => file !== null)
    .sort((a, b) => b.mtime - a.mtime);
}

export function usage(files = listUploads()): UploadUsage {
  return {
    count: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    limitBytes: config.maxUploadBytes(),
    diskDir: uploadDir(),
  };
}

export function statUpload(name: string): UploadFile {
  if (!resolveInDir(name)) throw badRequest('invalid file name', { name });
  const file = describe(name);
  if (!file) throw notFound('file not found', { name });
  return file;
}

export function removeUpload(name: string): void {
  const file = resolveInDir(name);
  if (!file) throw badRequest('invalid file name', { name });
  try {
    unlinkSync(file);
  } catch {
    throw notFound('file not found', { name });
  }
}

/** Rename within the upload dir; the extension must stay the same. */
export function renameUpload(from: string, to: string, updateReferences: (name: string) => void = () => {}): string {
  const source = resolveInDir(from);
  if (!source) throw badRequest('invalid source name', { name: from });
  if (!supported(from) || !supported(to) || ext(from) !== ext(to)) {
    throw badRequest('rename must keep the same supported extension');
  }
  const target = resolveInDir(safeName(to));
  if (!target) throw badRequest('invalid target name', { name: to });
  if (!existsSync(source)) throw notFound('file not found', { name: from });
  if (path.basename(target) === path.basename(source)) return path.basename(source);
  // Hard-link first: atomic no-clobber and both names remain available until
  // references commit. A crash can leave a harmless duplicate, not a broken URL.
  try { linkSync(source, target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw conflict('target name already exists', { name: path.basename(target) });
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('file not found', { name: from });
    throw error;
  }
  try { updateReferences(path.basename(target)); } catch (error) {
    try { unlinkSync(target); } catch { /* a duplicate is safer than a broken reference */ }
    throw error;
  }
  try { unlinkSync(source); } catch (error) { console.error('[uploads] old name retained after rename', error); }
  return path.basename(target);
}

/** Pick a free name: `track.mp3`, then `track-<base36 time>.mp3`. */
export function uniqueName(name: string): string {
  const safe = safeName(name);
  if (!existsSync(path.join(uploadDir(), safe))) return safe;
  const extension = ext(safe);
  return `${safe.slice(0, safe.length - extension.length)}-${Date.now().toString(36)}${extension}`;
}

export interface SaveOptions {
  /** Store as the statue model instead of a library file. */
  asModel?: boolean;
  maxBytes?: number;
}

const targetName = (original: string, options: SaveOptions) => {
  if (!supported(original)) throw badRequest(`unsupported file type ${ext(original) || '(none)'}`);
  if (options.asModel && ext(original) !== '.glb') throw badRequest('model uploads must be .glb files');
  return options.asModel ? MODEL_NAME : uniqueName(original);
};

/**
 * Stream a request body to disk, counting bytes as they arrive. Oversized
 * uploads abort immediately and leave no partial file behind.
 */
export async function saveStream(
  body: ReadableStream<Uint8Array> | null,
  originalName: string,
  options: SaveOptions = {},
): Promise<UploadFile> {
  if (!body) throw badRequest('empty request body');
  const max = options.maxBytes ?? config.maxUploadBytes();
  const name = targetName(originalName, options);
  const temporary = path.join(uploadDir(), `.${randomUUID()}.part`);
  let total = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > max) callback(payloadTooLarge('file too large'));
      else callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(temporary));
    if (!total) throw badRequest('empty request body');
    let committed = name;
    if (options.asModel) {
      // Intentional replacement: readers see either the old or the complete new model.
      renameSync(temporary, path.join(uploadDir(), MODEL_NAME));
    } else {
      const suffix = ext(name);
      for (;;) {
        try { linkSync(temporary, path.join(uploadDir(), committed)); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          committed = `${name.slice(0, -suffix.length)}-${randomUUID()}${suffix}`;
        }
      }
      try { unlinkSync(temporary); } catch (error) { console.error('[uploads] temporary link retained', error); }
    }
    return { name: committed, size: total, mtime: Date.now(), url: publicUrl(committed) };
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* already gone */
    }
    throw error;
  }
}

/** Save a `File` from a multipart form (small uploads). */
export async function saveFile(file: File, options: SaveOptions = {}): Promise<UploadFile> {
  const max = options.maxBytes ?? config.maxUploadBytes();
  if (file.size > max) throw payloadTooLarge('file too large');
  return saveStream(file.stream(), file.name, options);
}

export interface ServedFile {
  path: string;
  size: number;
  mtime: number;
  mime: string;
}

/** Resolve a public `/uploads/<name>` request. */
export function servedFile(rawName: string): ServedFile | null {
  const name = path.basename(String(rawName ?? ''));
  const file = resolveInDir(name);
  if (!file) return null;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return null;
    return { path: file, size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000), mime: mimeOf(name) };
  } catch {
    return null;
  }
}

export const readRange = (file: string, start?: number, end?: number) =>
  Readable.toWeb(createReadStream(file, start === undefined ? undefined : { start, end })) as ReadableStream;

/**
 * The statue the homepage should load: an uploaded model (versioned by mtime
 * so a replacement is never served from cache) or the bundled one. Deciding on
 * the server avoids a 404 request on every visit when nothing was uploaded.
 */
export function statueModelUrl(): string {
  const file = servedFile(MODEL_NAME);
  return file ? `${publicUrl(MODEL_NAME)}?v=${file.mtime}` : BUNDLED_MODEL_URL;
}
