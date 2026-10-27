// Route: /sitemap.xml
import type { APIRoute } from 'astro';
import { getRecentArticles, getSite, getTopics } from '../server/queries.ts';
import { sitemap } from '../ui/feeds.ts';

export const GET: APIRoute = async ({ url }) => {
  const site = getSite();
  const [articles, tags] = await Promise.all([getRecentArticles(5000), getTopics()]);
  const body = sitemap({ origin: site.url || url.origin, articles, tags });
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
