// Route: /sitemap.xml
import type { APIRoute } from 'astro';
import { getCollections, getRecentPosts, getSite } from '../server/queries.ts';
import { sitemap } from '../ui/feeds.ts';

export const GET: APIRoute = async ({ url }) => {
  const site = getSite();
  const collections = await getCollections();
  const body = sitemap({
    origin: site.url || url.origin,
    posts: getRecentPosts(5000),
    items: collections.flatMap((collection) => collection.items),
  });
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
