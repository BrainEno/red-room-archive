// Legacy URL → /articles (301). See src/server/http/endpoints/legacy.ts.
import type { APIRoute } from 'astro';
import { redirectLegacy } from '../../server/http/endpoints/legacy.ts';

export const GET: APIRoute = (context) => redirectLegacy(context);
