import type { APIRoute } from 'astro';
import { guard } from '../../lib/auth.ts';
import { publicSettings, setSettings, status } from '../../lib/db.ts';
import { handler, readJson } from '../../lib/http.ts';

const out = () => Response.json({ values: publicSettings(), status: status() }, { headers: { 'Cache-Control': 'no-store' } });

/** GET /api/settings — 后台设置（token 以掩码返回）。 */
export const GET: APIRoute = handler(({ request }) => {
  const denied = guard(request); if (denied) return denied;
  return out();
});

/** PUT /api/settings — 更新设置；空字符串表示清除该项，NOTION_TOKEN 传空/掩码表示不修改。 */
export const PUT: APIRoute = handler(async ({ request }) => {
  const denied = guard(request); if (denied) return denied;
  setSettings(await readJson(request));
  return out();
});
