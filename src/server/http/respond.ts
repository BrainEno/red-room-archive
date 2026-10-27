/**
 * HTTP adapter utilities: JSON responses, request parsing, caching headers and
 * the single `route()` wrapper that converts thrown errors into the contract's
 * error body (`{ error, code, details? }`).
 *
 * Nothing in here knows about posts, Notion or uploads — that lives in
 * `server/services`. Endpoints compose the two.
 */
import type { APIContext, APIRoute } from 'astro';
import { AppError, badRequest, payloadTooLarge } from '../../core/errors.ts';
import type { ApiErrorBody } from '../../shared/contracts.ts';
import { config } from '../config.ts';

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Short public cache that CDNs may revalidate in the background. */
export const publicCache = (seconds: number): Record<string, string> => ({
  'Cache-Control': `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`,
});

export const json = <T>(data: T, init: ResponseInit = {}) => Response.json(data, init);

export const created = <T>(data: T, location?: string) =>
  Response.json(data, { status: 201, headers: { ...NO_STORE, ...(location ? { Location: location } : {}) } });

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const body: ApiErrorBody = { error: error.message, code: error.code };
    if (error.details && Object.keys(error.details).length) body.details = error.details;
    const headers: Record<string, string> = { ...NO_STORE };
    if (error.status === 401) headers['WWW-Authenticate'] = 'Bearer';
    if (error.status === 429) headers['Retry-After'] = '600';
    return Response.json(body, { status: error.status, headers });
  }
  console.error('[api] unhandled', error);
  const body: ApiErrorBody = { error: 'internal error', code: 'internal' };
  return Response.json(body, { status: 500, headers: NO_STORE });
}

/** Wrap an endpoint so every thrown error becomes a contract-shaped response. */
export function route(handler: (context: APIContext) => Response | Promise<Response>): APIRoute {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Read a JSON object body with a size cap. Empty bodies become `{}`. */
export async function readJson(request: Request, maxBytes = config.maxJsonBytes()): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes) throw payloadTooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw payloadTooLarge();
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest('invalid JSON body');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw badRequest('JSON body must be an object');
  return parsed as Record<string, unknown>;
}

/**
 * Read a raw request body into memory, failing fast with 413 once `maxBytes`
 * is exceeded (whether or not the client declared a Content-Length).
 */
export async function readBytes(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes) throw payloadTooLarge();
  if (!request.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A file download that browsers save instead of display. */
export const attachment = (filename: string, contentType: string, extra: Record<string, string> = {}) => ({
  ...NO_STORE,
  'Content-Type': contentType,
  'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
  'X-Content-Type-Options': 'nosniff',
  ...extra,
});

/** `?limit=&offset=` with bounds. */
export function paging(url: URL, defaultLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || defaultLimit, 1), maxLimit);
  const offset = Math.max(Math.floor(Number(url.searchParams.get('offset')) || 0), 0);
  return { limit, offset };
}

export const truthy = (value: unknown): boolean =>
  value === true || value === 'true' || value === '1' || value === 'on' || value === 'yes';

/**
 * Read a route parameter. Astro only `decodeURI`s the path, so reserved
 * characters can still arrive percent-encoded; decode once more defensively.
 * Slugs never contain `%` (see core/slug.ts), so this cannot double-decode.
 */
export const param = (context: APIContext, name: string): string => {
  const value = context.params[name];
  if (!value) throw badRequest(`missing route parameter: ${name}`);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
