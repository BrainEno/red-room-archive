/**
 * Public, anonymous endpoints: health, site profile, archive, items, search.
 */
import { badRequest } from '../../../core/errors.ts';
import type {
  ArchiveResponse,
  HealthResponse,
  ItemDetail,
  ItemListResponse,
  SearchResponse,
  SiteResponse,
} from '../../../shared/contracts.ts';
import { KINDS, isKind, type Kind } from '../../../shared/kinds.ts';
import { connection } from '../../db/connection.ts';
import { presentItem, presentItemDetail } from '../../presenters.ts';
import { itemBody, listItems, requireItem } from '../../services/archive.ts';
import { isAdmin, requireAdmin } from '../../services/auth.ts';
import { MAX_QUERY_LENGTH, search } from '../../services/search.ts';
import { notionReady, siteResponse } from '../../services/settings.ts';
import { NO_STORE, json, paging, param, publicCache, route, truthy } from '../respond.ts';

export const requireKind = (value: string): Kind => {
  if (!isKind(value)) throw badRequest(`unknown kind “${value}”; expected ${KINDS.join(', ')}`, { kind: value });
  return value;
};

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

/** GET /api/site — public profile (name, email, about, intro) and entry counts. */
export const site = route(() => json<SiteResponse>(siteResponse(), { headers: publicCache(60) }));

/** GET /api/archive — every collection at once (summaries only, no bodies). */
export const archive = route(async () => {
  const entries = await Promise.all(KINDS.map(async (kind) => [kind, (await listItems(kind)).map(presentItem)] as const));
  const items = Object.fromEntries(entries) as ArchiveResponse['items'];
  const counts = Object.fromEntries(entries.map(([kind, list]) => [kind, list.length])) as ArchiveResponse['counts'];
  return json<ArchiveResponse>({ items, counts }, { headers: publicCache(120) });
});

/** GET /api/items/:kind?limit=&offset= — one collection, paginated. */
export const listCollection = route(async (context) => {
  const kind = requireKind(param(context, 'kind'));
  const { limit, offset } = paging(context.url, 100, 500);
  const all = await listItems(kind);
  const body: ItemListResponse = {
    kind,
    total: all.length,
    limit,
    offset,
    items: all.slice(offset, offset + limit).map(presentItem),
  };
  return json(body, { headers: publicCache(120) });
});

/**
 * GET /api/items/:kind/:slug — one entry with its sanitised body HTML.
 * `?refresh=1` re-fetches the body from Notion and is admin-only, so
 * anonymous traffic can never be amplified into Notion API calls.
 */
export const getEntry = route(async (context) => {
  const kind = requireKind(param(context, 'kind'));
  const slug = param(context, 'slug');
  const refresh = truthy(context.url.searchParams.get('refresh'));
  if (refresh) requireAdmin(context.request);
  const item = await requireItem(kind, slug);
  const body = presentItemDetail(item, await itemBody(item, { refresh }));
  const admin = refresh || isAdmin(context.request);
  return json<ItemDetail>(body, { headers: admin ? NO_STORE : publicCache(60) });
});

/** GET /api/search?q=&limit= — published posts + cached archive entries. */
export const searchAll = route((context) => {
  const q = context.url.searchParams.get('q') ?? '';
  if (q.length > MAX_QUERY_LENGTH * 4) throw badRequest('query too long');
  const { limit } = paging(context.url, 20, 50);
  return json<SearchResponse>(search(q, limit), { headers: { 'Cache-Control': 'public, max-age=30' } });
});
