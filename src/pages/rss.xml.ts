// Route: /rss.xml — journal feed.
import type { APIRoute } from 'astro';
import { getRecentPosts, getSite } from '../server/queries.ts';
import { rssFeed } from '../ui/feeds.ts';

export const GET: APIRoute = ({ url }) => {
  const site = getSite();
  const body = rssFeed({
    origin: site.url || url.origin,
    title: `${site.name} — ${site.journal.label}`,
    description: site.journal.intro,
    posts: getRecentPosts(30),
  });
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
};
