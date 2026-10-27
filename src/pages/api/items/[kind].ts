import type { APIRoute } from 'astro';
import { getItems } from '../../../lib/db.ts';
import { isKind } from '../../../lib/notion.ts';
import { cacheFor, fail, handler, paging } from '../../../lib/http.ts';
import { itemSummary } from '../../../lib/notion.ts';

/** GET /api/items/<writing|films|music>?limit=&offset= — 公开列表（不含正文）。 */
export const GET: APIRoute = handler(async ({ params, url }) => {
  const kind = params.kind;
  if (!isKind(kind)) return fail(400, 'unknown kind; expected writing, films or music');
  const { limit, offset } = paging(url, 100, 500);
  const all = await getItems(kind);
  const page = all.slice(offset, offset + limit).map(itemSummary);
  return Response.json({ kind, total: all.length, limit, offset, items: page }, { headers: cacheFor(120) });
});
