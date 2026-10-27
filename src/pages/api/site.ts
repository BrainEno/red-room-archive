import type { APIRoute } from 'astro';
import { getSite, status } from '../../lib/db.ts';
import { cacheFor } from '../../lib/http.ts';

/** GET /api/site — 公开站点信息（名称/邮箱/简介/引言），供前端或外部客户端使用。 */
export const GET: APIRoute = async () => {
  const site = await getSite();
  const st = status();
  return Response.json(
    { ...site, notionConfigured: st.notion, counts: st.counts },
    { headers: cacheFor(60) },
  );
};
