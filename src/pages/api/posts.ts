import type { APIRoute } from 'astro';
import { authed, deny } from '../../lib/auth';
import { addPost, listPosts } from '../../lib/db';
export const GET: APIRoute = () => Response.json(listPosts());
export const POST: APIRoute = async ({ request }) => {
  if (!authed(request)) return deny();
  const b = await request.json();
  if (!b.title || !b.body) return Response.json({ error: 'title and body are required' }, { status: 400 });
  return Response.json({ ok: true, slug: addPost(b) });
};
