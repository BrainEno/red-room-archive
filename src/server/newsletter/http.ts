/**
 * The newsletter's HTTP surface as a plain `Request → Response` function, so
 * the Node server (Astro endpoint) and the static deployment (Netlify
 * Function) answer every route identically. Errors use the shared contract
 * shape (`errorResponse`).
 *
 *   GET  /api/newsletter/status                  public  { enabled }
 *   POST /api/newsletter/subscribe               public  JSON { email, locale?, source?, website? }
 *   POST /api/newsletter/confirm                 public  JSON { token }
 *   POST /api/newsletter/unsubscribe             public  JSON { token }  — the unsubscribe page
 *   POST /api/newsletter/unsubscribe?token=…     public  RFC 8058 one-click (form body)
 *   GET  /api/newsletter/unsubscribe?token=…     public  303 → the unsubscribe page (no change)
 *   GET  /api/newsletter/admin/subscribers       admin   ?q=&status=&limit=&offset=
 *   GET  /api/newsletter/admin/export            admin   CSV (?q=&status=)
 *   POST /api/newsletter/admin/subscribers/:id/resend   admin
 *
 * CSRF: the public JSON routes require `Content-Type: application/json`
 * (a cross-site form cannot send it without a CORS preflight, which is never
 * granted) and reject a foreign `Origin` / `Sec-Fetch-Site`. Admin routes
 * need the bearer token. The one-click route is authenticated by its token.
 */
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import { NEWSLETTER_UNSUBSCRIBE_PATH } from '../../shared/routes.ts';
import { NO_STORE, errorResponse, readJson, readLimited } from '../http/respond.ts';
import type { ClientInfo, NewsletterService } from '../services/newsletter.ts';

export interface NewsletterHttpOptions {
  service: NewsletterService;
  client: ClientInfo;
  /** Throws AppError (401/429/503) unless the request carries the admin token. */
  requireAdmin: (request: Request) => void;
  /** Public origin from SITE_URL, accepted as a same-site Origin besides the request's own. */
  siteOrigin?: string | null;
}

const MAX_BODY = 4 * 1024;
const ROOT = '/api/newsletter';

const noStore = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...NO_STORE } });

function sameSite(request: Request, siteOrigin?: string | null) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== siteOrigin) throw forbidden('cross-site request refused');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) throw forbidden('cross-site request refused');
}

async function jsonBody(request: Request, siteOrigin?: string | null) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) throw badRequest('send JSON (Content-Type: application/json)');
  sameSite(request, siteOrigin);
  return readJson(request, MAX_BODY);
}

/** RFC 8058: the body of a one-click POST is exactly `List-Unsubscribe=One-Click`. */
async function isOneClick(request: Request) {
  const type = request.headers.get('content-type') ?? '';
  const text = new TextDecoder().decode(await readLimited(request, MAX_BODY));
  if (/^multipart\/form-data/i.test(type)) return /name="List-Unsubscribe"\s+One-Click/i.test(text);
  return new URLSearchParams(text).get('List-Unsubscribe') === 'One-Click';
}

export async function handleNewsletterRequest(request: Request, options: NewsletterHttpOptions): Promise<Response> {
  const { service, siteOrigin } = options;
  try {
    const url = new URL(request.url);
    if (url.pathname !== ROOT && !url.pathname.startsWith(`${ROOT}/`)) throw notFound();
    const route = url.pathname.slice(ROOT.length).replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (route === '/status' && (method === 'GET' || method === 'HEAD')) return noStore(service.availability());

    if (route === '/subscribe' && method === 'POST') {
      const body = await jsonBody(request, siteOrigin);
      return noStore(await service.subscribe(body, options.client), 202);
    }

    if (route === '/confirm' && method === 'POST') {
      const body = await jsonBody(request, siteOrigin);
      return noStore(await service.confirm(body.token));
    }

    if (route === '/unsubscribe') {
      const token = url.searchParams.get('token');
      if (method === 'GET') {
        // Some mail clients open the List-Unsubscribe URL in a browser. Never act on a GET
        // (link scanners prefetch); hand the token to the page, which asks for a click.
        const target = `${NEWSLETTER_UNSUBSCRIBE_PATH}${token ? `#token=${encodeURIComponent(token)}` : ''}`;
        return new Response(null, { status: 303, headers: { Location: target, ...NO_STORE, 'Referrer-Policy': 'no-referrer' } });
      }
      if (method === 'POST') {
        if (token) {
          if (!(await isOneClick(request))) throw badRequest('one-click unsubscribe expects List-Unsubscribe=One-Click');
          return noStore(await service.unsubscribe(token));
        }
        const body = await jsonBody(request, siteOrigin);
        return noStore(await service.unsubscribe(body.token));
      }
    }

    if (route.startsWith('/admin/')) {
      options.requireAdmin(request);
      if (route === '/admin/subscribers' && method === 'GET') {
        return noStore(await service.list({
          q: url.searchParams.get('q'), status: url.searchParams.get('status'),
          limit: Number(url.searchParams.get('limit')) || undefined, offset: Number(url.searchParams.get('offset')) || undefined,
        }));
      }
      if (route === '/admin/export' && method === 'GET') {
        const { filename, csv } = await service.exportCsv({ q: url.searchParams.get('q'), status: url.searchParams.get('status') });
        // UTF-8 BOM: spreadsheet apps otherwise misread non-ASCII addresses and names.
        return new Response(`\ufeff${csv}`, {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff', ...NO_STORE },
        });
      }
      const resend = /^\/admin\/subscribers\/(\d{1,12})\/resend$/.exec(route);
      if (resend && method === 'POST') return noStore(await service.resend(Number(resend[1])));
    }

    throw notFound('no such newsletter endpoint');
  } catch (error) {
    return errorResponse(error);
  }
}
