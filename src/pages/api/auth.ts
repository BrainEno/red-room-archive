import type { APIRoute } from 'astro';
import { authed, noteFailure, noteSuccess, tooManyFailures } from '../../lib/auth.ts';
import { env } from '../../lib/notion.ts';
import { fail, handler, readJson } from '../../lib/http.ts';

/**
 * POST /api/auth  { token } → { ok: true }
 * 后台登录时先校验 token，避免把每个接口的 401 都当成“未登录”。
 * 失败次数按 IP 节流（见 lib/auth.ts）。
 */
export const POST: APIRoute = handler(async ({ request }) => {
  if (tooManyFailures(request)) return fail(429, 'too many failed attempts, try again later');
  const { token } = await readJson(request);
  const expected = env('ADMIN_TOKEN');
  if (!expected) return fail(503, 'ADMIN_TOKEN is not configured on the server');
  if (!authed(new Request('http://local/', { headers: { authorization: `Bearer ${String(token ?? '')}` } }))) {
    noteFailure(request);
    return fail(401, 'invalid token');
  }
  noteSuccess(request);
  return Response.json({ ok: true });
});

/** GET /api/auth → 是否已配置 ADMIN_TOKEN（不暴露 token 本身）。 */
export const GET: APIRoute = () => Response.json({ configured: !!env('ADMIN_TOKEN') });
