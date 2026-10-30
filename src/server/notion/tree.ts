/** Fetch a complete article block tree with bounded work per article. */
import type { NotionBlock } from '../../core/blocks.ts';
import { upstreamError } from '../../core/errors.ts';
import type { NotionClient } from './client.ts';

const MAX_DEPTH = 8;
const MAX_BLOCKS = 5000;
const CONCURRENCY = 3;

/** Blocks whose children are separate pages/databases, not article content. */
const OPAQUE = new Set(['child_page', 'child_database']);

export async function fetchBlockTree(client: NotionClient, pageId: string): Promise<NotionBlock[]> {
  let total = 0;
  let root: NotionBlock[] = [];
  type Task = { id: string; depth: number; parent?: NotionBlock };
  let level: Task[] = [{ id: pageId, depth: 0 }];

  // Process one level at a time. Workers only hold a slot while fetching,
  // never while waiting on descendants, so deep trees cannot deadlock or
  // multiply the concurrency limit. Preserve each parent's Notion order.
  while (level.length) {
    const nextLevel: Task[][] = new Array(level.length);
    let next = 0;
    let failure: unknown;
    let failed = false;
    const workers = Array.from({ length: Math.min(CONCURRENCY, level.length) }, async () => {
      while (!failed && next < level.length) {
        const index = next++;
        const task = level[index]!;
        try {
          const payloads = await client.blockChildren(task.id, MAX_BLOCKS - total);
          total += payloads.length;
          if (total > MAX_BLOCKS) throw upstreamError(`Notion article exceeds the ${MAX_BLOCKS} block limit`);
          const blocks = payloads as unknown as NotionBlock[];
          if (task.parent) task.parent.children = blocks;
          else root = blocks;
          const parents = blocks.filter((block) =>
            (block.has_children || block.synced_block?.synced_from?.block_id) && !OPAQUE.has(block.type));
          if (parents.length && task.depth >= MAX_DEPTH) {
            throw upstreamError(`Notion article exceeds the ${MAX_DEPTH} nesting depth limit`);
          }
          nextLevel[index] = parents.map((block) => ({
            id: block.type === 'synced_block' && block.synced_block?.synced_from?.block_id
              ? String(block.synced_block.synced_from.block_id) : String(block.id),
            depth: task.depth + 1,
            parent: block,
          }));
        } catch (error) {
          if (!failed) { failed = true; failure = error; }
        }
      }
    });
    // Wait for in-flight requests to finish before reporting failure; do not
    // leave a detached crawl running after a failed render.
    await Promise.all(workers);
    if (failed) throw failure;
    level = nextLevel.flat();
  }
  return root;
}
