import type { APIRoute } from 'astro';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { authed, deny } from '../../lib/auth';
import { dir, list, MIME, safeName } from '../../lib/files';
import { env } from '../../lib/notion';

export const GET: APIRoute = ({ request }) => (authed(request) ? Response.json(list()) : deny());

// multipart: file=<File>, as=model（可选：保存为 venus.glb，3D 场景优先读取它）
export const POST: APIRoute = async ({ request }) => {
  if (!authed(request)) return deny();
  const fd = await request.formData(), f = fd.get('file');
  if (!(f instanceof File)) return Response.json({ error: 'no file' }, { status: 400 });
  const ext = path.extname(f.name).toLowerCase(), asModel = fd.get('as') === 'model';
  if (!MIME[ext] || (asModel && ext !== '.glb')) return Response.json({ error: `unsupported file type ${ext || '(none)'}` }, { status: 400 });
  if (f.size > Number(env('MAX_UPLOAD_MB') ?? 300) * 1048576) return Response.json({ error: 'file too large' }, { status: 413 });
  let name = asModel ? 'venus.glb' : safeName(f.name);
  if (!asModel && existsSync(path.join(dir(), name))) name = name.slice(0, -ext.length) + `-${Date.now().toString(36)}${ext}`;
  writeFileSync(path.join(dir(), name), Buffer.from(await f.arrayBuffer()));
  return Response.json({ ok: true, name, url: '/uploads/' + encodeURIComponent(name) });
};

export const DELETE: APIRoute = ({ request, url }) => {
  if (!authed(request)) return deny();
  try { unlinkSync(path.join(dir(), path.basename(url.searchParams.get('name') ?? ''))); } catch {}
  return Response.json({ ok: true });
};
