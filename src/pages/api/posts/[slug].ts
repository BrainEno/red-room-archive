import type { APIRoute } from 'astro';
import { authed, guard } from '../../../lib/auth.ts';
import { deletePost, getPost, updatePost } from '../../../lib/db.ts';
import { renderMarkdown } from '../../../lib/markdown.ts';
import { cacheFor, handler, notFound, readJson, truthy } from '../../../lib/http.ts';

/** GET /api/posts/<slug>?format=html — 单篇文章；草稿只对已登录请求可见。 */
export const GET: APIRoute = handler(async ({ request, params, url }) => {
  const isAdmin = authed(request);
  const post = getPost(decodeURIComponent(params.slug ?? ''), { includeDrafts: isAdmin });
  if (!post) return notFound('post not found');
  const format = url.searchParams.get('format');
  const html = format === 'html' || truthy(url.searchParams.get('html')) ? await renderMarkdown(post.body ?? '') : undefined;
  const { body, tags, tagsList, published, ...meta } = post;
  return Response.json(
    { ...meta, published: !!published, tags: tagsList, markdown: body ?? '', ...(html ? { html } : {}) },
    { headers: isAdmin ? { 'Cache-Control': 'no-store' } : cacheFor(60) },
  );
});

/** PUT /api/posts/<slug> — 部分更新（title/body/tags/published/excerpt/created/slug）。 */
export const PUT: APIRoute = handler(async ({ request, params }) => {
  const denied = guard(request); if (denied) return denied;
  const patch = await readJson(request);
  const current = decodeURIComponent(params.slug ?? '');
  if (!getPost(current, { includeDrafts: true })) return notFound('post not found');
  const { slug } = updatePost(current, patch);
  return Response.json({ ok: true, slug, url: `/journal/${encodeURIComponent(slug)}`, updated: true });
});

/** DELETE /api/posts/<slug> — 永久删除一篇文章。 */
export const DELETE: APIRoute = handler(({ request, params }) => {
  const denied = guard(request); if (denied) return denied;
  const slug = decodeURIComponent(params.slug ?? '');
  if (!deletePost(slug)) return notFound('post not found');
  return Response.json({ ok: true, slug, deleted: true });
});
