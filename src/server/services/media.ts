/**
 * Notion media proxy: `/media/notion/<id>` → a locally cached copy of a
 * Notion-hosted image or file.
 *
 * Only ids recorded while rendering a *published* article (or its cover) are
 * served, so the endpoint cannot be used to read arbitrary workspace files.
 * On a cache miss the block/page is fetched again for a fresh signed URL —
 * the URL inside an old body would long have expired.
 */
import { notFound, upstreamError } from '../../core/errors.ts';
import { articlesRepository } from '../db/articles.repository.ts';
import { coverSource } from '../notion/mapper.ts';
import { readCached, store, type CachedMedia } from '../storage/notion-media.ts';
import { assertGeneration, notion } from './articles.ts';
import { notionGeneration } from './settings.ts';

const ID = /^[0-9a-f]{32}$/;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const dashed = (id: string) => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;

async function freshUrl(entry: { id: string; articleId: string; kind: 'block' | 'cover' }): Promise<string> {
  const { client } = notion();
  if (entry.kind === 'cover') {
    const source = coverSource(await client.page(entry.articleId));
    if (source?.kind === 'file') return source.url;
  } else {
    const block = await client.block(dashed(entry.id));
    const data = (block[block.type] ?? {}) as { type?: string; file?: { url?: string } };
    if (data.type === 'file' && data.file?.url) return data.file.url;
  }
  throw notFound('media no longer exists in Notion');
}

const pending = new Map<string, Promise<CachedMedia>>();

export async function notionMedia(rawId: string): Promise<CachedMedia> {
  const id = String(rawId ?? '').toLowerCase().replace(/-/g, '');
  if (!ID.test(id)) throw notFound();
  const generation = notionGeneration();
  const entry = articlesRepository.media(id);
  const article = entry && articlesRepository.byId(entry.articleId);
  if (!entry || !article) throw notFound();

  const validate = () => {
    assertGeneration(generation);
    const currentEntry = articlesRepository.media(id);
    const currentArticle = currentEntry && articlesRepository.byId(currentEntry.articleId);
    if (!currentEntry || currentEntry.articleId !== entry.articleId || currentEntry.kind !== entry.kind ||
        !currentArticle || currentArticle.updated !== article.updated) throw notFound('media is no longer published');
  };
  const cached = await readCached(id, generation);
  validate();
  if (cached && cached.revision === article.updated) return cached;

  const key = `${generation}:${id}`;
  const running = pending.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      const url = await freshUrl(entry);
      validate();
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      } catch (error) {
        console.error('[media] download failed', id, error);
        throw upstreamError('could not download the file from Notion');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw upstreamError(`Notion file storage answered ${response.status}`);
      }
      try {
        validate();
      } catch (error) {
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
      const file = await store(id, response, article.updated, generation, validate);
      validate();
      return file;
    } catch (error) {
      // Never use a stale fallback after authorization or configuration changes.
      validate();
      if (cached) return cached;
      throw error;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}
