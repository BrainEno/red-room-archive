import type { APIRoute } from 'astro';
import { guard } from '../../../lib/auth.ts';
import { db, syncKind } from '../../../lib/db.ts';
import { createItem, getSchema, isKind, notionReady } from '../../../lib/notion.ts';
import { fail, handler, readJson } from '../../../lib/http.ts';

const guardKind = (request: Request, kind: string) => {
  const denied = guard(request); if (denied) return denied;
  db();   // 载入后台设置（Notion token / 数据库 ID）
  if (!isKind(kind)) return fail(400, 'unknown kind; expected writing, films or music');
  if (!notionReady(kind)) return fail(400, 'Notion is not configured for this kind');
  return null;
};

// GET  → 该数据库的列定义（后台据此生成表单）
export const GET: APIRoute = handler(async ({ request, params }) => {
  const kind = params.kind!;
  const denied = guardKind(request, kind); if (denied) return denied;
  return Response.json(await getSchema(kind as never));
});

// POST → 新建记录并回写 SQLite
export const POST: APIRoute = handler(async ({ request, params }) => {
  const kind = params.kind!;
  const denied = guardKind(request, kind); if (denied) return denied;
  try {
    const page = await createItem(kind as never, await readJson(request));
    await syncKind(kind as never);
    return Response.json({ ok: true, id: page.id, url: page.url });
  } catch (e) {
    return fail(502, String(e));
  }
});
