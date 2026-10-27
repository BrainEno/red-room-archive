/**
 * Read-only facade for server-rendered pages.
 *
 * This is the *only* server module that `src/ui/**` may import. It returns the
 * same DTOs as the JSON API (see `shared/contracts.ts`), which keeps the UI
 * decoupled from SQLite, Notion and every write path. A test
 * (`tests/architecture.test.mjs`) enforces the boundary.
 */
import { renderMarkdown } from '../core/markdown.ts';
import { readingMinutes } from '../core/text.ts';
import { site as content } from '../content/site.ts';
import type { ItemDetail, ItemSummary, PostDetail, PostSummary, SearchResponse } from '../shared/contracts.ts';
import { COLLECTIONS, type Kind } from '../shared/kinds.ts';
import { config } from './config.ts';
import { presentItem, presentItemDetail, presentPost, presentPostDetail } from './presenters.ts';
import { findItem, itemBody, listItems } from './services/archive.ts';
import { getPost, listPosts, postNeighbours, postTags } from './services/posts.ts';
import { search } from './services/search.ts';
import { siteProfile } from './services/settings.ts';

export type { ItemDetail, ItemSummary, PostDetail, PostSummary, SearchResponse };

export interface SiteView {
  name: string;
  email: string;
  about: string;
  intro: string;
  tagline: string;
  facts: { key: string; value: string }[];
  journal: { label: string; intro: string };
  contact: { heading: string; note: string };
  url: string;
}

export function getSite(): SiteView {
  return { ...content, ...siteProfile(), url: config.siteUrl() };
}

/** All three collections, in navigation order. */
export async function getCollections(): Promise<{ kind: Kind; items: ItemSummary[] }[]> {
  return Promise.all(
    COLLECTIONS.map(async (collection) => ({
      kind: collection.kind,
      items: (await listItems(collection.kind)).map(presentItem),
    })),
  );
}

export async function getCollection(kind: Kind): Promise<ItemSummary[]> {
  return (await listItems(kind)).map(presentItem);
}

export interface EntryView {
  entry: ItemDetail;
  previous?: ItemSummary;
  next?: ItemSummary;
}

/** One entry with its rendered body and neighbours inside the same collection. */
export async function getEntry(kind: Kind, slug: string): Promise<EntryView | undefined> {
  const item = await findItem(kind, slug);
  if (!item) return undefined;
  const all = await listItems(kind);
  const index = all.findIndex((candidate) => candidate.id === item.id);
  let bodyHtml = '';
  try {
    bodyHtml = await itemBody(item);
  } catch (error) {
    // Notion being unreachable should degrade the body, not the whole page.
    console.error('[entry] body unavailable', error);
  }
  return {
    entry: presentItemDetail(item, bodyHtml),
    previous: index > 0 ? presentItem(all[index - 1]!) : undefined,
    next: index >= 0 && index < all.length - 1 ? presentItem(all[index + 1]!) : undefined,
  };
}

export interface JournalPage {
  posts: PostSummary[];
  total: number;
  page: number;
  pages: number;
  tag?: string;
  tags: { tag: string; count: number }[];
}

export const JOURNAL_PAGE_SIZE = 20;

export function getJournal(options: { page?: number; tag?: string } = {}): JournalPage {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const tag = options.tag?.trim() || undefined;
  const { posts, total } = listPosts({
    limit: JOURNAL_PAGE_SIZE,
    offset: (page - 1) * JOURNAL_PAGE_SIZE,
    tag,
  });
  return {
    posts: posts.map(presentPost),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / JOURNAL_PAGE_SIZE)),
    tag,
    tags: postTags(),
  };
}

export interface JournalPostView {
  post: PostDetail & { html: string };
  minutes: number;
  previous?: { slug: string; title: string };
  next?: { slug: string; title: string };
}

export async function getJournalPost(slug: string): Promise<JournalPostView | undefined> {
  const post = getPost(slug);
  if (!post) return undefined;
  const html = await renderMarkdown(post.body);
  return {
    post: presentPostDetail(post, html) as PostDetail & { html: string },
    minutes: readingMinutes(post.body),
    ...postNeighbours(slug),
  };
}

/** Recent published posts, for the homepage teaser and the RSS feed. */
export function getRecentPosts(limit = 20): PostSummary[] {
  return listPosts({ limit }).posts.map(presentPost);
}

export function searchArchive(query: string, limit = 30): SearchResponse {
  return search(query, limit);
}
