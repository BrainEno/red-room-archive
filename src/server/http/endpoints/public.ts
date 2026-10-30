/**
 * Public, anonymous endpoints: health, site profile, articles, tags, search.
 */
import { badRequest } from '../../../core/errors.ts';
import type {
  ArticleDetail,
  ArticleListResponse,
  HealthResponse,
  SearchResponse,
  SiteResponse,
  TagListResponse,
} from '../../../shared/contracts.ts';
import { connection } from '../../db/connection.ts';
import { presentArticle, presentArticleDetail } from '../../presenters.ts';
import { articleBody, listArticles, neighbours, requireArticle } from '../../services/articles.ts';
import { filterByTag, tagNamer, topicCounts } from '../../services/tags.ts';
import { isAdmin, requestPeer, requireAdmin } from '../../services/auth.ts';
import { MAX_QUERY_LENGTH, search } from '../../services/search.ts';
import { notionReady } from '../../services/settings.ts';
import { siteResponse } from '../../services/status.ts';
import { DEFAULT_LOCALE, parseLocale } from '../../../shared/i18n.ts';
import { NO_STORE, json, paging, param, publicCache, route, truthy } from '../respond.ts';

/** GET /api/health — liveness + dependency probe for deploy platforms. */
export const health = route(() => {
  let database = false;
  try {
    connection().prepare('SELECT 1').get();
    database = true;
  } catch (error) {
    console.error('[health] database', error);
  }
  const body: HealthResponse = {
    ok: database,
    time: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    database,
    notion: database && notionReady(),
  };
  return json(body, { status: database ? 200 : 503, headers: NO_STORE });
});

/** Language for localised fields: `?lang=` only — never the cookie — so the public cache key stays the URL. */
const langOf = (url: URL) => parseLocale(url.searchParams.get('lang')) ?? DEFAULT_LOCALE;

/** GET /api/site?lang= — public profile and article count. */
export const site = route((context) => json<SiteResponse>(siteResponse(langOf(context.url)), { headers: NO_STORE }));

/** GET /api/articles?tag=&limit=&offset=&lang= — newest first, summaries only; tag names in `lang`. */
export const listArticlesEndpoint = route(async (context) => {
  const tag = context.url.searchParams.get('tag')?.trim() || null;
  if (tag && tag.length > 200) throw badRequest('tag too long');
  const { limit, offset } = paging(context.url, 20, 100);
  const everything = await listArticles();
  const all = filterByTag(everything, tag);
  const names = tagNamer(everything, langOf(context.url));
  const body: ArticleListResponse = {
    tag,
    total: all.length,
    limit,
    offset,
    articles: all.slice(offset, offset + limit).map((row) => presentArticle(row, names)),
  };
  return json(body, { headers: publicCache(60) });
});

/**
 * GET /api/articles/:slug — one article with its rendered body.
 * `?refresh=1` re-fetches the body from Notion and is admin-only, so
 * anonymous traffic can never be amplified into Notion API calls.
 */
export const getArticle = route(async (context) => {
  const slug = param(context, 'slug');
  const refresh = truthy(context.url.searchParams.get('refresh'));
  if (refresh) requireAdmin(context.request, requestPeer(context));
  const article = await requireArticle(slug);
  const body = await articleBody(article, { refresh });
  const all = await listArticles();
  const detail = presentArticleDetail(article, body, neighbours(all, article), tagNamer(all, langOf(context.url)));
  const admin = refresh || isAdmin(context.request);
  return json<ArticleDetail>(detail, { headers: admin ? NO_STORE : publicCache(60) });
});

/** GET /api/tags?lang= — every topic (bilingual pairs merged) with its article count, most used first. */
export const tags = route(async (context) =>
  json<TagListResponse>({ tags: topicCounts(await listArticles(), langOf(context.url)) }, { headers: publicCache(120) }),
);

/** GET /api/search?q=&limit=&lang= */
export const searchArticles = route(async (context) => {
  const q = context.url.searchParams.get('q') ?? '';
  if (q.length > MAX_QUERY_LENGTH * 4) throw badRequest('query too long');
  const { limit } = paging(context.url, 20, 50);
  return json<SearchResponse>(await search(q, limit, langOf(context.url)), { headers: { 'Cache-Control': 'public, max-age=30' } });
});
