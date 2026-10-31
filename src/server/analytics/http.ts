/** Plain Request → Response analytics API, shared by Astro and Netlify. */
import { analyticsCsv, analyticsRange, analyticsSummary, pageviewFrom, shiftUtcDay, utcDay } from '../../core/analytics.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import type { AnalyticsClearResponse, AnalyticsSettingsResponse, AnalyticsSummaryResponse } from '../../shared/contracts.ts';
import { NO_STORE, errorResponse, readJson } from '../http/respond.ts';
import type { AnalyticsStore } from './store.ts';

const ROOT = '/api/analytics';
const MAX_BODY = 2 * 1024;
const noStore = (data: unknown) => Response.json(data, { headers: { ...NO_STORE } });
const empty = () => new Response(null, { status: 204, headers: { ...NO_STORE } });

export interface AnalyticsHttpOptions {
  store: AnalyticsStore;
  requireAdmin: (request: Request) => void;
  siteOrigin?: string | null;
  now?: () => Date;
}

function sameSite(request: Request, siteOrigin?: string | null) {
  const url = new URL(request.url);
  const allowed = new Set([url.origin, siteOrigin].filter(Boolean));
  // Astro can construct request.url from the canonical SITE_URL while the
  // browser is on the actual Host (local preview or a reverse proxy). Host is
  // the connection's own authority; forwarded host headers are not consulted.
  const host = request.headers.get('host');
  if (host) {
    try {
      // The canonical URL may be HTTPS while a local/proxy request is HTTP;
      // the authority still has to be the connection's own Host.
      for (const protocol of ['http:', 'https:']) allowed.add(new URL(`${protocol}//${host}`).origin);
    } catch { /* invalid Host stays rejected */ }
  }
  const origin = request.headers.get('origin');
  if (origin && !allowed.has(origin)) throw forbidden('cross-site request refused');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) throw forbidden('cross-site request refused');
}

async function jsonBody(request: Request, siteOrigin?: string | null) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) throw badRequest('send JSON (Content-Type: application/json)');
  sameSite(request, siteOrigin);
  return readJson(request, MAX_BODY);
}

function range(url: URL) {
  const days = analyticsRange(url.searchParams.get('days'));
  if (!days) throw badRequest('days must be 7, 30 or 90');
  return days;
}

export async function handleAnalyticsRequest(request: Request, options: AnalyticsHttpOptions): Promise<Response> {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  try {
    const url = new URL(request.url);
    if (url.pathname !== ROOT && !url.pathname.startsWith(`${ROOT}/`)) throw notFound();
    const route = url.pathname.slice(ROOT.length).replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (route === '/collect' && method === 'POST') {
      // Global Privacy Control / Do Not Track wins over the owner's setting.
      if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return empty();
      const view = pageviewFrom(await jsonBody(request, options.siteOrigin));
      if (!view) throw badRequest('invalid public pageview');
      await store.record(utcDay(now()), view);
      return empty();
    }

    if (route.startsWith('/admin/')) {
      options.requireAdmin(request);
      if (route === '/admin/summary' && method === 'GET') {
        const days = range(url);
        const today = utcDay(now());
        const from = shiftUtcDay(today, -(days - 1));
        const enabled = await store.isEnabled();
        const body: AnalyticsSummaryResponse = analyticsSummary({ days: await store.read(from, today), rangeDays: days, today, enabled, storage: store.kind });
        return noStore(body);
      }
      if (route === '/admin/settings' && method === 'PATCH') {
        const body = await jsonBody(request, options.siteOrigin);
        if (typeof body.enabled !== 'boolean') throw badRequest('enabled must be a boolean');
        await store.setEnabled(body.enabled);
        return noStore({ enabled: body.enabled } satisfies AnalyticsSettingsResponse);
      }
      if (route === '/admin/data' && method === 'DELETE') {
        sameSite(request, options.siteOrigin);
        await store.clear();
        return noStore({ cleared: true } satisfies AnalyticsClearResponse);
      }
      if (route === '/admin/export' && method === 'GET') {
        const days = range(url);
        const today = utcDay(now());
        const from = shiftUtcDay(today, -(days - 1));
        const csv = analyticsCsv(await store.read(from, today));
        return new Response(`\ufeff${csv}`, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="pageviews-${today}-${days}d.csv"`,
            'X-Content-Type-Options': 'nosniff', ...NO_STORE,
          },
        });
      }
    }
    throw notFound('no such analytics endpoint');
  } catch (error) {
    return errorResponse(error);
  }
}
