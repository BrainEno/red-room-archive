/**
 * Public URL scheme. Shared by the server (presenters, feeds) and the browser
 * (admin links) — keep it free of runtime dependencies.
 */

export const ARTICLES_PATH = '/articles';

/** Self-published books, excerpts and contact details (content/more.ts). */
export const MORE_PATH = '/more';

export const articlePath = (slug: string) => `${ARTICLES_PATH}/${encodeURIComponent(slug)}`;

export const tagPath = (tag: string) => `${ARTICLES_PATH}?tag=${encodeURIComponent(tag)}`;

/** Proxy for Notion-hosted files (their signed URLs expire after ~1 hour). */
export const notionMediaPath = (id: string) => `/media/notion/${id.replace(/-/g, '')}`;
