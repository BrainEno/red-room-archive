import type { APIRoute } from 'astro';
import { authed, deny } from '../../../lib/auth';
import { syncKind } from '../../../lib/db';
import { createItem, getSchema, notionReady, type Kind } from '../../../lib/notion';
import { db } from '../../../lib/db';

const guard = (request: Request, kind: string) => {
  if (!authed(request)) return deny();
  db();   // 载入后台设置（Notion token / 数据库 ID）
  if (!['writing', 'films', 'music'].includes(kind) || !notionReady(kind as Kind)) return Response.json({ error: 'unknown kind, or Notion not configured' }, { status: 400 });
};
// GET  → 该数据库的列定义（后台据此生成表单）
export const GET: APIRoute = async ({ request, params }) => {
  const g = guard(request, params.kind!); if (g) return g;
  try { return Response.json(await getSchema(params.kind as Kind)); } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
};
// POST → 新建记录并回写 SQLite
export const POST: APIRoute = async ({ request, params }) => {
  const g = guard(request, params.kind!); if (g) return g;
  try {
    const page = await createItem(params.kind as Kind, await request.json());
    await syncKind(params.kind as Kind);
    return Response.json({ ok: true, id: page.id, url: page.url });
  } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
};
