/**
 * The /more page.
 *
 *   GET    /api/more?lang=         public, one language (same data the page renders)
 *   GET    /api/more/document      admin: the bilingual document + whether it was saved
 *   PUT    /api/more/document      admin: replace it (validated, see core/more.ts)
 *   DELETE /api/more/document      admin: forget it → back to content/more.ts
 */
import type { MoreDocumentResponse, MoreResponse } from '../../../shared/contracts.ts';
import { DEFAULT_LOCALE, parseLocale } from '../../../shared/i18n.ts';
import { config } from '../../config.ts';
import { requestPeer, requireAdmin } from '../../services/auth.ts';
import { moreDocument, moreFor, resetMore, saveMore } from '../../services/more.ts';
import { NO_STORE, json, publicCache, readJson, route } from '../respond.ts';

/**
 * Long excerpts in two languages outgrow the default JSON cap: the field limits
 * (60 books × 20 000 characters per language, CJK = 3 bytes) allow ~5 MB.
 * Admin-only, so a larger body is fine.
 */
const MAX_DOCUMENT_BYTES = () => Math.max(config.maxJsonBytes(), 8 * 1024 * 1024);

export const publicMore = route((context) => {
  const locale = parseLocale(context.url.searchParams.get('lang')) ?? DEFAULT_LOCALE;
  return json<MoreResponse>(moreFor(locale), { headers: publicCache(60) });
});

export const readMoreDocument = route((context) => {
  requireAdmin(context.request, requestPeer(context));
  return json<MoreDocumentResponse>(moreDocument(), { headers: NO_STORE });
});

export const writeMoreDocument = route(async (context) => {
  requireAdmin(context.request, requestPeer(context));
  const body = await readJson(context.request, MAX_DOCUMENT_BYTES());
  return json<MoreDocumentResponse>(saveMore(body), { headers: NO_STORE });
});

export const resetMoreDocument = route((context) => {
  requireAdmin(context.request, requestPeer(context));
  return json<MoreDocumentResponse>(resetMore(), { headers: NO_STORE });
});
