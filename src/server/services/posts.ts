/**
 * Journal service — drafts, publishing rules, slugs, plain-text summaries and
 * history. Every edit or delete first copies the previous state into
 * `post_revisions`, so no save can lose text.
 */
import { cleanSlug, postSlug } from '../../core/slug.ts';
import { markdownToText } from '../../core/text.ts';
import { badRequest, conflict, notFound } from '../../core/errors.ts';
import { config } from '../config.ts';
import { transaction } from '../db/connection.ts';
import { postsRepository, type PostRow, type PostWrite } from '../db/posts.repository.ts';
import { revisionsRepository, type RevisionReason } from '../db/revisions.repository.ts';

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

/**
 * Normalise a user-supplied date to SQLite's `YYYY-MM-DD HH:MM:SS` (UTC) so
 * that string ordering of `created` stays chronological. Values already in
 * that shape are kept verbatim (they are not re-interpreted as local time).
 */
export function normalizeDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = String(value).trim();
  const sql = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2})?)?$/.exec(raw);
  if (sql) return `${sql[1]} ${sql[2] ?? '00:00'}${sql[3] ?? ':00'}`;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) throw badRequest('created must be a date', { created: raw });
  return new Date(time).toISOString().slice(0, 19).replace('T', ' ');
}

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
    created: normalizeDate(input.created),
    excerpt: input.excerpt || null,
  });
  return { slug };
}

const CONTENT_FIELDS = ['slug', 'title', 'body', 'tags', 'published', 'excerpt', 'created'] as const;
const sameContent = (a: PostRow, b: PostRow) =>
  CONTENT_FIELDS.every((key) => String(a[key] ?? '') === String(b[key] ?? ''));

/**
 * Partial update; `slug` may change as long as the new one is free.
 * The previous state is kept as a revision (unless nothing changed).
 */
export function updatePost(
  current: string,
  patch: PostWrite,
  reason: RevisionReason = 'edit',
): { slug: string; changed: boolean } {
  const row = postsRepository.bySlug(current);
  if (!row) throw notFound('post not found', { slug: current });

  const requested = patch.slug !== undefined ? cleanSlug(String(patch.slug)) : '';
  const nextSlug = requested && requested !== current ? requested : current;
  if (nextSlug !== current && postsRepository.exists(nextSlug)) {
    throw conflict('slug already exists', { slug: nextSlug });
  }
  if (patch.title !== undefined && !String(patch.title).trim()) throw badRequest('title cannot be empty');
  if (patch.body !== undefined && !String(patch.body).trim()) throw badRequest('body cannot be empty');

  const next: PostRow = {
    ...row,
    slug: nextSlug,
    title: patch.title !== undefined ? String(patch.title).trim() : row.title,
    body: patch.body !== undefined ? String(patch.body) : row.body,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : row.tags,
    published: patch.published !== undefined ? (asBool(patch.published, true) ? 1 : 0) : row.published,
    excerpt: patch.excerpt !== undefined ? patch.excerpt || null : row.excerpt,
    created: normalizeDate(patch.created) ?? row.created,
  };
  if (sameContent(row, next)) return { slug: current, changed: false };

  transaction(() => {
    revisionsRepository.snapshot(row, reason);
    if (nextSlug !== current) revisionsRepository.rename(current, nextSlug);
    postsRepository.update(current, next);
    revisionsRepository.prune(nextSlug, config.revisionsKeep());
  });
  return { slug: nextSlug, changed: true };
}

/** Delete a post; its last state stays in history so it can be restored. */
export function deletePost(slug: string): void {
  const row = postsRepository.bySlug(slug);
  if (!row) throw notFound('post not found', { slug });
  transaction(() => {
    revisionsRepository.snapshot(row, 'delete');
    postsRepository.remove(slug);
    revisionsRepository.prune(slug, config.revisionsKeep());
  });
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
