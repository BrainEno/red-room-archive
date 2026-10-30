/**
 * Bookmark previews: the title, description and site name a bookmarked page
 * declares about itself, shown on the bookmark card.
 *
 * Fetched only while an article body is (re)rendered — never per visitor —
 * through net/safe-fetch.ts, and cached in SQLite: good previews for 14 days,
 * failures retried after a day (a failed refresh keeps the last good copy).
 * Rendering waits at most PREVIEW_BUDGET_MS in total; whatever is not known
 * by then is rendered as the plain card and picked up next time.
 * No images are fetched or hot-linked: visitors' browsers never contact the
 * bookmarked sites until they click.
 */
import type { LinkPreview } from '../../core/blocks.ts';
import { htmlCharset, parseLinkPreview } from '../../core/link-meta.ts';
import { config } from '../config.ts';
import { linkPreviewsRepository, type LinkPreviewRow } from '../db/link-previews.repository.ts';
import { BlockedUrlError, fetchPublicHtml, type SafeFetchOptions } from '../net/safe-fetch.ts';

const DAY = 24 * 60 * 60 * 1000;
const FRESH_MS = 14 * DAY;
const RETRY_MS = DAY;
const PREVIEW_BUDGET_MS = 6000;
const CONCURRENCY = 4;
const MAX_PER_ARTICLE = 40;

type Fetcher = (url: string) => Promise<LinkPreview | null>;
let fetcher: Fetcher = (url) => fetchLinkPreview(url);
/** Tests only: replace the network fetch (null restores it). */
export const setLinkPreviewFetcher = (next: Fetcher | null) => {
  fetcher = next ?? ((url) => fetchLinkPreview(url));
};

const decode = (body: Buffer, contentType: string) => {
  const head = body.subarray(0, 4096).toString('latin1');
  try {
    return new TextDecoder(htmlCharset(contentType, head)).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
};

/** Fetch and parse one page; null when it is unreachable, blocked or names no title. */
export async function fetchLinkPreview(url: string, options: SafeFetchOptions = {}): Promise<LinkPreview | null> {
  try {
    const page = await fetchPublicHtml(url, options);
    return page ? parseLinkPreview(decode(page.body, page.contentType)) : null;
  } catch (error) {
    if (!(error instanceof BlockedUrlError)) console.warn('[link-preview]', url, error instanceof Error ? error.message : error);
    return null;
  }
}

const toPreview = (row: LinkPreviewRow): LinkPreview | null => (row.ok && row.title ? { title: row.title, description: row.description, site: row.site } : null);

const pending = new Map<string, Promise<void>>();

function refresh(url: string, previous: LinkPreviewRow | undefined): Promise<void> {
  const running = pending.get(url);
  if (running) return running;
  const job = fetcher(url)
    .then((preview) => {
      const now = Date.now();
      if (preview) linkPreviewsRepository.save({ url, ...preview, ok: 1, fetched_at: now });
      else if (previous?.ok) linkPreviewsRepository.touch(url, now - FRESH_MS + RETRY_MS);
      else linkPreviewsRepository.save({ url, title: '', description: '', site: '', ok: 0, fetched_at: now });
    })
    .catch(() => undefined)
    .finally(() => pending.delete(url));
  pending.set(url, job);
  return job;
}

/**
 * Previews for the given URLs: cached ones immediately, missing or expired
 * ones fetched (bounded by time and concurrency) before returning.
 */
export async function linkPreviews(urls: string[]): Promise<Map<string, LinkPreview>> {
  const wanted = [...new Set(urls)].slice(0, MAX_PER_ARTICLE);
  const result = new Map<string, LinkPreview>();
  if (!wanted.length || !config.linkPreviews()) return result;

  const now = Date.now();
  const rows = new Map(linkPreviewsRepository.many(wanted).map((row) => [row.url, row]));
  const stale = wanted.filter((url) => {
    const row = rows.get(url);
    return !row || now - row.fetched_at > (row.ok ? FRESH_MS : RETRY_MS);
  });

  if (stale.length) {
    const queue = [...stale];
    const worker = async () => {
      for (let url = queue.shift(); url; url = queue.shift()) await refresh(url, rows.get(url));
    };
    const workers = Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([workers, new Promise<void>((resolve) => (timer = setTimeout(resolve, PREVIEW_BUDGET_MS)))]);
    clearTimeout(timer);
  }

  for (const row of linkPreviewsRepository.many(wanted)) {
    const preview = toPreview(row);
    if (preview) result.set(row.url, preview);
  }
  return result;
}
