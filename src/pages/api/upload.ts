import type { APIRoute } from 'astro';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { guard } from '../../lib/auth.ts';
import { dir, ext, list, remove, resolveInDir, saveStream, supported, uniqueName, usage } from '../../lib/files.ts';
import { fail, handler, notFound } from '../../lib/http.ts';
import { env } from '../../lib/notion.ts';

const maxBytes = () => Number(env('MAX_UPLOAD_MB') ?? 300) * 1048576;

/** GET /api/upload — 文件列表 + 存储占用（后台 Files 面板）。 */
export const GET: APIRoute = handler(({ request, url }) => {
  const denied = guard(request); if (denied) return denied;
  const files = list();
  // ?bare=1 保留旧行为（直接返回数组）；默认返回 { files, usage }
  const payload = url.searchParams.get('bare') === '1' ? files : { files, usage: usage() };
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * POST /api/upload — 上传文件。
 *
 * 1) 大文件（推荐）：把文件原始字节作为请求体，文件名放在查询串：
 *      POST /api/upload?name=mix.mp4  (Content-Type: video/mp4, body = 文件)
 *    服务端边收边写盘，不占内存；超过 MAX_UPLOAD_MB 会中断并删除半成品。
 * 2) 小文件（兼容 multipart）：file=<File>，可选 as=model 把 .glb 存为雕像模型 venus.glb。
 */
export const POST: APIRoute = handler(async ({ request, url }) => {
  const denied = guard(request); if (denied) return denied;
  const max = maxBytes();
  const contentType = request.headers.get('content-type') ?? '';
  const asModel = url.searchParams.get('as') === 'model';
  const declared = Number(request.headers.get('content-length') ?? 0);

  if (!contentType.includes('multipart/form-data')) {
    const rawName = url.searchParams.get('name') ?? '';
    if (!rawName) return fail(400, 'raw uploads need ?name=<file.ext>');
    if (!supported(rawName)) return fail(400, `unsupported file type ${ext(rawName) || '(none)'}`);
    if (asModel && ext(rawName) !== '.glb') return fail(400, 'as=model requires a .glb file');
    if (declared && declared > max) return fail(413, 'file too large');
    const name = asModel ? 'venus.glb' : uniqueName(rawName);
    const saved = await saveStream(request.body, name, max);
    return Response.json({ ok: true, ...saved });
  }

  if (declared && declared > max + 1048576) return fail(413, 'file too large');   // multipart 有边界开销
  let fd: FormData;
  try { fd = await request.formData(); } catch { return fail(400, 'invalid multipart body'); }
  const f = fd.get('file');
  if (!(f instanceof File)) return fail(400, 'no file');
  const e = ext(f.name);
  if (!supported(f.name)) return fail(400, `unsupported file type ${e || '(none)'}`);
  if (asModel && e !== '.glb') return fail(400, 'as=model requires a .glb file');
  if (f.size > max) return fail(413, 'file too large');

  const name = asModel ? 'venus.glb' : uniqueName(f.name);
  writeFileSync(path.join(dir(), name), Buffer.from(await f.arrayBuffer()));
  return Response.json({ ok: true, name, size: f.size, url: '/uploads/' + encodeURIComponent(name) });
});

/** DELETE /api/upload?name=<file> — 删除文件；不存在返回 404。 */
export const DELETE: APIRoute = handler(({ request, url }) => {
  const denied = guard(request); if (denied) return denied;
  const name = url.searchParams.get('name') ?? '';
  if (!resolveInDir(name)) return fail(400, 'invalid file name');
  if (!remove(name)) return notFound('file not found');
  return Response.json({ ok: true, name, deleted: true });
});
