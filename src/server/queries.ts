/**
 * Read-only facade for server-rendered pages.
 *
 * This is the *only* server module that `.astro` pages may import. It returns
 * the same DTOs as the JSON API (see `shared/contracts.ts`), which keeps the UI
 * decoupled from SQLite and Notion. `tests/architecture.test.mjs` enforces it.
 */
import { site as content } from '../content/site.ts';
import type { ArticleDetail, ArticleSummary, SearchResponse, TagCount } from '../shared/contracts.ts';
import { config } from './config.ts';
import { presentArticle, presentArticleDetail } from './presenters.ts';
import {
  articleBody,
  articlesByTag,
  featuredArticles,
  findArticle,
  listArticles,
  neighbours,
  tagCounts,
} from './services/articles.ts';
import { search } from './services/search.ts';
import { siteProfile } from './services/settings.ts';

export type { ArticleDetail, ArticleSummary, SearchResponse, TagCount };

export interface SiteView {
  name: string;
  email: string;
  about: string;
  intro: string;
  tagline: string;
  facts: { key: string; value: string }[];
  articles: { label: string; intro: string };
  featured: { label: string };
  topics: { label: string };
  contact: { heading: string; note: string };
  url: string;
}

export function getSite(): SiteView {
  return { ...content, ...siteProfile(), url: config.siteUrl() };
}

export interface HomeData {
  latest: ArticleSummary[];
  featured: ArticleSummary[];
  topics: TagCount[];
  total: number;
}

export async function getHome(limit = 12): Promise<HomeData> {
  const all = await listArticles();
  return {
    latest: all.slice(0, limit).map(presentArticle),
    featured: featuredArticles(all).map(presentArticle),
    topics: tagCounts(all),
    total: all.length,
  };
}

export const ARTICLES_PAGE_SIZE = 20;

export interface ArticlesPage {
  articles: ArticleSummary[];
  total: number;
  page: number;
  pages: number;
  tag?: string;
  tags: TagCount[];
}

export async function getArticles(options: { page?: number; tag?: string } = {}): Promise<ArticlesPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const tag = options.tag?.trim() || undefined;
  const [all, filtered] = await Promise.all([listArticles(), articlesByTag(tag ?? null)]);
  return {
    articles: filtered.slice((page - 1) * ARTICLES_PAGE_SIZE, page * ARTICLES_PAGE_SIZE).map(presentArticle),
    total: filtered.length,
    page,
    pages: Math.max(1, Math.ceil(filtered.length / ARTICLES_PAGE_SIZE)),
    tag,
    tags: tagCounts(all),
  };
}

export interface ArticleView {
  article: ArticleDetail;
  /** True when Notion could not be reached and no cached body existed. */
  bodyMissing: boolean;
}

export async function getArticle(slug: string): Promise<ArticleView | undefined> {
  const row = await findArticle(slug);
  if (!row) return undefined;
  const all = await listArticles();
  try {
    const body = await articleBody(row);
    return { article: presentArticleDetail(row, body, neighbours(all, row)), bodyMissing: false };
  } catch (error) {
    // Notion being unreachable should degrade the body, not the whole page.
    console.error('[article] body unavailable', error instanceof Error ? error.message : error);
    const empty = { html: '', text: '', toc: [], updated: row.updated };
    return { article: presentArticleDetail(row, empty, neighbours(all, row)), bodyMissing: true };
  }
}

/** Newest articles, for RSS and the sitemap. */
export async function getRecentArticles(limit = 50): Promise<ArticleSummary[]> {
  return (await listArticles()).slice(0, limit).map(presentArticle);
}

export function searchArticles(query: string, limit = 30): Promise<SearchResponse> {
  return search(query, limit);
}
