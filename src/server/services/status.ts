/**
 * Aggregate status used by the admin dashboard, /api/sync, /api/settings and
 * /api/health. Composed here so every surface reports the same numbers.
 */
import type { SyncStatus } from '../../shared/contracts.ts';
import { KINDS } from '../../shared/kinds.ts';
import { itemsRepository } from '../db/items.repository.ts';
import { postsRepository } from '../db/posts.repository.ts';
import { notionReady } from './settings.ts';
import { syncState } from './archive.ts';

export function syncStatus(): SyncStatus {
  const counts = itemsRepository.counts();
  const published = postsRepository.count(false);
  const all = postsRepository.count(true);
  return {
    notion: notionReady(),
    databases: Object.fromEntries(KINDS.map((kind) => [kind, notionReady(kind)])) as SyncStatus['databases'],
    syncedAt: syncState().syncedAt,
    syncing: syncState().syncing,
    syncError: syncState().syncError,
    counts,
    posts: published,
    drafts: all - published,
  };
}
