/** Pageview API for the static deployment. No raw visitor events are stored. */
import { getStore } from '@netlify/blobs';
import { handleAnalyticsRequest } from '../../src/server/analytics/http.ts';
import { ANALYTICS_BLOB_STORE, netlifyAnalyticsStore } from '../../src/server/analytics/netlify.ts';
import { newsletterConfig } from '../../src/server/newsletter/config.ts';
import { requireAdminFrom } from '../../src/server/services/auth.ts';

interface NetlifyContext { ip?: string; deploy?: { context?: string } }

export default async (request: Request, context: NetlifyContext) => {
  const ip = context.ip || 'unknown';
  let store;
  try {
    store = getStore({ name: ANALYTICS_BLOB_STORE, consistency: 'strong' });
  } catch (error) {
    console.error('[analytics] Netlify Blobs unavailable:', (error as Error).name);
    return Response.json({ error: 'Analytics storage is unavailable. Nothing was saved.', code: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return handleAnalyticsRequest(request, {
    store: netlifyAnalyticsStore(store, context.deploy?.context),
    requireAdmin: (req) => requireAdminFrom(req, ip),
    siteOrigin: newsletterConfig().siteUrl,
  });
};

export const config = {
  path: ['/api/analytics', '/api/analytics/*'],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
