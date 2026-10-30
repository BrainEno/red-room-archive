/**
 * Articles service — Notion sync, the local cache and body rendering.
 *
 * Reading strategy (stale-while-revalidate):
 * - the article list lives in SQLite and is refreshed from Notion when it is
 *   older than SYNC_TTL_SECONDS, in the background, so visitors never wait;
 * - the very first request after a deploy waits for one sync;
 * - bodies are fetched and rendered on first view and cached until the page's
 *   `last_edited_time` changes. If Notion is unreachable, the last rendered
 *   body is served instead of an error.
 *
 * While Notion is not configured the built-in demo articles are served.
 */
import { renderBlocks, type LinkedPage, type RenderResult } from '../../core/blocks.ts';
import { conflict, notFound, unavailable } from '../../core/errors.ts';
import { newestFirst } from '../../core/order.ts';
import { demoArticles } from '../../content/site.ts';
import type { ArticleLink } from '../../shared/contracts.ts';
import { articlePath, notionMediaPath } from '../../shared/routes.ts';
import { config } from '../config.ts';
import { articlesRepository, type ArticleBody, type ArticleRow } from '../db/articles.repository.ts';
import { transaction } from '../db/connection.ts';
import { metaRepository } from '../db/meta.repository.ts';
import { NotionClient } from '../notion/client.ts';
import { toArticles } from '../notion/mapper.ts';
import { fetchBlockTree } from '../notion/tree.ts';
import { clearMedia, removeMedia } from '../storage/notion-media.ts';
import { notionConfig, notionGeneration, notionReady, onNotionChange } from './settings.ts';

const compact = (id: string) => id.replace(/-/g, '').toLowerCase();

/* ── Notion access ──────────────────────────────────────────────────── */

export function notion(): { client: NotionClient; databaseId: string } {
  const { token, databaseId } = notionConfig();
  if (!token || !databaseId) throw unavailable('Notion is not configured (NOTION_TOKEN and NOTION_DATABASE_ID)');
  return { client: new NotionClient(token), databaseId };
}

/* ── Sync ───────────────────────────────────────────────────────────── */

let mediaCleanup: Promise<void> = Promise.resolve();
let inFlight: { generation: string; promise: Promise<number> } | null = null;

const changed = () => conflict('Notion settings changed during the operation; please retry');
export const assertGeneration = (expected: string) => {
  if (expected !== notionGeneration()) throw changed();
};

export function syncState() {
  notionGeneration(); // reconcile the effective source before reporting or serving cache
  return {
    syncedAt: Number(metaRepository.get('synced') ?? 0) || 0,
    syncing: Boolean(inFlight),
    syncError: metaRepository.get('sync_error') ?? null,
  };
}

/**
 * Pull the database and replace the local article list. Concurrent callers
 * share one run. `full` also drops every cached body and media file.
 */
export function syncArticles(options: { full?: boolean } = {}): Promise<number> {
  if (inFlight) {
    if (inFlight.generation === notionGeneration()) return inFlight.promise;
    // Wait for the old task and its disk cleanup to finish before starting a
    // new sync. Never join a task for different credentials or database.
    return inFlight.promise.catch(() => undefined).then(() => syncArticles(options));
  }
  const current = notionGeneration();
  // The microtask ensures inFlight is installed before any synchronous error.
  const promise = Promise.resolve().then(async () => {
    try {
      await mediaCleanup;
      assertGeneration(current);
      const { client, databaseId } = notion();
      const pages = await client.queryDatabase(databaseId);
      assertGeneration(current);
      // Record fallback dates only inside the generation-checked transaction;
      // a sync from an old database must not write after a settings switch.
      const { mapped, stale } = transaction(() => {
        assertGeneration(current);
        const mapped = toArticles(pages, Date.now(), (pageId, today) => articlesRepository.firstPublicationDate(databaseId, pageId, today));
        const stale = articlesRepository.replaceAll(mapped.rows, mapped.covers, { dropBodies: options.full });
        return { mapped, stale };
      });
      if (options.full) await clearMedia(current);
      else await removeMedia(stale, current);
      transaction(() => {
        assertGeneration(current);
        metaRepository.set('synced', String(Date.now()));
        metaRepository.remove('sync_error');
      });
      return mapped.rows.length;
    } catch (error) {
      transaction(() => {
        assertGeneration(current);
        metaRepository.set('sync_error', error instanceof Error ? error.message : String(error));
      });
      throw error;
    } finally {
      inFlight = null;
    }
  });
  inFlight = { generation: current, promise };
  return promise;
}

/** Make sure the cache is usable; refresh it in the background when stale. */
export async function ensureFresh(): Promise<void> {
  if (!notionReady()) return;
  const { syncedAt } = syncState();
  if (!syncedAt) {
    // First request after deploy: wait, but fall back to whatever is cached.
    await syncArticles().catch((error) => console.error('[sync]', error instanceof Error ? error.message : error));
    return;
  }
  if (Date.now() - syncedAt > config.syncTtlMs()) {
    void syncArticles().catch((error) => console.error('[sync] background', error instanceof Error ? error.message : error));
  }
}

// New credentials or database: forget the old articles and their files.
onNotionChange((previousGeneration) => {
  mediaCleanup = mediaCleanup.then(() => clearMedia(previousGeneration)).catch((error) => {
    console.error('[media] cleanup after settings change', error);
  });
});

/* ── Reading ────────────────────────────────────────────────────────── */

const demoRows = (): ArticleRow[] =>
  demoArticles
    .map(({ blocks: _blocks, ...article }) => ({ ...article, created: article.date, cover: null, updated: `${article.date}T00:00:00.000Z` }))
    .sort(newestFirst);

export const isDemo = () => !notionReady();

/** Every visible article, newest first. */
export async function listArticles(): Promise<ArticleRow[]> {
  if (isDemo()) return demoRows();
  await ensureFresh();
  return articlesRepository.all();
}

export async function findArticle(slug: string): Promise<ArticleRow | undefined> {
  if (isDemo()) return demoRows().find((article) => article.slug === slug);
  await ensureFresh();
  return articlesRepository.bySlug(slug);
}

export async function requireArticle(slug: string): Promise<ArticleRow> {
  const article = await findArticle(slug);
  if (!article) throw notFound('article not found', { slug });
  return article;
}

/** Articles with a positive Rank, highest first (the old blog's "featured"). */
export const featuredArticles = (articles: ArticleRow[], limit = 10) =>
  articles.filter((article) => article.rank > 0).sort((a, b) => b.rank - a.rank || newestFirst(a, b)).slice(0, limit);

const link = (article: ArticleRow | undefined): ArticleLink | null =>
  article ? { slug: article.slug, title: article.title, href: articlePath(article.slug) } : null;

/** `previous` = newer, `next` = older (lists are newest first). */
export function neighbours(articles: ArticleRow[], article: ArticleRow) {
  const index = articles.findIndex((candidate) => candidate.id === article.id);
  if (index < 0) return { previous: null, next: null };
  return { previous: link(articles[index - 1]), next: link(articles[index + 1]) };
}

/* ── Bodies ─────────────────────────────────────────────────────────── */

const pageResolver = (articles: ArticleRow[]) => {
  const byId = new Map(articles.map((article) => [compact(article.id), article]));
  return (id: string): LinkedPage | null => {
    const article = byId.get(compact(id));
    return article ? { href: articlePath(article.slug), title: article.title } : null;
  };
};

const toBody = (result: RenderResult, updated: string): ArticleBody => ({ html: result.html, text: result.text, toc: result.toc, updated });

// Notion revisions do not change when the site's renderer changes. Old HTML
// is refreshed on demand, but remains available if Notion is offline. Version 3
// also re-fetches bodies cached by the old, potentially truncated tree walk.
const BODY_RENDERER_VERSION = 3;

const rendering = new Map<string, { generation: string; promise: Promise<ArticleBody> }>();

/**
 * Rendered body of an article. `refresh` (admin only) ignores the cache.
 * Visitors are served the cached copy; Notion is asked only on a miss.
 */
export async function articleBody(article: ArticleRow, options: { refresh?: boolean } = {}): Promise<ArticleBody> {
  if (isDemo()) {
    const demo = demoArticles.find((candidate) => candidate.id === article.id);
    return toBody(renderBlocks(demo?.blocks ?? [], { page: pageResolver(demoRows()) }), article.updated);
  }

  const bodyGeneration = notionGeneration();
  const latestForBody = articlesRepository.byId(article.id);
  if (!latestForBody || latestForBody.updated !== article.updated) throw conflict('Article changed during rendering; please retry');
  if (!options.refresh) {
    const cached = articlesRepository.body(article.id, { rendererVersion: BODY_RENDERER_VERSION });
    if (cached) return cached;
  }

  const current = bodyGeneration;
  const pending = rendering.get(article.id);
  if (pending?.generation === current) return pending.promise;

  const job = (async () => {
    try {
      const { client } = notion();
      const blocks = await fetchBlockTree(client, article.id);
      return transaction(() => {
        assertGeneration(current);
        const latest = articlesRepository.byId(article.id);
        if (!latest || latest.updated !== article.updated) throw conflict('Article changed during rendering; please retry');
        const result = renderBlocks(blocks, {
          fileUrl: (blockId) => notionMediaPath(blockId),
          page: pageResolver(articlesRepository.all()),
        });
        articlesRepository.registerMedia(article.id, result.files.map(compact));
        const body = toBody(result, article.updated);
        articlesRepository.saveBody(article.id, body, BODY_RENDERER_VERSION);
        return body;
      });
    } catch (error) {
      assertGeneration(current);
      const latest = articlesRepository.byId(article.id);
      if (!latest || latest.updated !== article.updated) throw error;
      const stale = articlesRepository.body(article.id, { allowStale: true });
      if (stale) {
        console.error('[body] serving stale copy of', article.slug, error instanceof Error ? error.message : error);
        return stale;
      }
      throw error;
    } finally {
      if (rendering.get(article.id)?.generation === current) rendering.delete(article.id);
    }
  })();
  rendering.set(article.id, { generation: current, promise: job });
  return job;
}

/** Fetch and cache every body that is missing or outdated (admin "sync + bodies"). */
export async function warmBodies(): Promise<number> {
  if (isDemo()) return 0;
  let rendered = 0;
  for (const article of articlesRepository.all()) {
    if (articlesRepository.body(article.id, { rendererVersion: BODY_RENDERER_VERSION })) continue;
    await articleBody(article);
    rendered += 1;
  }
  return rendered;
}
