/**
 * Journal service — drafts, publishing rules, slugs and plain-text summaries.
 */
import { cleanSlug, postSlug } from '../../core/slug.ts';
import { markdownToText } from '../../core/text.ts';
import { badRequest, conflict, notFound } from '../../core/errors.ts';
import { postsRepository, type PostRow, type PostWrite } from '../db/posts.repository.ts';

export interface PostQuery {
  includeDrafts?: boolean;
  limit?: number;
  offset?: number;
  tag?: string;
}

const asBool = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return !/^(false|0|off|no|draft)$/i.test(String(value));
};

const normalizeTags = (tags: PostWrite['tags']): string => {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  return [...new Set(list.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20).join(',');
};

export const tagsOf = (tags: string | null): string[] =>
  tags ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];

export interface PostView {
  slug: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
  published: boolean;
  excerpt: string;
  body: string;
}

export const toPostView = (row: PostRow): PostView => ({
  slug: row.slug,
  title: row.title,
  tags: tagsOf(row.tags),
  created: row.created,
  updated: row.updated ?? row.created,
  published: Boolean(row.published),
  excerpt: row.excerpt || markdownToText(row.body).slice(0, 200),
  body: row.body,
});

export function listPosts(query: PostQuery = {}): { posts: PostView[]; total: number } {
  const { limit = 50, offset = 0, includeDrafts = false, tag } = query;
  return {
    posts: postsRepository.list({ includeDrafts, limit, offset, tag }).map(toPostView),
    total: postsRepository.count(includeDrafts, tag),
  };
}

export function getPost(slug: string, options: { includeDrafts?: boolean } = {}): PostView | undefined {
  const row = postsRepository.bySlug(slug);
  if (!row) return undefined;
  if (!row.published && !options.includeDrafts) return undefined;
  return toPostView(row);
}

export function requirePost(slug: string, options: { includeDrafts?: boolean } = {}): PostView {
  const post = getPost(slug, options);
  if (!post) throw notFound('post not found', { slug });
  return post;
}

export function createPost(input: PostWrite & { title: string; body: string }): { slug: string } {
  const title = String(input.title ?? '').trim();
  const body = String(input.body ?? '');
  if (!title) throw badRequest('title is required');
  if (!body.trim()) throw badRequest('body is required');

  const slug = postSlug(title, input.slug);
  if (postsRepository.exists(slug)) throw conflict('slug already exists', { slug });

  postsRepository.insert({
    slug,
    title,
    body,
    tags: normalizeTags(input.tags),
    published: asBool(input.published, true) ? 1 : 0,
    created: input.created || undefined,
    excerpt: input.excerpt || null,
  });
  return { slug };
}

/** Partial update; `slug` may change as long as the new one is free. */
export function updatePost(current: string, patch: PostWrite): { slug: string } {
  const row = postsRepository.bySlug(current);
  if (!row) throw notFound('post not found', { slug: current });

  const requested = patch.slug !== undefined ? cleanSlug(String(patch.slug)) : '';
  const nextSlug = requested && requested !== current ? requested : current;
  if (nextSlug !== current && postsRepository.exists(nextSlug)) {
    throw conflict('slug already exists', { slug: nextSlug });
  }
  if (patch.title !== undefined && !String(patch.title).trim()) throw badRequest('title cannot be empty');
  if (patch.body !== undefined && !String(patch.body).trim()) throw badRequest('body cannot be empty');

  postsRepository.update(current, {
    ...row,
    slug: nextSlug,
    title: patch.title !== undefined ? String(patch.title).trim() : row.title,
    body: patch.body !== undefined ? String(patch.body) : row.body,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : row.tags,
    published: patch.published !== undefined ? (asBool(patch.published, true) ? 1 : 0) : row.published,
    excerpt: patch.excerpt !== undefined ? patch.excerpt || null : row.excerpt,
    created: patch.created || row.created,
  });
  return { slug: nextSlug };
}

export function deletePost(slug: string): void {
  if (!postsRepository.remove(slug)) throw notFound('post not found', { slug });
}

/** Previous / next published article for article footers. */
export function postNeighbours(slug: string) {
  const { previous, next } = postsRepository.neighbours(slug);
  return {
    previous: previous ? { slug: previous.slug, title: previous.title } : undefined,
    next: next ? { slug: next.slug, title: next.title } : undefined,
  };
}

export const postTags = () => postsRepository.tags();
export const countPosts = (includeDrafts = false) => postsRepository.count(includeDrafts);
