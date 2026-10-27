/**
 * Admin endpoints: login, settings, sync and Notion writes.
 * Every handler except `authStatus` requires `Authorization: Bearer <ADMIN_TOKEN>`.
 */
import type { APIContext } from 'astro';
import { badRequest } from '../../../core/errors.ts';
import type {
  AuthResponse,
  AuthStatusResponse,
  NotionSchemaResponse,
  NotionWriteResponse,
  SettingsResponse,
  SyncResponse,
  SyncStatusResponse,
} from '../../../shared/contracts.ts';
import { forgetItem, invalidateBody, notionAccess, syncAll, syncKind } from '../../services/archive.ts';
import { adminToken, authenticate, requireAdmin } from '../../services/auth.ts';
import { adminSettings, notionReady, updateSettings } from '../../services/settings.ts';
import { syncStatus } from '../../services/status.ts';
import { isPageId } from '../../notion/mapper.ts';
import { NO_STORE, created, json, param, readJson, route } from '../respond.ts';
import { requireKind } from './public.ts';

/* ── Auth ───────────────────────────────────────────────────────────── */

/** GET /api/auth — is an admin token configured? (never reveals the token) */
export const authStatus = route(() => json<AuthStatusResponse>({ configured: Boolean(adminToken()) }, { headers: NO_STORE }));

/** POST /api/auth { token } — validate a token for the admin login form. */
export const login = route(async (context) => {
  const { token } = await readJson(context.request);
  authenticate(context.request, token);
  return json<AuthResponse>({ ok: true }, { headers: NO_STORE });
});

/* ── Settings ───────────────────────────────────────────────────────── */

const settingsBody = (): SettingsResponse => ({ ...adminSettings(), status: syncStatus() });

/** GET /api/settings */
export const readSettings = route((context) => {
  requireAdmin(context.request);
  return json(settingsBody(), { headers: NO_STORE });
});

/**
 * PATCH /api/settings (PUT = alias) — partial update.
 * Empty string clears an override; a masked/empty NOTION_TOKEN keeps the stored one.
 */
export const writeSettings = route(async (context) => {
  requireAdmin(context.request);
  updateSettings(await readJson(context.request));
  return json(settingsBody(), { headers: NO_STORE });
});

/* ── Sync ───────────────────────────────────────────────────────────── */

/** GET /api/sync — last sync time, in-flight flag, last error, cache counts. */
export const readSync = route((context) => {
  requireAdmin(context.request);
  return json<SyncStatusResponse>({ status: syncStatus() }, { headers: NO_STORE });
});

/** POST /api/sync?kind= — sync now (one kind, or every configured kind). */
export const runSync = route(async (context) => {
  requireAdmin(context.request);
  const raw = context.url.searchParams.get('kind');
  const kind = raw ? requireKind(raw) : undefined;
  if (!notionReady(kind)) throw badRequest(kind ? `Notion is not configured for ${kind}` : 'Notion is not configured');
  const synced = kind ? { [kind]: await syncKind(kind) } : await syncAll();
  return json<SyncResponse>({ ok: true, synced, status: syncStatus() }, { headers: NO_STORE });
});

/* ── Notion entries ─────────────────────────────────────────────────── */

const notionKind = (context: APIContext) => {
  requireAdmin(context.request);
  const kind = requireKind(param(context, 'kind'));
  if (!notionReady(kind)) throw badRequest(`Notion is not configured for ${kind}`, { kind });
  return kind;
};

const pageId = (context: APIContext) => {
  const id = param(context, 'id');
  if (!isPageId(id)) throw badRequest('invalid Notion page id', { id });
  return id;
};

/** GET /api/notion/:kind — database columns (drives the admin form). */
export const notionSchema = route(async (context) => {
  const kind = notionKind(context);
  const fields = await notionAccess().writer.fields(kind);
  return json<NotionSchemaResponse>({ kind, fields }, { headers: NO_STORE });
});

/** POST /api/notion/:kind — create a page, then refresh that kind's cache. */
export const notionCreate = route(async (context) => {
  const kind = notionKind(context);
  const page = await notionAccess().writer.create(kind, await readJson(context.request));
  await syncKind(kind);
  return created<NotionWriteResponse>({ ok: true, id: page.id, url: page.url });
});

/**
 * PATCH /api/notion/:kind/:id — update properties; a `body` string replaces
 * the whole page content with that Markdown.
 */
export const notionUpdate = route(async (context) => {
  const kind = notionKind(context);
  const id = pageId(context);
  const fields = await readJson(context.request);
  const page = await notionAccess().writer.update(kind, id, fields);
  invalidateBody(id);
  await syncKind(kind);
  return json<NotionWriteResponse>({ ok: true, id: page.id, url: page.url, updated: true }, { headers: NO_STORE });
});

/**
 * DELETE /api/notion/:kind/:id — archive in Notion (recoverable from trash)
 * and drop the cached copy. `?purge=1` only drops the cache.
 */
export const notionArchive = route(async (context) => {
  notionKind(context);
  const id = pageId(context);
  const archive = context.url.searchParams.get('purge') !== '1';
  if (archive) await notionAccess().writer.archive(id);
  forgetItem(id);
  return json<NotionWriteResponse>({ ok: true, id, archived: archive }, { headers: NO_STORE });
});
