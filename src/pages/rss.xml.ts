// Route: /rss.xml — newest articles.
import type { APIRoute } from 'astro';
import { getRecentArticles, getSite } from '../server/queries.ts';
import { rssFeed } from '../ui/feeds.ts';

export const GET: APIRoute = async ({ url }) => {
  const site = getSite();
  const body = rssFeed({
    origin: site.url || url.origin,
    title: site.name,
    description: site.about,
    articles: await getRecentArticles(30),
  });
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
};
