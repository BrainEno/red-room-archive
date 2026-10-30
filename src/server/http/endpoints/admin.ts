/**
 * Admin endpoints: login, settings, sync and the Notion schema check.
 * Every handler except `authStatus` requires `Authorization: Bearer <ADMIN_TOKEN>`.
 * The site never writes to Notion — edit content there.
 */
import { badRequest } from '../../../core/errors.ts';
import type {
  AuthResponse,
  AuthStatusResponse,
  NotionSchemaResponse,
  SettingsResponse,
  SyncResponse,
  SyncStatusResponse,
} from '../../../shared/contracts.ts';
import { describeSchema } from '../../notion/mapper.ts';
import { notion, syncArticles, warmBodies } from '../../services/articles.ts';
import { adminToken, authenticate, requestPeer, requireAdmin } from '../../services/auth.ts';
import { contentBundle } from '../../services/bundle.ts';
import { adminSettings, importSiteProfile, notionReady, updateSettings } from '../../services/settings.ts';
import { syncStatus } from '../../services/status.ts';
import { NO_STORE, json, readJson, route, truthy } from '../respond.ts';

/* ── Auth ───────────────────────────────────────────────────────────── */

/** GET /api/auth — is an admin token configured? (never reveals the token) */
export const authStatus = route(() => json<AuthStatusResponse>({ configured: Boolean(adminToken()) }, { headers: NO_STORE }));

/** POST /api/auth { token } — validate a token for the admin login form. */
export const login = route(async (context) => {
  const { token } = await readJson(context.request);
  authenticate(context.request, token, requestPeer(context));
  return json<AuthResponse>({ ok: true }, { headers: NO_STORE });
});

/* ── Settings ───────────────────────────────────────────────────────── */

const settingsBody = (): SettingsResponse => ({ ...adminSettings(), status: syncStatus() });

/** GET /api/settings */
export const readSettings = route((context) => {
  requireAdmin(context.request, requestPeer(context));
  return json(settingsBody(), { headers: NO_STORE });
});

/**
 * PATCH /api/settings (PUT = alias) — partial update.
 * Empty string clears an override; a masked/empty NOTION_TOKEN keeps the stored one.
 */
export const writeSettings = route(async (context) => {
  requireAdmin(context.request, requestPeer(context));
  updateSettings(await readJson(context.request));
  return json(settingsBody(), { headers: NO_STORE });
});

/** POST /api/settings/profile — replace only the explicitly public fields. */
export const writeSiteProfile = route(async (context) => {
  requireAdmin(context.request, requestPeer(context));
  importSiteProfile(await readJson(context.request));
  return json(settingsBody(), { headers: NO_STORE });
});

/**
 * GET /api/content-bundle — ZIP of the admin-edited content (site profile,
 * More page, its uploads and the statue model) for static builds.
 */
export const downloadContentBundle = route((context) => {
  requireAdmin(context.request, requestPeer(context));
  const bundle = contentBundle();
  return new Response(bundle.stream(), {
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${bundle.filename}"`,
      'X-Bundle-Uploads': String(bundle.uploads.length),
    },
  });
});

/* ── Sync ───────────────────────────────────────────────────────────── */

/** GET /api/sync — last sync time, in-flight flag, last error, cache counts. */
export const readSync = route((context) => {
  requireAdmin(context.request, requestPeer(context));
  return json<SyncStatusResponse>({ status: syncStatus() }, { headers: NO_STORE });
});

/**
 * POST /api/sync — pull the Notion database now.
 *   ?full=1    also drop every cached body and media file
 *   ?bodies=1  then fetch every missing body (slower; makes search cover full text)
 */
export const runSync = route(async (context) => {
  requireAdmin(context.request, requestPeer(context));
  if (!notionReady()) throw badRequest('Notion is not configured (NOTION_TOKEN and NOTION_DATABASE_ID)');
  const synced = await syncArticles({ full: truthy(context.url.searchParams.get('full')) });
  const bodies = truthy(context.url.searchParams.get('bodies')) ? await warmBodies() : 0;
  return json<SyncResponse>({ ok: true, synced, bodies, status: syncStatus() }, { headers: NO_STORE });
});

/* ── Notion schema ──────────────────────────────────────────────────── */

/** GET /api/notion/schema — the database's columns and how they map to article fields. */
export const notionSchema = route(async (context) => {
  requireAdmin(context.request, requestPeer(context));
  if (!notionReady()) throw badRequest('Notion is not configured (NOTION_TOKEN and NOTION_DATABASE_ID)');
  const { client, databaseId } = notion();
  return json<NotionSchemaResponse>(describeSchema(databaseId, await client.database(databaseId)), { headers: NO_STORE });
});
