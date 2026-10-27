/**
 * File library.
 *
 *   GET    /api/uploads             list + disk usage
 *   POST   /api/uploads?name=x.mp4  raw body upload (streams to disk; any size up to MAX_UPLOAD_MB)
 *   POST   /api/uploads             multipart `file=` (small files)
 *          …&as=model               store a .glb as the 3D statue (query *or* form field)
 *   GET    /api/uploads/:name       file info
 *   PATCH  /api/uploads/:name       rename { name }
 *   DELETE /api/uploads/:name       delete → 204
 *
 *   GET    /uploads/:name           public download, Range + ETag/304
 */
import type { APIContext } from 'astro';
import { badRequest, payloadTooLarge } from '../../../core/errors.ts';
import type { UploadFile, UploadListResponse, UploadResponse } from '../../../shared/contracts.ts';
import { config } from '../../config.ts';
import { requireAdmin } from '../../services/auth.ts';
import { renameUploadOnMore, uploadsUsedOnMore } from '../../services/more.ts';
import {
  listUploads,
  readRange,
  removeUpload,
  renameUpload,
  saveFile,
  saveStream,
  servedFile,
  statUpload,
  usage,
} from '../../storage/uploads.ts';
import { NO_STORE, created, json, param, readJson, route } from '../respond.ts';

export const list = route((context) => {
  requireAdmin(context.request);
  const used = uploadsUsedOnMore();
  const files = listUploads().map((file) => (used.has(file.name) ? { ...file, usedBy: ['more'] } : file));
  return json<UploadListResponse>({ files, usage: usage(files) }, { headers: NO_STORE });
});

const MULTIPART_OVERHEAD = 1024 * 1024;

export const upload = route(async (context) => {
  requireAdmin(context.request);
  const { request, url } = context;
  const max = config.maxUploadBytes();
  const declared = Number(request.headers.get('content-length') ?? 0);
  const contentType = request.headers.get('content-type') ?? '';
  let asModel = url.searchParams.get('as') === 'model';
  let saved: UploadFile;

  if (contentType.includes('multipart/form-data')) {
    if (declared && declared > max + MULTIPART_OVERHEAD) throw payloadTooLarge('file too large');
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest('invalid multipart body');
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw badRequest('multipart uploads need a `file` field');
    asModel ||= form.get('as') === 'model';
    saved = await saveFile(file, { asModel, maxBytes: max });
  } else {
    const name = url.searchParams.get('name') ?? '';
    if (!name) throw badRequest('raw uploads need ?name=<file.ext>');
    if (declared && declared > max) throw payloadTooLarge('file too large');
    saved = await saveStream(request.body, name, { asModel, maxBytes: max });
  }

  const body: UploadResponse = { ok: true, name: saved.name, size: saved.size, url: saved.url };
  return created(body, saved.url);
});

export const info = route((context) => {
  requireAdmin(context.request);
  return json<UploadFile>(statUpload(param(context, 'name')), { headers: NO_STORE });
});

export const rename = route(async (context) => {
  requireAdmin(context.request);
  const { name: to } = await readJson(context.request);
  if (!to || typeof to !== 'string') throw badRequest('new name is required');
  const from = param(context, 'name');
  const next = renameUpload(from, to);
  const file = statUpload(next);
  if (next !== from) renameUploadOnMore(from, file.url);
  return json<UploadFile>(file, { headers: NO_STORE });
});

export const remove = route((context) => {
  requireAdmin(context.request);
  removeUpload(param(context, 'name'));
  return new Response(null, { status: 204, headers: NO_STORE });
});

/* ── Public file serving ────────────────────────────────────────────── */

/** Parse a single `Range: bytes=` spec, including suffix ranges (`bytes=-500`). */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!match) return null;
  const [, from, to] = match;
  if (!from && !to) return 'invalid';
  let start: number;
  let end: number;
  if (!from) {
    const suffix = Number(to);
    if (!suffix) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(from);
    end = to ? Math.min(Number(to), size - 1) : size - 1;
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

export interface SendableFile {
  path: string;
  size: number;
  /** Seconds since epoch. */
  mtime: number;
  mime: string;
}

/** Stream a file with ETag/304 and single-range support. */
export function sendFile(
  request: Request,
  file: SendableFile,
  options: { headOnly?: boolean; cacheControl?: string; headers?: Record<string, string> } = {},
): Response {
  const etag = `"${file.size.toString(16)}-${file.mtime.toString(16)}"`;
  const lastModified = new Date(file.mtime * 1000).toUTCString();
  const cacheControl = options.cacheControl ?? 'public, max-age=3600';
  const headers: Record<string, string> = {
    'Content-Type': file.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
    'Last-Modified': lastModified,
    ...(options.headers ?? {}),
  };

  const ifNoneMatch = request.headers.get('if-none-match');
  const ifModifiedSince = Date.parse(request.headers.get('if-modified-since') ?? '');
  const notModified = ifNoneMatch
    ? ifNoneMatch.split(',').map((tag) => tag.trim()).includes(etag)
    : Boolean(ifModifiedSince) && file.mtime * 1000 <= ifModifiedSince;
  if (notModified) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': cacheControl } });
  }

  const range = parseRange(request.headers.get('range'), file.size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
  if (range && !options.headOnly) {
    return new Response(readRange(file.path, range.start, range.end), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`, 'Content-Length': String(range.end - range.start + 1) },
    });
  }

  headers['Content-Length'] = String(file.size);
  if (options.headOnly) return new Response(null, { status: 200, headers });
  return new Response(readRange(file.path), { headers });
}

export function serve(context: APIContext, headOnly = false): Response {
  const file = servedFile(context.params.path ?? '');
  if (!file) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return sendFile(context.request, file, { headOnly });
}
