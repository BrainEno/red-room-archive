/**
 * XML/text documents generated from DTOs: RSS, sitemap, robots.txt.
 * Pure functions — the routes in src/pages load the data and call these.
 */
import { escapeHtml } from '../core/text.ts';
import type { ArticleSummary, TagCount } from '../shared/contracts.ts';
import { ARTICLES_PATH, tagPath } from '../shared/routes.ts';

const xml = escapeHtml;

const rfc822 = (value: string) => {
  const text = String(value ?? '');
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
};

const absolute = (origin: string, url: string) => (/^https?:\/\//i.test(url) ? url : `${origin}${url}`);

export function rssFeed(input: { origin: string; title: string; description: string; articles: ArticleSummary[] }): string {
  const { origin, title, description, articles } = input;
  const items = articles
    .map((article) => {
      const link = `${origin}${article.href}`;
      return `    <item>
      <title>${xml(article.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <pubDate>${rfc822(article.date)}</pubDate>
      ${article.tags.map((tag) => `<category>${xml(tag)}</category>`).join('')}
      <description>${xml(article.excerpt)}</description>${
        article.cover ? `\n      <enclosure url="${xml(absolute(origin, article.cover))}" type="image/jpeg" length="0" />` : ''
      }
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(`${origin}${ARTICLES_PATH}`)}</link>
    <atom:link href="${xml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />
    <description>${xml(description)}</description>
${items}
  </channel>
</rss>
`;
}

export function sitemap(input: { origin: string; articles: ArticleSummary[]; tags?: TagCount[] }): string {
  const { origin, articles, tags = [] } = input;
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: '/' },
    { loc: ARTICLES_PATH, lastmod: articles[0]?.updated },
    ...tags.map((tag) => ({ loc: tagPath(tag.name) })),
    ...articles.map((article) => ({ loc: article.href, lastmod: article.updated || article.date })),
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
