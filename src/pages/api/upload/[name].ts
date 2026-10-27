import type { APIRoute } from 'astro';
import { statSync } from 'node:fs';
import { guard } from '../../../lib/auth.ts';
import { remove, rename, resolveInDir } from '../../../lib/files.ts';
import { fail, handler, notFound, readJson } from '../../../lib/http.ts';

/** GET /api/upload/<name> — 单个文件的信息。 */
export const GET: APIRoute = handler(({ request, params }) => {
  const denied = guard(request); if (denied) return denied;
  const p = resolveInDir(params.name ?? '');
  if (!p) return fail(400, 'invalid file name');
  try {
    const s = statSync(p);
    if (!s.isFile()) return notFound('file not found');
    return Response.json({ name: decodeURIComponent(params.name!), size: s.size, mtime: s.mtimeMs,
      url: '/uploads/' + encodeURIComponent(params.name!) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return notFound('file not found'); }
});

/** PATCH /api/upload/<name>  { name: "new-name.ext" } — 重命名（扩展名必须一致）。 */
export const PATCH: APIRoute = handler(async ({ request, params }) => {
  const denied = guard(request); if (denied) return denied;
  const { name: to } = await readJson(request);
  if (!to) return fail(400, 'new name is required');
  const next = rename(decodeURIComponent(params.name ?? ''), String(to));
  return Response.json({ ok: true, name: next, url: '/uploads/' + encodeURIComponent(next) });
});

/** DELETE /api/upload/<name> — 删除文件。 */
export const DELETE: APIRoute = handler(({ request, params }) => {
  const denied = guard(request); if (denied) return denied;
  const name = decodeURIComponent(params.name ?? '');
  if (!resolveInDir(name)) return fail(400, 'invalid file name');
  if (!remove(name)) return notFound('file not found');
  return Response.json({ ok: true, name, deleted: true });
});
