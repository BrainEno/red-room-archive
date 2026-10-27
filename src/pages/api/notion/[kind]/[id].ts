import type { APIRoute } from 'astro';
import { guard } from '../../../../lib/auth.ts';
import { db, forgetItem, invalidateBody, syncKind } from '../../../../lib/db.ts';
import { archiveItem, isKind, isPageId, notionReady, updateItem } from '../../../../lib/notion.ts';
import { fail, handler, notFound, readJson } from '../../../../lib/http.ts';

const setup = (request: Request, kind: string, id: string) => {
  const denied = guard(request); if (denied) return denied;
  db();
  if (!isKind(kind)) return fail(400, 'unknown kind; expected writing, films or music');
  if (!notionReady(kind)) return fail(400, 'Notion is not configured for this kind');
  if (!isPageId(id)) return fail(400, 'invalid page id');
  return null;
};

/**
 * PATCH /api/notion/<kind>/<pageId> — 更新一条 Notion 记录。
 * body: { title?, body?, <列名/别名>: 值… }
 * 传 body 时整页正文会被替换成这段 Markdown 子集；不传则正文保持不变。
 */
export const PATCH: APIRoute = handler(async ({ request, params }) => {
  const { kind, id } = params as { kind: string; id: string };
  const denied = setup(request, kind, id); if (denied) return denied;
  try {
    const fields = await readJson(request);
    const page = await updateItem(kind as never, id, fields);
    await syncKind(kind as never);
    if (!('body' in fields)) invalidateBody(id);   // 属性变了但正文没重写：下次阅读重新取
    return Response.json({ ok: true, id: page.id, url: page.url, updated: true });
  } catch (e) {
    return fail(502, String(e));
  }
});

/**
 * DELETE /api/notion/<kind>/<pageId> — 归档页面（Notion 回收站可恢复）并清理本地缓存。
 * 加 ?purge=1 只清缓存、不动 Notion（用于强制重新同步）。
 */
export const DELETE: APIRoute = handler(async ({ request, params, url }) => {
  const { kind, id } = params as { kind: string; id: string };
  const denied = setup(request, kind, id); if (denied) return denied;
  if (url.searchParams.get('purge') === '1') {
    return Response.json({ ok: true, id, purged: forgetItem(id) });
  }
  try {
    await archiveItem(id);
    forgetItem(id);
    return Response.json({ ok: true, id, archived: true });
  } catch (e) {
    return fail(502, String(e));
  }
});

/** GET /api/notion/<kind>/<pageId> — 不做额外请求：提示用 /api/items 读取缓存内容。 */
export const GET: APIRoute = handler(({ params }) => {
  if (!isPageId(params.id)) return fail(400, 'invalid page id');
  return notFound(`page ${params.id} is not addressable here; use /api/items/${params.kind} and match on id`);
});
