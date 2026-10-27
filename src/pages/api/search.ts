import type { APIRoute } from 'astro';
import { search } from '../../lib/db.ts';
import { handler, paging } from '../../lib/http.ts';

/** GET /api/search?q=&limit= — 公开搜索：已发布文章 + 已缓存的 Notion 条目。 */
export const GET: APIRoute = handler(async ({ url }) => {
  const q = url.searchParams.get('q') ?? url.searchParams.get('query') ?? '';
  const { limit } = paging(url, 20, 50);
  if (!q.trim()) return Response.json({ query: '', posts: [], items: [], hint: 'pass ?q=' });
  const result = search(q, limit);
  return Response.json({ ...result, total: result.posts.length + result.items.length },
    { headers: { 'Cache-Control': 'public, max-age=30' } });
});
