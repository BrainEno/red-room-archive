/**
 *   GET /media/notion/:id   cached copy of a Notion-hosted image or file
 *
 * Notion's own file URLs expire after about an hour; article HTML points here
 * instead. Unknown ids are 404 (see services/media.ts for the allow-list).
 */
import type { APIContext } from 'astro';
import { AppError } from '../../../core/errors.ts';
import { notionMedia } from '../../services/media.ts';
import { inlineSafe } from '../../storage/notion-media.ts';
import { sendFile } from './uploads.ts';

const text = (status: number, message: string) =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function serveNotionMedia(context: APIContext, headOnly = false): Promise<Response> {
  try {
    const file = await notionMedia(String(context.params.id ?? ''));
    const inline = inlineSafe(file.mime);
    return sendFile(context.request, inline ? file : { ...file, mime: 'application/octet-stream' }, {
      headOnly,
      // The URL is stable per article revision; browsers revalidate daily via ETag.
      cacheControl: 'public, max-age=86400, stale-while-revalidate=604800',
      headers: {
        // Even an image must never run script if opened directly.
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
      },
    });
  } catch (error) {
    if (error instanceof AppError) return text(error.status === 404 ? 404 : error.status, error.status === 404 ? 'Not found' : error.message);
    console.error('[media]', error);
    return text(500, 'internal error');
  }
}
