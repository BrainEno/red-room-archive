import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { env } from './notion';
export const dir = () => { const d = path.resolve(env('UPLOAD_DIR') ?? 'data/uploads'); mkdirSync(d, { recursive: true }); return d; };
export const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.glb': 'model/gltf-binary', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
export const safeName = (n: string) => {
  const e = path.extname(n).toLowerCase();
  return (path.basename(n, e).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file') + e;
};
export const list = () => readdirSync(dir()).map((name) => {
  const s = statSync(path.join(dir(), name));
  return { name, size: s.size, mtime: s.mtimeMs, url: '/uploads/' + encodeURIComponent(name) };
}).sort((a, b) => b.mtime - a.mtime);
