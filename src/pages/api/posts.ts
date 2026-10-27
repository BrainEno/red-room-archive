import type { APIRoute } from 'astro';
import { authed, guard } from '../../lib/auth.ts';
import { countPosts, createPost, listPosts } from '../../lib/db.ts';
import { cacheFor, handler, paging, readJson, truthy } from '../../lib/http.ts';

/**
 * GET /api/posts — 公开列出已发布文章。
 * 带 token 且 ?drafts=1 时包含草稿；可 ?tag= 过滤、?limit=&offset= 分页。
 */
export const GET: APIRoute = handler(({ request, url }) => {
  const isAdmin = authed(request);
  const includeDrafts = isAdmin && truthy(url.searchParams.get('drafts'));
  const { limit, offset } = paging(url, 50, 200);
  const tag = url.searchParams.get('tag') ?? undefined;
  const posts = listPosts({ includeDrafts, limit, offset, tag });
  return Response.json(
    { posts, total: countPosts(includeDrafts), limit, offset, draftsIncluded: includeDrafts },
    { headers: isAdmin ? { 'Cache-Control': 'no-store' } : cacheFor(60) },
  );
});

/** POST /api/posts — 新建文章；slug 冲突返回 409（不会静默覆盖旧稿）。 */
export const POST: APIRoute = handler(async ({ request }) => {
  const denied = guard(request); if (denied) return denied;
  const body = await readJson(request);
  const { slug, created } = createPost(body);
  return Response.json({ ok: true, slug, created, url: `/journal/${encodeURIComponent(slug)}` }, { status: 201 });
});
