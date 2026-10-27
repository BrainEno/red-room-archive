// Route: /robots.txt
import type { APIRoute } from 'astro';
import { getSite } from '../server/queries.ts';
import { robots } from '../ui/feeds.ts';

export const GET: APIRoute = ({ url }) =>
  new Response(robots(getSite().url || url.origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
