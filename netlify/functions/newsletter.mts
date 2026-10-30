/**
 * Netlify Function for the static deployment: serves /api/newsletter/* next
 * to the published `static-dist/` (which has no server of its own).
 *
 * - Storage: Netlify Blobs (one encrypted document; see src/server/newsletter/netlify.ts).
 * - Secrets (NEWSLETTER_*, ADMIN_TOKEN) are read from the Functions runtime
 *   environment and never reach the browser or the static files.
 * - `rateLimit` is Netlify's platform limit (available on all plans) in front
 *   of the application's own per-client and per-address limits.
 */
import { getStore } from '@netlify/blobs';
import { handleNewsletterRequest } from '../../src/server/newsletter/http.ts';
import { BLOB_STORE_NAME, netlifyNewsletterService } from '../../src/server/newsletter/netlify.ts';
import { newsletterConfig } from '../../src/server/newsletter/config.ts';
import { requireAdminFrom } from '../../src/server/services/auth.ts';

interface NetlifyContext {
  ip?: string;
  deploy?: { context?: string };
}

export default async (request: Request, context: NetlifyContext) => {
  const ip = context.ip || 'unknown';
  let store;
  try {
    store = getStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
  } catch (error) {
    // Blobs is provided by the Netlify runtime; without it nothing can be stored, so say so.
    console.error('[newsletter] Netlify Blobs unavailable:', (error as Error).name);
    return Response.json({ error: 'Newsletter storage is unavailable. Nothing was saved.', code: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return handleNewsletterRequest(request, {
    service: netlifyNewsletterService(store, context.deploy?.context),
    // Netlify sets context.ip from the connection; it is not a client-supplied header.
    client: { ip, shared: ip === 'unknown' },
    requireAdmin: (req) => requireAdminFrom(req, ip),
    siteOrigin: newsletterConfig().siteUrl,
  });
};

export const config = {
  path: ['/api/newsletter', '/api/newsletter/*'],
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
