/**
 * Domain rows → wire DTOs (`shared/contracts.ts`).
 *
 * Both the JSON API and the server-rendered pages go through these functions,
 * so a visitor and an API client always see the same fields with the same
 * meaning.
 */
import { readingMinutes } from '../core/text.ts';
import type { ArticleDetail, ArticleLink, ArticleSummary, TopicRef } from '../shared/contracts.ts';
import { articlePath, topicSlug } from '../shared/routes.ts';
import type { ArticleBody, ArticleRow } from './db/articles.repository.ts';

/** Raw Notion tags → topics with display names and slugs (see services/tags.ts); the default keeps them as written. */
export type TagNames = (tags: string[]) => TopicRef[];
const asWritten: TagNames = (tags) => tags.map((name) => ({ name, slug: topicSlug(name) }));

export const presentArticle = (row: ArticleRow, tagNames: TagNames = asWritten): ArticleSummary => {
  const topics = tagNames(row.tags);
  return {
  id: row.id,
  slug: row.slug,
  title: row.title,
  date: row.date,
  tags: topics.map((topic) => topic.name),
  topics,
  excerpt: row.excerpt,
  cover: row.cover,
  rank: row.rank,
  href: articlePath(row.slug),
  updated: row.updated,
  };
};

export const presentArticleDetail = (
  row: ArticleRow,
  body: ArticleBody,
  around: { previous: ArticleLink | null; next: ArticleLink | null },
  tagNames: TagNames = asWritten,
): ArticleDetail => ({
  ...presentArticle(row, tagNames),
  html: body.html,
  toc: body.toc,
  readingMinutes: readingMinutes(body.text),
  ...around,
});
