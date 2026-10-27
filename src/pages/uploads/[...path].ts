import type { APIRoute } from 'astro';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { dir, MIME } from '../../lib/files.ts';

/**
 * 提供上传文件，支持 Range（音视频拖动进度条需要）与 ETag 缓存验证。
 * 文件名强制 basename，目录穿越无效。
 */
export const GET: APIRoute = ({ params, request }) => serve(params.path, request);

export const HEAD: APIRoute = ({ params, request }) => {
  const r = serve(params.path, request, true);
  return new Response(null, { status: r.status, headers: r.headers });
};

function serve(rawPath: string | undefined, request: Request, headOnly = false): Response {
  const file = path.join(dir(), path.basename(rawPath ?? ''));
  let size = 0, mtime = 0;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw 0;
    size = st.size;
    mtime = Math.floor(st.mtimeMs / 1000);
  } catch { return new Response('Not found', { status: 404 }); }

  const etag = `"${size.toString(16)}-${mtime.toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'ETag': etag,
    'Last-Modified': new Date(mtime * 1000).toUTCString(),
  };

  // 条件请求：内容没变就回 304，省带宽
  const inm = request.headers.get('if-none-match');
  const ims = Date.parse(request.headers.get('if-modified-since') ?? '');
  if ((inm && inm.split(',').map((t) => t.trim()).includes(etag)) || (!inm && ims && mtime * 1000 <= ims)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Last-Modified': headers['Last-Modified'], 'Cache-Control': headers['Cache-Control'] } });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  if (m && !headOnly) {
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as any, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }

  headers['Content-Length'] = String(size);
  if (headOnly) return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(file)) as any, { headers });
}
