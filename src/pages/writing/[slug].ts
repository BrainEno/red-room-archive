// Legacy route: /writing/:slug moved to /works/:slug (permanent redirect keeps old links working).
import type { APIRoute } from 'astro';
import { itemPath } from '../../shared/kinds.ts';

export const GET: APIRoute = ({ params, redirect }) => redirect(itemPath('writing', params.slug ?? ''), 301);
