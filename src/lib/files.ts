import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { env } from './notion.ts';
import { HttpError } from './http.ts';

export const dir = () => { const d = path.resolve(env('UPLOAD_DIR') ?? 'data/uploads'); mkdirSync(d, { recursive: true }); return d; };

export const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.glb': 'model/gltf-binary', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

/** 扩展名（统一小写；`.mp3` 这种只有扩展名的写法也能识别）。 */
export const ext = (n: string) => {
  const name = path.basename(String(n ?? ''));
  const e = path.extname(name).toLowerCase();
  if (e) return e;
  return /^\.[\w-]+$/.test(name) ? name.toLowerCase() : '';
};
export const supported = (n: string) => !!MIME[ext(n)];

export const safeName = (n: string) => {
  const raw = path.basename(String(n ?? ''));
  const e = ext(raw);
  const stem = e ? raw.slice(0, raw.length - e.length) : raw;
  return (stem.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file') + e;
};

/** 只接受上传目录里的文件名：挡掉 ../、绝对路径、空名。 */
export const resolveInDir = (name: string) => {
  const base = path.basename(String(name ?? ''));
  if (!base || base === '.' || base === '..' || base !== String(name ?? '')) return null;
  return path.join(dir(), base);
};

export const list = () => readdirSync(dir()).map((name) => {
  const s = statSync(path.join(dir(), name));
  return { name, size: s.size, mtime: s.mtimeMs, url: '/uploads/' + encodeURIComponent(name) };
}).sort((a, b) => b.mtime - a.mtime);

/** 存储占用概览（后台 Files 面板用）。 */
export function usage() {
  const files = list();
  return {
    count: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
    limitBytes: Number(env('MAX_UPLOAD_MB') ?? 300) * 1048576,
    diskDir: dir(),
  };
}

/** 删除文件；不存在时返回 false，让 API 可以回 404。 */
export function remove(name: string) {
  const p = resolveInDir(name);
  if (!p) return false;
  try { unlinkSync(p); return true; } catch { return false; }
}

/** 重命名（保持扩展名不变）；目标已存在时返回 409。 */
export function rename(from: string, to: string) {
  const src = resolveInDir(from);
  if (!src) throw new HttpError(400, 'invalid source name');
  if (!supported(from) || !supported(to) || ext(from) !== ext(to)) throw new HttpError(400, 'rename must keep a supported extension');
  const dest = resolveInDir(safeName(to));
  if (!dest) throw new HttpError(400, 'invalid target name');
  if (path.basename(dest) === path.basename(src)) return path.basename(src);
  if (!existsSync(src)) throw new HttpError(404, 'file not found');
  if (existsSync(dest)) throw new HttpError(409, 'target name already exists');
  renameSync(src, dest);
  return path.basename(dest);
}

/** 同名文件自动加时间戳，避免覆盖。 */
export function uniqueName(name: string) {
  const safe = safeName(name);
  if (!list().some((f) => f.name === safe)) return safe;
  const e = ext(safe);
  return safe.slice(0, -e.length) + `-${Date.now().toString(36)}` + e;
}

/**
 * 把请求流写进上传目录，边写边计数；超过上限立刻中止并清理临时文件。
 * 这样大文件（视频）不会先整个读进内存。
 */
export async function saveStream(body: ReadableStream<Uint8Array> | null, name: string, maxBytes: number) {
  if (!body) throw new HttpError(400, 'empty request body');
  const final = path.join(dir(), name);
  const tmp = final + '.part';
  let total = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) { cb(new HttpError(413, 'file too large')); return; }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as any), counter, createWriteStream(tmp));
    if (!total) throw new HttpError(400, 'empty request body');
    renameSync(tmp, final);
    return { name, size: total, url: '/uploads/' + encodeURIComponent(name) };
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}
