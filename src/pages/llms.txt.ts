// Route: /llms.txt — factual guidance for answer engines; no training licence.
import type { APIRoute } from 'astro';
import { llmsGuide } from '../core/discovery.ts';
import { getRecentArticles, getSite } from '../server/queries.ts';

export const GET: APIRoute = async ({ url }) => {
  const site = getSite();
  const body = llmsGuide({ origin: site.url || url.origin, name: site.name, description: site.about, email: site.email, articles: await getRecentArticles(50) });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
