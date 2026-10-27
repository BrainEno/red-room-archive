/**
 * Fetch a page's block tree (children attached as `block.children`).
 *
 * Notion only returns one level per request, so nested content (lists,
 * toggles, columns, tables) costs one request per parent. Siblings are
 * fetched with a small concurrency limit — the API allows ~3 requests/s and
 * the client retries 429s — instead of the strictly sequential N+1 walk.
 */
import type { NotionBlock } from '../../core/blocks.ts';
import type { NotionBlockPayload, NotionClient } from './client.ts';

export const MAX_DEPTH = 8;
export const MAX_BLOCKS = 5000;
const CONCURRENCY = 3;

/** Blocks whose children are separate pages/databases, not article content. */
const OPAQUE = new Set(['child_page', 'child_database']);

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

export async function fetchBlockTree(client: NotionClient, pageId: string): Promise<NotionBlock[]> {
  let total = 0;

  const load = async (parentId: string, depth: number): Promise<NotionBlock[]> => {
    const payloads: NotionBlockPayload[] = await client.blockChildren(parentId);
    total += payloads.length;
    const blocks = payloads as unknown as NotionBlock[];
    if (depth >= MAX_DEPTH) return blocks;

    const parents = blocks.filter(
      (block) => (block.has_children || block.synced_block?.synced_from?.block_id) && !OPAQUE.has(block.type),
    );
    await mapLimit(parents, CONCURRENCY, async (block) => {
      if (total > MAX_BLOCKS) return;
      // A synced copy shows the original block's children.
      const source = block.type === 'synced_block' && block.synced_block?.synced_from?.block_id
        ? String(block.synced_block.synced_from.block_id)
        : String(block.id);
      block.children = await load(source, depth + 1);
    });
    return blocks;
  };

  return load(pageId, 0);
}
