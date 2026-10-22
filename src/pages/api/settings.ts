import type { APIRoute } from 'astro';
import { authed, deny } from '../../lib/auth';
import { publicSettings, setSettings, status } from '../../lib/db';
const out = () => Response.json({ values: publicSettings(), status: status() });
export const GET: APIRoute = ({ request }) => (authed(request) ? out() : deny());
export const PUT: APIRoute = async ({ request }) => {
  if (!authed(request)) return deny();
  setSettings(await request.json());
  return out();
};
