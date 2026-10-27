import type { APIRoute } from 'astro';
import { notionReady } from '../../lib/notion.ts';
import { db } from '../../lib/db.ts';

/** GET /api/health — 部署探针（公开，不泄露内容）。 */
export const GET: APIRoute = () => {
  let database = false;
  try { db(); database = true; } catch (e) { console.error('[health]', e); }
  return Response.json(
    { ok: database, time: new Date().toISOString(), uptime: Math.round(process.uptime()), database, notion: notionReady() },
    { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
};
