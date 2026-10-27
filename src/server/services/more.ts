/**
 * The /more page: the document saved in /admin → More, or the built-in
 * samples from content/more.ts until something is saved.
 *
 * Every write goes through core/more.ts → normalizeMoreDocument, so the stored
 * JSON is always valid. Notion syncs and credential changes never touch it.
 */
import { localizeMore, normalizeMoreDocument, referencedUploads, replaceUpload } from '../../core/more.ts';
import { more as samples } from '../../content/more.ts';
import type { MoreDocument, MoreDocumentResponse, MoreResponse } from '../../shared/contracts.ts';
import type { Locale } from '../../shared/i18n.ts';
import { moreRepository } from '../db/more.repository.ts';

/** content/more.ts as a document, with stable ids so the editor can track rows. */
function sampleDocument(): MoreDocument {
  return normalizeMoreDocument({
    ...samples,
    publications: samples.publications.map((item, index) => ({ ...item, id: `sample-pub-${index + 1}` })),
    channels: samples.channels.map((item, index) => ({ ...item, id: `sample-ch-${index + 1}` })),
  });
}

let cached: MoreDocumentResponse | null = null;

/** Drop the in-process copy (after writes, and in tests). */
export const invalidateMoreCache = () => {
  cached = null;
};

/** The document the page currently shows, plus whether it was saved in /admin. */
export function moreDocument(): MoreDocumentResponse {
  if (cached) return cached;
  const row = moreRepository.get();
  if (row) {
    try {
      cached = { document: normalizeMoreDocument(JSON.parse(row.doc)), custom: true, updated: row.updated };
      return cached;
    } catch (error) {
      // Only reachable if the row was edited by hand; keep the page up.
      console.error('[more] stored document is invalid, showing the built-in content:', error);
    }
  }
  cached = { document: sampleDocument(), custom: false, updated: null };
  return cached;
}

/** Validate and store a full document (replaces the previous one). */
export function saveMore(input: unknown): MoreDocumentResponse {
  const document = normalizeMoreDocument(input);
  const updated = new Date().toISOString();
  moreRepository.save(JSON.stringify(document), updated);
  cached = { document, custom: true, updated };
  return cached;
}

/** Forget the saved document; the page goes back to content/more.ts. */
export function resetMore(): MoreDocumentResponse {
  moreRepository.clear();
  invalidateMoreCache();
  return moreDocument();
}

/**
 * The page in one language. Built-in samples keep their empty QR frames so the
 * layout can be previewed; saved channels without a code show text only.
 */
export function moreFor(locale: Locale): MoreResponse {
  const { document, custom } = moreDocument();
  return localizeMore(document, locale, { placeholderQr: !custom });
}

/** Upload names the saved page uses (covers, QR codes). */
export function uploadsUsedOnMore(): Set<string> {
  const { document, custom } = moreDocument();
  return new Set(custom ? referencedUploads(document) : []);
}

/** Keep the page working after a file is renamed in /admin → Files. */
export function renameUploadOnMore(from: string, toUrl: string) {
  const { document, custom } = moreDocument();
  if (!custom) return;
  const next = replaceUpload(document, from, toUrl);
  if (next) saveMore(next);
}
