/**
 * Interface languages and how a request picks one.
 *
 * Only the interface is translated (navigation, labels, dates, site copy).
 * Articles are shown in whatever language they were written in Notion.
 *
 * Resolution order (first match wins):
 *   1. `?lang=` in the URL      — explicit, shareable, what the switcher links to
 *   2. the `lang` cookie        — remembers the last explicit choice
 *   3. `Accept-Language`        — the browser's preference
 *   4. DEFAULT_LOCALE
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

/** The same URL with `?lang=` set — what the language switcher links to. */
export function localeHref(url: URL, locale: Locale): string {
  const params = new URLSearchParams(url.search);
  params.set(LOCALE_PARAM, locale);
  return `${url.pathname}?${params.toString()}${url.hash}`;
}

/**
 * A site path in a given interface language: the default language keeps the
 * clean URL, others add `lang=` (`/articles?tag=x` → `/articles?tag=x&lang=zh-CN`).
 * Used for canonical / hreflang links and the sitemap.
 */
export function localizedPath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${LOCALE_PARAM}=${encodeURIComponent(locale)}`;
}
