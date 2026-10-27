/**
 * Journal posts.
 *
 *   GET    /api/posts            public list (drafts with ?drafts=1, admin only)
 *   POST   /api/posts            create → 201 + PostDetail
 *   GET    /api/posts/:slug      public read (?format=html adds rendered HTML)
 *   PATCH  /api/posts/:slug      partial update → PostDetail   (PUT = alias)
 *   DELETE /api/posts/:slug      delete → 204
 */
import { renderMarkdown } from '../../../core/markdown.ts';
import { unauthorized } from '../../../core/errors.ts';
import type { MarkdownPreviewResponse, PostDetail, PostListResponse } from '../../../shared/contracts.ts';
import type { PostWrite } from '../../db/posts.repository.ts';
import { postHref, presentPost, presentPostDetail } from '../../presenters.ts';
import { isAdmin, requireAdmin } from '../../services/auth.ts';
import { createPost, deletePost, listPosts, requirePost, updatePost } from '../../services/posts.ts';
import { NO_STORE, created, json, paging, param, publicCache, readJson, route, truthy } from '../respond.ts';

const PATCHABLE = ['title', 'body', 'tags', 'slug', 'published', 'created', 'excerpt'] as const;

/** Keep only known fields so typos surface as "nothing changed", not as silent junk. */
const toWrite = (body: Record<string, unknown>): PostWrite => {
  const out: Record<string, unknown> = {};
  for (const key of PATCHABLE) if (key in body) out[key] = body[key];
  return out as PostWrite;
};

export const list = route((context) => {
  const admin = isAdmin(context.request);
  const wantsDrafts = truthy(context.url.searchParams.get('drafts'));
  if (wantsDrafts && !admin) throw unauthorized('drafts are only visible to the admin');
  const { limit, offset } = paging(context.url, 50, 200);
  const tag = context.url.searchParams.get('tag')?.trim() || undefined;
  const { posts, total } = listPosts({ includeDrafts: wantsDrafts, limit, offset, tag });
  const body: PostListResponse = { posts: posts.map(presentPost), total, limit, offset, draftsIncluded: wantsDrafts };
  return json(body, { headers: admin ? NO_STORE : publicCache(60) });
});

export const create = route(async (context) => {
  requireAdmin(context.request);
  const input = toWrite(await readJson(context.request));
  const { slug } = createPost(input as PostWrite & { title: string; body: string });
  return created<PostDetail>(presentPostDetail(requirePost(slug, { includeDrafts: true })), postHref(slug));
});

export const read = route(async (context) => {
  const admin = isAdmin(context.request);
  const post = requirePost(param(context, 'slug'), { includeDrafts: admin });
  const html = context.url.searchParams.get('format') === 'html' ? await renderMarkdown(post.body) : undefined;
  return json<PostDetail>(presentPostDetail(post, html), { headers: admin ? NO_STORE : publicCache(60) });
});

export const update = route(async (context) => {
  requireAdmin(context.request);
  const { slug } = updatePost(param(context, 'slug'), toWrite(await readJson(context.request)));
  return json<PostDetail>(presentPostDetail(requirePost(slug, { includeDrafts: true })), { headers: NO_STORE });
});

export const remove = route((context) => {
  requireAdmin(context.request);
  deletePost(param(context, 'slug'));
  return new Response(null, { status: 204, headers: NO_STORE });
});

/**
 * POST /api/markdown { markdown } → { html } — admin-only preview through the
 * exact renderer the public journal uses. Lives outside /api/posts/* so it can
 * never shadow a post whose slug happens to be "preview".
 */
export const preview = route(async (context) => {
  requireAdmin(context.request);
  const { markdown } = await readJson(context.request);
  return json<MarkdownPreviewResponse>({ html: await renderMarkdown(String(markdown ?? '')) }, { headers: NO_STORE });
});
