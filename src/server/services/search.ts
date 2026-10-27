/**
 * Article search. The whole published set is small (hundreds, not millions),
 * so matching happens in memory over title, tags, excerpt and — for bodies
 * already rendered — the article text. No search engine required.
 */
import type { SearchResponse } from '../../shared/contracts.ts';
import { articlesRepository } from '../db/articles.repository.ts';
import { presentArticle } from '../presenters.ts';
import { articleBody, isDemo, listArticles } from './articles.ts';

export const MAX_QUERY_LENGTH = 120;

export async function search(query: string, limit = 20): Promise<SearchResponse> {
  const clean = String(query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!clean) return { query: '', total: 0, articles: [] };

  const articles = await listArticles();
  const bodies = isDemo()
    ? new Map(await Promise.all(articles.map(async (a) => [a.id, (await articleBody(a)).text] as const)))
    : articlesRepository.bodyTexts();
  const terms = clean.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = articles
    .map((article) => {
      const fields: [string, number][] = [
        [article.title, 5],
        [article.tags.join(' '), 3],
        [article.excerpt, 2],
        [bodies.get(article.id) ?? '', 1],
      ];
      let score = 0;
      for (const term of terms) {
        const hit = fields.reduce((best, [text, weight]) => (text.toLowerCase().includes(term) ? Math.max(best, weight) : best), 0);
        if (!hit) return { article, score: 0 }; // every term must match somewhere
        score += hit;
      }
      return { article, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.article.date) - Date.parse(a.article.date));

  return { query: clean, total: scored.length, articles: scored.slice(0, limit).map((entry) => presentArticle(entry.article)) };
}
