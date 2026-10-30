/**
 * Public URL scheme. Shared by the server (presenters, feeds), the static
 * snapshot and the browser (admin links) — keep it free of runtime
 * dependencies.
 *
 * Every page has one path per interface language: English is unprefixed,
 * Chinese lives under `/zh-CN` (`/topics/fiction` ↔ `/zh-CN/topics/fiction`).
 * Builders here return locale-neutral paths; views pass them through
 * `localePath()` for the reader's language. API paths are never prefixed.
 */

export const ARTICLES_PATH = '/articles';
export const TOPICS_PATH = '/topics';
export const ARCHIVE_PATH = '/archive';
export const SEARCH_PATH = '/search';

/** Self-published books, excerpts and contact details (content/more.ts). */
export const MORE_PATH = '/more';

export const articlePath = (slug: string) => `${ARTICLES_PATH}/${encodeURIComponent(slug)}`;

/** `/articles`, `/articles/page/2`, … */
export const articlesPagePath = (page = 1) => (page > 1 ? `${ARTICLES_PATH}/page/${page}` : ARTICLES_PATH);

/** 32-bit FNV-1a as 8 hex digits — a stable, dependency-free fingerprint. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const MAX_SLUG = 80;

/**
 * URL segment for a topic name: `Short Fiction` → `short-fiction`,
 * `小说` → `小说` (letters of any script are kept; the browser percent-encodes
 * them on the wire). A name with no letters or digits at all (`★`) gets
 * `t-<hash>`. Only `\p{L}`, `\p{N}` and `-` survive, so a slug is always a
 * safe single path segment and file name.
 */
export function topicSlug(name: string): string {
  const base = String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
  return base || `t-${fnv1a(String(name ?? '').normalize('NFKC').trim().toLowerCase())}`;
}

/** `/topics/fiction`, `/topics/fiction/page/2`. Pass a slug from the tag index when you have one. */
export const topicPath = (slug: string, page = 1) =>
  `${TOPICS_PATH}/${encodeURIComponent(slug)}${page > 1 ? `/page/${page}` : ''}`;

/**
 * Topic page for a tag *name*. Any name of a topic works (`Fiction`, `小说`,
 * `Fiction / 小说`): the topic page redirects aliases to the canonical slug.
 */
export const tagPath = (name: string) => topicPath(topicSlug(name));

/** Proxy for Notion-hosted files (their signed URLs expire after ~1 hour). */
export const notionMediaPath = (id: string) => `/media/notion/${id.replace(/-/g, '')}`;
