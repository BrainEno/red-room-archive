/**
 * Domain rows → wire DTOs (`shared/contracts.ts`).
 *
 * Both the JSON API and the server-rendered pages go through these functions,
 * so a visitor and an API client always see the same fields with the same
 * meaning.
 */
import { readingMinutes } from '../core/text.ts';
import type { ArticleDetail, ArticleLink, ArticleSummary } from '../shared/contracts.ts';
import { articlePath } from '../shared/routes.ts';
import type { ArticleBody, ArticleRow } from './db/articles.repository.ts';

export const presentArticle = (row: ArticleRow): ArticleSummary => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  date: row.date,
  tags: row.tags,
  excerpt: row.excerpt,
  cover: row.cover,
  rank: row.rank,
  href: articlePath(row.slug),
  updated: row.updated,
});

export const presentArticleDetail = (
  row: ArticleRow,
  body: ArticleBody,
  around: { previous: ArticleLink | null; next: ArticleLink | null },
): ArticleDetail => ({
  ...presentArticle(row),
  html: body.html,
  toc: body.toc,
  readingMinutes: readingMinutes(body.text),
  ...around,
});
