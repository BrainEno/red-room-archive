/**
 * Archive service — Notion-backed collections.
 *
 * Public reads always serve the local cache. The cache refreshes per kind:
 * on first use, and in the background once `SYNC_TTL_SECONDS` has elapsed.
 * Concurrent callers share one in-flight sync per kind, so a traffic spike
 * never turns into a burst of Notion requests.
 */
import { blocksToHtml } from '../../core/blocks.ts';
import { esc } from '../../core/safety.ts';
import { demo } from '../../content/site.ts';
import { notFound, upstreamError } from '../../core/errors.ts';
import { config } from '../config.ts';
import { KINDS, type Kind } from '../../shared/kinds.ts';
import { itemsRepository, type ItemRow } from '../db/items.repository.ts';
import { metaRepository } from '../db/meta.repository.ts';
import { NotionClient } from '../notion/client.ts';
import { toItems } from '../notion/mapper.ts';
import { NotionWriter } from '../notion/writer.ts';
import { notionConfig, notionReady } from './settings.ts';

const inflight = new Map<Kind, Promise<number>>();

/** Notion client + writer for the currently configured credentials. */
export function notionAccess(): { client: NotionClient; writer: NotionWriter } {
  const { token, databases } = notionConfig();
  if (!token) throw upstreamError('Notion is not configured');
  const client = new NotionClient(token);
  return { client, writer: new NotionWriter(client, databases) };
}

const demoItems = (kind: Kind): ItemRow[] =>
  (demo[kind] ?? []).map((entry, index) => ({
    id: `demo-${kind}-${index}`,
    kind,
    title: String(entry.title ?? `Entry ${index + 1}`),
    slug: String(index + 1),
    data: entry as Record<string, unknown>,
    updated: '',
  }));

/** Fetch one database and replace its cache in a single transaction. */
export async function syncKind(kind: Kind): Promise<number> {
  if (!notionReady(kind)) return 0;
  const running = inflight.get(kind);
  if (running) return running;

  const task = (async () => {
    const { token, databases } = notionConfig();
    const databaseId = databases[kind]!;
    try {
      const pages = await new NotionClient(token!).queryDatabase(databaseId);
      const items = toItems(kind, pages);
      itemsRepository.replaceKind(kind, items);
      metaRepository.set('synced', String(Date.now()));
      metaRepository.set(`synced:${kind}`, String(Date.now()));
      metaRepository.set('sync_error', '');
      return items.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      metaRepository.set('sync_error', message.slice(0, 500));
      throw error;
    } finally {
      inflight.delete(kind);
    }
  })();

  inflight.set(kind, task);
  return task;
}

/** Sync several kinds (default: all configured ones). */
export async function syncAll(kinds: Kind[] = KINDS as Kind[]): Promise<Partial<Record<Kind, number>>> {
  const synced: Partial<Record<Kind, number>> = {};
  for (const kind of kinds) {
    if (!notionReady(kind)) continue;
    synced[kind] = await syncKind(kind);
  }
  return synced;
}

const lastSync = () =>
  Number(metaRepository.get('synced') ?? 0) ||
  Math.max(0, ...KINDS.map((kind) => Number(metaRepository.get(`synced:${kind}`) ?? 0)));

/** Refresh the cache when it is empty or older than the TTL. */
async function ensureFresh(kind: Kind): Promise<void> {
  if (!notionReady(kind)) return;
  const kindSync = Number(metaRepository.get(`synced:${kind}`) ?? 0);
  const fresh = kindSync > 0 && Date.now() - kindSync < config.syncTtlMs();
  if (fresh) return;
  try {
    if (!kindSync) await syncKind(kind);
    else void syncKind(kind).catch((error) => console.error('[sync] background refresh failed', error));
  } catch (error) {
    // A failed refresh must not take the public site down: serve stale data.
    console.error('[sync] refresh failed', error);
  }
}

export async function listItems(kind: Kind): Promise<ItemRow[]> {
  if (!notionReady()) return demoItems(kind);
  await ensureFresh(kind);
  return itemsRepository.byKind(kind).sort(
    (a, b) =>
      Number(b.data.year ?? 0) - Number(a.data.year ?? 0) ||
      String(b.updated).localeCompare(String(a.updated)),
  );
}

export async function findItem(kind: Kind, slug: string): Promise<ItemRow | undefined> {
  if (!notionReady()) return demoItems(kind).find((item) => item.slug === slug || item.id === slug);
  await ensureFresh(kind);
  return itemsRepository.bySlug(kind, slug);
}

export async function requireItem(kind: Kind, slug: string): Promise<ItemRow> {
  const item = await findItem(kind, slug);
  if (!item) throw notFound(`no ${kind} entry with slug “${slug}”`, { kind, slug });
  return item;
}

/** Rendered page body (cached; refreshed from Notion on demand). */
export async function itemBody(item: ItemRow, options: { refresh?: boolean } = {}): Promise<string> {
  if (!notionReady()) return `<p>${esc(item.data.summary ?? '')}</p>`;
  if (!options.refresh) {
    const cached = itemsRepository.body(item.id);
    if (cached) return cached;
  }
  const { writer } = notionAccess();
  const html = blocksToHtml(await writer.bodyBlocks(item.id));
  itemsRepository.setBody(item.id, html);
  return html;
}

/** Drop the cached body so the next read re-fetches it. */
export const invalidateBody = (id: string) => itemsRepository.dropBody(id);

/** Remove an entry from the cache (after archiving it in Notion). */
export const forgetItem = (id: string) => itemsRepository.remove(id);

export interface SyncState {
  syncedAt: number;
  syncing: boolean;
  syncError: string | null;
}

export function syncState(): SyncState {
  return {
    syncedAt: lastSync(),
    syncing: inflight.size > 0,
    syncError: metaRepository.get('sync_error') || null,
  };
}
