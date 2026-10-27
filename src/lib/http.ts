// API 层的通用工具：JSON 响应、错误、请求体解析、缓存头。

/** 带 HTTP 状态码的错误，route 里 throw 后由 handler 统一转成响应。 */
export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, init);

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json({ error, ...extra }, { status });

export const notFound = (what = 'not found') => fail(404, what);
export const unauthorized = () => fail(401, 'Unauthorized');

/** 公开读接口的缓存头：短缓存 + 允许 CDN 重新验证。 */
export const cacheFor = (seconds: number): Record<string, string> =>
  ({ 'Cache-Control': `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}` });

const MAX_JSON_BYTES = 2 * 1024 * 1024;

/** 读取并解析 JSON 请求体，拒绝过大的载荷与非对象。 */
export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, any>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes) throw new HttpError(413, 'request body too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'request body too large');
  if (!text.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new HttpError(400, 'invalid JSON body'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'JSON body must be an object');
  return parsed as Record<string, any>;
}

/** 解析 ?limit=&offset=，给出有上限的分页。 */
export function paging(url: URL, defLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || defLimit, 1), maxLimit);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  return { limit, offset };
}

export const truthy = (v: unknown) => v === true || v === 'true' || v === '1' || v === 'on' || v === 'yes';

/** 把 route handler 里抛出的错误转成 JSON 响应；未知错误记录日志但只回 500。 */
export function toResponse(e: unknown): Response {
  if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
  console.error('[api]', e);
  return fail(500, 'internal error');
}

/** 统一包装 handler：捕获异常 → JSON 错误响应。 */
export function handler<C>(fn: (ctx: C) => Response | Promise<Response>) {
  return async (ctx: C) => { try { return await fn(ctx); } catch (e) { return toResponse(e); } };
}
