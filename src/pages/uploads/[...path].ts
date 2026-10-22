import type { APIRoute } from 'astro';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { dir, MIME } from '../../lib/files';

// 提供上传文件，支持 Range（音视频拖动进度条需要）
export const GET: APIRoute = ({ params, request }) => {
  const file = path.join(dir(), path.basename(params.path ?? ''));
  let size = 0;
  try { const st = statSync(file); if (!st.isFile()) throw 0; size = st.size; } catch { return new Response('Not found', { status: 404 }); }
  const h: Record<string, string> = { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  if (m) {
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as any,
      { status: 206, headers: { ...h, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as any, { headers: { ...h, 'Content-Length': String(size) } });
};
