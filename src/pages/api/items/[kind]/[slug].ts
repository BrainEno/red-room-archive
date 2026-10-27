import type { APIRoute } from 'astro';
import { getBody, getItem } from '../../../../lib/db.ts';
import { isKind, itemSummary } from '../../../../lib/notion.ts';
import { cacheFor, fail, handler, notFound } from '../../../../lib/http.ts';

/** GET /api/items/<kind>/<slug>?refresh=1 — 单条记录 + 正文 HTML（已消毒）。 */
export const GET: APIRoute = handler(async ({ params, url }) => {
  const { kind, slug } = params;
  if (!isKind(kind)) return fail(400, 'unknown kind; expected writing, films or music');
  const item = await getItem(kind, decodeURIComponent(slug ?? ''));
  if (!item) return notFound('item not found');
  const body = await getBody(item, url.searchParams.get('refresh') === '1');
  return Response.json({ ...itemSummary(item), body, bodyHtml: body }, { headers: cacheFor(60) });
});
