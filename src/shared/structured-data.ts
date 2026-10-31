/**
 * schema.org structured data (JSON-LD) for search engines: the site and its
 * search box on the homepage, articles with breadcrumbs, topic breadcrumbs.
 * Only emitted when SITE_URL is known, because every URL must be absolute.
 *
 * The output goes into `<script type="application/ld+json">` — a data block
 * that browsers never execute (so the CSP is unaffected) — and `<` is escaped
 * so no string from Notion can close the element early.
 */
export type JsonLd = Record<string, unknown>;

/** Absolute URL on the site, or '' when SITE_URL is not set. */
export const absoluteUrl = (siteUrl: string | undefined, path: string): string => (siteUrl ? new URL(path, siteUrl).toString() : '');

export function serializeJsonLd(items: JsonLd[]): string {
  const document = items.length === 1 ? { '@context': 'https://schema.org', ...items[0] } : { '@context': 'https://schema.org', '@graph': items };
  return JSON.stringify(document).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function websiteLd(input: { url: string; name: string; description?: string; inLanguage: string; searchUrl: string }): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': `${input.url}#website`,
    url: input.url,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    inLanguage: input.inLanguage,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${input.searchUrl}?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function articleLd(input: {
  url: string;
  headline: string;
  description?: string;
  image?: string;
  datePublished?: string;
  dateModified?: string;
  keywords?: string[];
  inLanguage: string;
  siteName: string;
  homeUrl: string;
  /** Copyright: the owner is the publisher; `license` points at the reuse terms page. */
  copyrightYear?: number;
  license?: string;
}): JsonLd {
  const publisher = { '@type': 'Organization', name: input.siteName, url: input.homeUrl };
  return {
    '@type': 'BlogPosting',
    '@id': `${input.url}#article`,
    mainEntityOfPage: input.url,
    url: input.url,
    headline: input.headline.length > 110 ? `${input.headline.slice(0, 109)}…` : input.headline,
    ...(input.description ? { description: input.description } : {}),
    ...(input.image ? { image: [input.image] } : {}),
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    ...(input.dateModified || input.datePublished ? { dateModified: input.dateModified || input.datePublished } : {}),
    ...(input.keywords?.length ? { keywords: input.keywords.join(', ') } : {}),
    inLanguage: input.inLanguage,
    author: publisher,
    publisher,
    copyrightHolder: publisher,
    ...(input.copyrightYear ? { copyrightYear: input.copyrightYear } : {}),
    ...(input.license ? { license: input.license } : {}),
    isPartOf: { '@id': `${input.homeUrl}#website` },
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]): JsonLd {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })),
  };
}
