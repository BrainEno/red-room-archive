/**
 * XML/text documents generated from DTOs: RSS, sitemap, robots.txt.
 * Pure functions — the routes in src/pages load the data and call these.
 */
import { escapeHtml } from '../core/text.ts';
import type { ArticleSummary, TagCount } from '../shared/contracts.ts';
import { DEFAULT_LOCALE, LOCALES, localizedPath } from '../shared/i18n.ts';
import { ARCHIVE_PATH, ARTICLES_PATH, MORE_PATH, SUBSCRIBE_PATH, TOPICS_PATH, topicPath } from '../shared/routes.ts';

const xml = escapeHtml;

const rfc822 = (value: string) => {
  const text = String(value ?? '');
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
};

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
      <description>${xml(article.excerpt)}</description>
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

export function sitemap(input: { origin: string; articles: ArticleSummary[]; tags?: TagCount[]; newsletterSignup?: boolean }): string {
  const { origin, articles, tags = [], newsletterSignup = false } = input;
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: '/' },
    { loc: ARTICLES_PATH, lastmod: articles[0]?.updated },
    { loc: TOPICS_PATH },
    { loc: ARCHIVE_PATH, lastmod: articles[0]?.updated },
    { loc: MORE_PATH },
    ...(newsletterSignup ? [{ loc: SUBSCRIBE_PATH }] : []),
    ...tags.map((tag) => ({ loc: topicPath(tag.slug) })), // one URL per topic, whatever language it is written in
    ...articles.map((article) => ({ loc: article.href, lastmod: article.updated || article.date })),
  ];
  const body = urls
    .map(({ loc, lastmod }) => {
      const date = lastmod ? String(lastmod).slice(0, 10) : '';
      // Every page exists in each interface language (`/zh-CN/…`); list the
      // alternates so search engines index the Chinese pages too.
      const alternates = [
        ...LOCALES.map((locale) => [locale, localizedPath(loc, locale)]),
        ['x-default', localizedPath(loc, DEFAULT_LOCALE)],
      ]
        .map(([hreflang, href]) => `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${xml(origin + href)}"/>`)
        .join('');
      const entry = (href: string) =>
        `  <url><loc>${xml(origin + href)}</loc>${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `<lastmod>${date}</lastmod>` : ''}${alternates}</url>`;
      return LOCALES.map((locale) => entry(localizedPath(loc, locale))).join('\n');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;
}

export const robots = (origin: string) =>
  `User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
