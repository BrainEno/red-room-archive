/**
 * Search across journal posts (SQLite) and archive entries (Notion cache).
 * Uses LIKE with escaped wildcards; no external search engine required.
 */
import { KINDS } from '../../shared/kinds.ts';
import type { SearchResponse } from '../../shared/contracts.ts';
import { postsRepository } from '../db/posts.repository.ts';
import { itemsRepository } from '../db/items.repository.ts';
import { presentItem, presentPost } from '../presenters.ts';
import { toPostView } from './posts.ts';

export const MAX_QUERY_LENGTH = 120;

/** Wrap in `%…%` and escape LIKE wildcards (queries use `ESCAPE '\'`). */
export const escapeLike = (value: string) => `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

export function search(query: string, limit = 20): SearchResponse {
  const clean = String(query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!clean) return { query: '', total: 0, posts: [], items: [] };

  const like = escapeLike(clean);
  const posts = postsRepository.search(like, limit).map((row) => presentPost(toPostView(row)));
  const rows = itemsRepository.search(like, limit);
  // Group by collection order so results read Works → Video → Music consistently.
  const items = KINDS.flatMap((kind) => rows.filter((item) => item.kind === kind)).map(presentItem);

  return { query: clean, total: posts.length + items.length, posts, items };
}
