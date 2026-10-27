import type { APIRoute } from 'astro';
import { getItems } from '../../lib/db.ts';
import { cacheFor } from '../../lib/http.ts';
import { itemSummary } from '../../lib/notion.ts';

/** GET /api/archive — 公开：三类内容的完整列表（不含正文，正文见 /api/items/<kind>/<slug>）。 */
export const GET: APIRoute = async () => {
  const [writing, films, music] = await Promise.all([getItems('writing'), getItems('films'), getItems('music')]);
  const slim = (items: Awaited<ReturnType<typeof getItems>>) => items.map(itemSummary);
  return Response.json(
    { writing: slim(writing), films: slim(films), music: slim(music) },
    { headers: cacheFor(120) },
  );
};
