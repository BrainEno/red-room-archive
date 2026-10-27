import type { APIRoute } from 'astro';
import { guard } from '../../lib/auth.ts';
import { status, syncAll, syncKind } from '../../lib/db.ts';
import { fail, handler, readJson } from '../../lib/http.ts';
import { isKind, notionReady, type Kind } from '../../lib/notion.ts';

/** GET /api/sync — 同步状态：上次时间、是否正在同步、上次错误、各类缓存条数。 */
export const GET: APIRoute = handler(({ request }) => {
  const denied = guard(request); if (denied) return denied;
  return Response.json({ ok: true, status: status() }, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * POST /api/sync — 立即同步。
 * ?kind=writing|films|music 只同步一个库；不传则全部。也可用 JSON body { kind }。
 * 正在同步时再次调用会复用同一个任务（不会叠加对 Notion 的请求）。
 */
export const POST: APIRoute = handler(async ({ request, url }) => {
  const denied = guard(request); if (denied) return denied;
  let kind: unknown = url.searchParams.get('kind') ?? undefined;
  if (!kind && request.headers.get('content-type')?.includes('json')) {
    const parsed = await readJson(request).catch(() => ({} as Record<string, any>));
    kind = parsed.kind;
  }
  if (kind && !isKind(kind)) return fail(400, 'unknown kind; expected writing, films or music');
  const target = isKind(kind) ? (kind as Kind) : undefined;
  if (!notionReady(target)) return fail(400, 'Notion is not configured');

  try {
    if (target) {
      const count = await syncKind(target);
      return Response.json({ ok: true, synced: { [target]: count }, status: status() }, { headers: { 'Cache-Control': 'no-store' } });
    }
    await syncAll();
    return Response.json({ ok: true, synced: status().counts, status: status() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(502, String(e), { status: status() });
  }
});
