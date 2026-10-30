/**
 * Read-only facade for server-rendered pages.
 *
 * This is the *only* server module that `.astro` pages may import. It returns
 * the same DTOs as the JSON API (see `shared/contracts.ts`), which keeps the UI
 * decoupled from SQLite and Notion. `tests/architecture.test.mjs` enforces it.
 */
import { copy } from '../content/site.ts';
import { DEFAULT_LOCALE, type Locale } from '../shared/i18n.ts';
import type {
  ArticleDetail,
  ArticleSummary,
  MoreChannel,
  MorePublication,
  MoreResponse,
  SearchResponse,
  TagCount,
} from '../shared/contracts.ts';
import { config } from './config.ts';
import { presentArticle, presentArticleDetail } from './presenters.ts';
import { articleBody, featuredArticles, findArticle, listArticles, neighbours } from './services/articles.ts';
import { moreFor } from './services/more.ts';
import { search } from './services/search.ts';
import { filterByTag, tagIndex, tagLangOf, tagNamer, topicCounts } from './services/tags.ts';
import { siteProfile } from './services/settings.ts';

export type { ArticleDetail, ArticleSummary, MoreChannel, MorePublication, MoreResponse, SearchResponse, TagCount };

export type { Locale };

/** Site identity + editorial copy in one interface language. */
export interface SiteView {
  locale: Locale;
  name: string;
  email: string;
  /** One-line description (meta, RSS). */
  about: string;
  intro: string;
  tagline: string;
  facts: { key: string; value: string }[];
  articlesIntro: string;
  url: string;
}

export function getSite(locale: Locale = DEFAULT_LOCALE): SiteView {
  const { facts, articlesIntro } = copy[locale];
  return { locale, ...siteProfile(locale), facts, articlesIntro, url: config.siteUrl() };
}

export interface HomeData {
  latest: ArticleSummary[];
  featured: ArticleSummary[];
  topics: TagCount[];
  total: number;
}

const HOME_ARTICLE_LIMIT = 10;

/** Tag names, topics and every list are in `locale` (Fiction on the English page, 小说 on the Chinese one). */
export async function getHome(locale: Locale = DEFAULT_LOCALE): Promise<HomeData> {
  const all = await listArticles();
  const names = tagNamer(all, locale);
  return {
    latest: all.slice(0, HOME_ARTICLE_LIMIT).map((row) => presentArticle(row, names)),
    featured: featuredArticles(all, HOME_ARTICLE_LIMIT).map((row) => presentArticle(row, names)),
    topics: topicCounts(all, locale),
    total: all.length,
  };
}

const ARTICLES_PAGE_SIZE = 20;

export interface ArticlesPage {
  articles: ArticleSummary[];
  total: number;
  page: number;
  pages: number;
  /** The selected topic, labelled in the page language (`?tag=小说` and `?tag=fiction` give the same topic). */
  tag?: { key: string; name: string };
  tags: TagCount[];
}

export async function getArticles(options: { page?: number; tag?: string; locale?: Locale } = {}): Promise<ArticlesPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const locale = options.locale ?? DEFAULT_LOCALE;
  const query = options.tag?.trim() || undefined;
  const all = await listArticles();
  const filtered = filterByTag(all, query);
  const names = tagNamer(all, locale);
  const index = tagIndex(all);
  const topic = query ? index.group(query) : undefined;
  return {
    articles: filtered.slice((page - 1) * ARTICLES_PAGE_SIZE, page * ARTICLES_PAGE_SIZE).map((row) => presentArticle(row, names)),
    total: filtered.length,
    page,
    pages: Math.max(1, Math.ceil(filtered.length / ARTICLES_PAGE_SIZE)),
    tag: topic ? { key: topic.key, name: index.label(topic, tagLangOf(locale)) } : undefined,
    tags: topicCounts(all, locale),
  };
}

export interface ArticleView {
  article: ArticleDetail;
  /** True when Notion could not be reached and no cached body existed. */
  bodyMissing: boolean;
}

export async function getArticle(slug: string, locale: Locale = DEFAULT_LOCALE): Promise<ArticleView | undefined> {
  const row = await findArticle(slug);
  if (!row) return undefined;
  const all = await listArticles();
  const names = tagNamer(all, locale);
  try {
    const body = await articleBody(row);
    return { article: presentArticleDetail(row, body, neighbours(all, row), names), bodyMissing: false };
  } catch (error) {
    // Notion being unreachable should degrade the body, not the whole page.
    console.error('[article] body unavailable', error instanceof Error ? error.message : error);
    const empty = { html: '', text: '', toc: [], updated: row.updated };
    return { article: presentArticleDetail(row, empty, neighbours(all, row), names), bodyMissing: true };
  }
}

/** Newest articles, for RSS and the sitemap (English tag names). */
export async function getRecentArticles(limit = 50): Promise<ArticleSummary[]> {
  const all = await listArticles();
  const names = tagNamer(all, DEFAULT_LOCALE);
  return all.slice(0, limit).map((row) => presentArticle(row, names));
}

/** Every topic, for the sitemap (one URL per topic, by key). */
export async function getTopics(locale: Locale = DEFAULT_LOCALE): Promise<TagCount[]> {
  return topicCounts(await listArticles(), locale);
}

export function searchArticles(query: string, limit = 30, locale: Locale = DEFAULT_LOCALE): Promise<SearchResponse> {
  return search(query, limit, locale);
}

/* ── More page (/admin → More, else content/more.ts) ─────────────────── */

/** The /more page in one language (empty fields fall back to the other language). */
export function getMore(locale: Locale = DEFAULT_LOCALE): MoreResponse {
  return moreFor(locale);
}
