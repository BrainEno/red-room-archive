/**
 * XML/text documents generated from DTOs: RSS, sitemap, robots.txt.
 * Pure functions — the routes in src/pages load the data and call these.
 */
import { escapeHtml } from '../core/text.ts';
import type { ItemSummary, PostSummary } from '../shared/contracts.ts';
import { COLLECTIONS } from '../shared/kinds.ts';

const xml = escapeHtml;

const rfc822 = (value: string) => {
  const date = new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
};

export function rssFeed(input: { origin: string; title: string; description: string; posts: PostSummary[] }): string {
  const { origin, title, description, posts } = input;
  const items = posts
    .map((post) => {
      const link = `${origin}${post.href}`;
      return `    <item>
      <title>${xml(post.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <pubDate>${rfc822(post.created)}</pubDate>
      ${post.tags.map((tag) => `<category>${xml(tag)}</category>`).join('')}
      <description>${xml(post.excerpt)}</description>
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(`${origin}/journal`)}</link>
    <atom:link href="${xml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />
    <description>${xml(description)}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

export function sitemap(input: { origin: string; posts: PostSummary[]; items: ItemSummary[] }): string {
  const { origin, posts, items } = input;
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: '/' },
    ...COLLECTIONS.map((collection) => ({ loc: collection.path })),
    { loc: '/journal' },
    ...items.map((item) => ({ loc: item.href, lastmod: item.updated || undefined })),
    ...posts.map((post) => ({ loc: post.href, lastmod: post.updated || post.created })),
  ];
  const body = urls
    .map(({ loc, lastmod }) => {
      const date = lastmod ? String(lastmod).slice(0, 10) : '';
      return `  <url><loc>${xml(origin + loc)}</loc>${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `<lastmod>${date}</lastmod>` : ''}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export const robots = (origin: string) =>
  `User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
