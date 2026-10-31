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
import { articleBody, featuredArticles, listArticles, neighbours } from './services/articles.ts';
import { moreFor } from './services/more.ts';
import { search } from './services/search.ts';
import { tagIndex, tagLangOf, tagNamer, topicCounts } from './services/tags.ts';
import { analyticsCollectionEnabled, newsletterSignupVisible, siteProfile } from './services/settings.ts';
import { statueModelUrl } from './storage/uploads.ts';

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
  /** Show newsletter sign-up entries on public pages (see newsletterSignupVisible). */
  newsletterSignup: boolean;
  /** Include the small first-party collector; the API enforces the current setting too. */
  analytics: boolean;
}

export function getSite(locale: Locale = DEFAULT_LOCALE): SiteView {
  const { articlesIntro } = copy[locale];
  return { locale, ...siteProfile(locale), articlesIntro, url: config.siteUrl(), newsletterSignup: newsletterSignupVisible(), analytics: analyticsCollectionEnabled() };
}

export interface HomeData {
  latest: ArticleSummary[];
  featured: ArticleSummary[];
  topics: TagCount[];
  total: number;
  /** Statue model URL for the WebGL scene (uploaded or bundled). */
  model: string;
  /** Notice beside the neon sign (content/site.ts `announce`; empty title = hidden). */
  announce: { kicker: string; title: string; action: string; subject: string };
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
    model: statueModelUrl(),
    announce: copy[locale].announce,
  };
}

export const ARTICLES_PAGE_SIZE = 20;

export interface ArticlesPage {
  articles: ArticleSummary[];
  total: number;
  page: number;
  pages: number;
  /** The selected topic, labelled in the page language. */
  tag?: { key: string; slug: string; name: string };
  tags: TagCount[];
}

const paginate = <T,>(rows: T[], page: number) => ({
  rows: rows.slice((page - 1) * ARTICLES_PAGE_SIZE, page * ARTICLES_PAGE_SIZE),
  pages: Math.max(1, Math.ceil(rows.length / ARTICLES_PAGE_SIZE)),
});

const pageNumber = (page: number | undefined) => Math.max(1, Math.floor(Number(page) || 1));

/** `/articles`, `/articles/page/N`: every article, newest first. */
export async function getArticles(options: { page?: number; locale?: Locale } = {}): Promise<ArticlesPage> {
  const page = pageNumber(options.page);
  const locale = options.locale ?? DEFAULT_LOCALE;
  const all = await listArticles();
  const index = tagIndex(all);
  const names = tagNamer(all, locale, index);
  const { rows, pages } = paginate(all, page);
  return { articles: rows.map((row) => presentArticle(row, names)), total: all.length, page, pages, tags: index.counts(all, tagLangOf(locale)) };
}

export type TopicPage =
  | ({ status: 'ok' } & ArticlesPage & { tag: { key: string; slug: string; name: string } })
  /** The slug is another name of a topic (`小说` for Fiction): redirect to the canonical one. */
  | { status: 'redirect'; slug: string }
  | { status: 'missing' };

/** `/topics/<slug>`, `/topics/<slug>/page/N`. Unknown topics and topics without articles are missing. */
export async function getTopic(options: { slug: string; page?: number; locale?: Locale }): Promise<TopicPage> {
  const page = pageNumber(options.page);
  const locale = options.locale ?? DEFAULT_LOCALE;
  const all = await listArticles();
  const index = tagIndex(all);
  const found = index.bySlug(String(options.slug ?? '').trim());
  if (!found) return { status: 'missing' };
  const slug = index.slug(found.group);
  const filtered = all.filter((article) => article.tags.some((tag) => index.group(tag).key === found.group.key));
  if (!filtered.length) return { status: 'missing' };
  if (!found.canonical) return { status: 'redirect', slug };
  const names = tagNamer(all, locale, index);
  const lang = tagLangOf(locale);
  const { rows, pages } = paginate(filtered, page);
  return {
    status: 'ok',
    articles: rows.map((row) => presentArticle(row, names)),
    total: filtered.length,
    page,
    pages,
    tag: { key: found.group.key, slug, name: index.label(found.group, lang) },
    tags: index.counts(all, lang),
  };
}

export interface ArchiveYear {
  /** `2026`, or '' for articles without a usable date. */
  year: string;
  articles: ArticleSummary[];
}

/** `/archive`: every article on one page, grouped by year (newest first, as in Notion). */
export async function getArchive(locale: Locale = DEFAULT_LOCALE): Promise<{ total: number; years: ArchiveYear[] }> {
  const all = await listArticles();
  const names = tagNamer(all, locale);
  const years: ArchiveYear[] = [];
  for (const row of all) {
    const year = /^\d{4}/.test(row.date) ? row.date.slice(0, 4) : '';
    let group = years.find((entry) => entry.year === year);
    if (!group) years.push((group = { year, articles: [] }));
    group.articles.push(presentArticle(row, names));
  }
  // Undated last; years in descending order even if Notion dates are mixed.
  years.sort((a, b) => (a.year === b.year ? 0 : !a.year ? 1 : !b.year ? -1 : a.year < b.year ? 1 : -1));
  return { total: all.length, years };
}

export interface ArticleView {
  article: ArticleDetail;
  /** True when Notion could not be reached and no cached body existed. */
  bodyMissing: boolean;
}

export async function getArticle(slug: string, locale: Locale = DEFAULT_LOCALE): Promise<ArticleView | undefined> {
  // Neighbours need the full list anyway: use one consistent read instead of
  // looking up the slug and then immediately reading the same table again.
  const all = await listArticles();
  const row = all.find((article) => article.slug === slug);
  if (!row) return undefined;
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

/** Every topic with its slug and count, most used first (/topics, the sitemap). */
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
