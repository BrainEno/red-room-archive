/**
 * Tag topics for one interface language (see core/tags.ts for the rules).
 *
 * The glossary is the built-in pairs plus the admin's `tag_glossary` setting;
 * labels follow the names actually used across the published articles, so the
 * index is always built from the full article list (also when presenting a
 * filtered page), keeping every label consistent across the site.
 */
import { BUILTIN_TAG_GLOSSARY } from '../../content/tags.ts';
import { createTagIndex, type TagIndex, type TagLang } from '../../core/tags.ts';
import type { Locale } from '../../shared/i18n.ts';
import type { ArticleRow } from '../db/articles.repository.ts';
import type { TagNames } from '../presenters.ts';
import { resolveSetting } from './settings.ts';

export type { TagIndex };

export const tagLangOf = (locale: Locale): TagLang => (locale === 'zh-CN' ? 'zh' : 'en');

/** Index over the published articles; build it once per request from the full list. */
export function tagIndex(articles: ArticleRow[]): TagIndex {
  return createTagIndex([BUILTIN_TAG_GLOSSARY, resolveSetting('tag_glossary') ?? ''], articles.map((article) => article.tags));
}

/** Display names for one language, consistent across every article of `all`. */
export function tagNamer(all: ArticleRow[], locale: Locale): TagNames {
  const index = tagIndex(all);
  const lang = tagLangOf(locale);
  return (tags) => index.names(tags, lang);
}

/** `?tag=` filter: `Fiction`, `fiction` and `小说` select the same articles. */
export function filterByTag(articles: ArticleRow[], tag: string | null | undefined): ArticleRow[] {
  if (!tag) return articles;
  const index = tagIndex(articles);
  return articles.filter((article) => index.matches(article.tags, tag));
}

/** Topics with counts, labelled in one language, most used first. */
export function topicCounts(articles: ArticleRow[], locale: Locale) {
  return tagIndex(articles).counts(articles, tagLangOf(locale));
}
