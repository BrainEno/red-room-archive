/**
 * Interface languages and how a request picks one.
 *
 * Only the interface is translated (navigation, labels, dates, site copy).
 * Articles are shown in whatever language they were written in Notion.
 *
 * Pages carry the language in the path: English is unprefixed, every other
 * locale lives under its prefix (`/articles` ↔ `/zh-CN/articles`), so each
 * language has its own crawlable, cacheable, shareable URL. The middleware
 * (src/middleware.ts) serves prefixed paths from the same page routes, and
 * only *redirects* based on the other signals:
 *   - `?lang=` on a page            — set by the switcher; remembered in the
 *                                      `lang` cookie, then 302 to the clean URL
 *   - the `lang` cookie             — an unprefixed page 302s to the prefix
 *   - `Accept-Language`             — only for `/` with no cookie yet
 * APIs have no prefix and keep `?lang=` → cookie → Accept-Language → English
 * (resolveLocale).
 */

export const LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_PARAM = 'lang';
export const LOCALE_COOKIE = 'lang';

/** Native names, shown in the switcher's accessible labels. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', 'zh-CN': '简体中文' };
/** Short labels shown in the switcher itself. */
export const LOCALE_SHORT: Record<Locale, string> = { en: 'EN', 'zh-CN': '中文' };

/**
 * Map a language tag to a supported locale. Any Chinese tag (zh, zh-CN,
 * zh-Hans, zh-TW, zh-HK…) selects Simplified Chinese — the only Chinese
 * interface for now; any English tag selects English.
 */
export function parseLocale(value: string | null | undefined): Locale | null {
  const tag = String(value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!tag) return null;
  const primary = tag.split('-')[0];
  if (primary === 'zh') return 'zh-CN';
  if (primary === 'en') return 'en';
  return null;
}

/** Best supported locale from an `Accept-Language` header (honours q-values). */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const entry of ranked) {
    const locale = parseLocale(entry.tag);
    if (locale) return locale;
  }
  return null;
}

export interface LocaleSources {
  param?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}

export function resolveLocale(sources: LocaleSources): Locale {
  return parseLocale(sources.param) ?? parseLocale(sources.cookie) ?? negotiateLocale(sources.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** Han ideographs (incl. extension A and compatibility forms). */
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN = /[A-Za-z]/;

/**
 * Language of a piece of content (an article title, an excerpt), so CSS can
 * pick the matching typography whatever the interface language is: a Chinese
 * title on the English homepage still gets the Chinese display cut and line
 * height. `undefined` = no letters at all, inherit from the page.
 */
export function contentLang(text: string | null | undefined): Locale | undefined {
  const value = String(text ?? '');
  if (HAN.test(value)) return 'zh-CN';
  if (LATIN.test(value)) return 'en';
  return undefined;
}

/** Path prefix per locale; the default language has none. */
export const LOCALE_PREFIX: Record<Locale, string> = { en: '', 'zh-CN': '/zh-CN' };

/**
 * True for paths that are pages (and so exist once per language). APIs,
 * media proxies, uploads, the admin shell, build assets and files with an
 * extension (`/rss.xml`, `/robots.txt`, `/favicon.svg`) are shared.
 */
export function isPagePath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  if (/^\/(api|media|uploads|admin|_astro|_)(\/|$)/.test(pathname)) return false;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !last.includes('.');
}

/** `/zh-CN/articles` → `{ locale: 'zh-CN', path: '/articles' }`; unprefixed → `{ locale: null, path }`. */
export function splitLocale(pathname: string): { locale: Locale | null; path: string } {
  for (const locale of LOCALES) {
    const prefix = LOCALE_PREFIX[locale];
    if (!prefix) continue;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { locale, path: pathname.slice(prefix.length) || '/' };
    }
  }
  return { locale: null, path: pathname };
}

/**
 * A locale-neutral site path in one interface language:
 * `localePath('/articles?x=1', 'zh-CN')` → `/zh-CN/articles?x=1`,
 * `localePath('/', 'zh-CN')` → `/zh-CN`. The default language keeps the
 * path as is, and non-page paths (APIs, files) are never prefixed.
 */
export function localePath(path: string, locale: Locale): string {
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix || !path.startsWith('/') || path.startsWith('//') || !isPagePath(path)) return path;
  const cut = path.search(/[?#]/);
  const pathname = cut === -1 ? path : path.slice(0, cut);
  const rest = cut === -1 ? '' : path.slice(cut);
  return `${prefix}${pathname === '/' ? '' : pathname}${rest}`;
}

/** Same as localePath — used for canonical / hreflang links and the sitemap. */
export const localizedPath = localePath;

/**
 * What the language switcher links to: the current page in `locale`, plus
 * `?lang=` so the server remembers the choice (it then redirects to the
 * clean URL). `search` is the current query string, kept apart from `lang`.
 */
export function switchHref(path: string, search: string, locale: Locale): string {
  const params = new URLSearchParams(search);
  params.delete(LOCALE_PARAM);
  params.set(LOCALE_PARAM, locale);
  return `${localePath(path, locale)}?${params.toString()}`;
}
