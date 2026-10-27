// Route adapter only — public file serving lives in src/server/http/endpoints/uploads.ts.
import type { APIRoute } from 'astro';
import { serve } from '../../server/http/endpoints/uploads.ts';

export const GET: APIRoute = (context) => serve(context);
export const HEAD: APIRoute = (context) => serve(context, true);
