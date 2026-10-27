// Route adapter only — logic lives in src/server/http/endpoints/media.ts.
import type { APIRoute } from 'astro';
import { serveNotionMedia } from '../../../server/http/endpoints/media.ts';

export const GET: APIRoute = (context) => serveNotionMedia(context);
export const HEAD: APIRoute = (context) => serveNotionMedia(context, true);
