/**
 * Domain rows → wire DTOs (`shared/contracts.ts`).
 *
 * Both the JSON API and the server-rendered pages go through these functions,
 * so a visitor and an API client always see the same fields with the same
 * meaning.
 */
import type { ItemDetail, ItemSummary, PostDetail, PostSummary } from '../shared/contracts.ts';
import { itemPath } from '../shared/kinds.ts';
import type { ItemRow } from './db/items.repository.ts';
import { summaryFields } from './notion/mapper.ts';
import type { PostView } from './services/posts.ts';

export const postHref = (slug: string) => `/journal/${encodeURIComponent(slug)}`;

export function presentItem(item: ItemRow): ItemSummary {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    slug: item.slug,
    href: itemPath(item.kind, item.slug),
    updated: item.updated,
    ...summaryFields(item),
    data: item.data,
  };
}

export const presentItemDetail = (item: ItemRow, bodyHtml: string): ItemDetail => ({
  ...presentItem(item),
  bodyHtml,
});

export function presentPost(post: PostView): PostSummary {
  return {
    slug: post.slug,
    title: post.title,
    tags: post.tags,
    created: post.created,
    updated: post.updated,
    published: post.published,
    excerpt: post.excerpt,
    href: postHref(post.slug),
  };
}

export const presentPostDetail = (post: PostView, html?: string): PostDetail => ({
  ...presentPost(post),
  markdown: post.body,
  ...(html !== undefined ? { html } : {}),
});
