import type { APIRoute } from 'astro';
import { authed, deny } from '../../lib/auth';
import { status, syncAll } from '../../lib/db';
export const POST: APIRoute = async ({ request }) => {
  if (!authed(request)) return deny();
  try { await syncAll(); return Response.json({ ok: true, status: status() }); }
  catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
};
