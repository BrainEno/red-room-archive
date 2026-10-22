import type { APIRoute } from 'astro';
import { getItems } from '../../lib/db';
export const GET: APIRoute = async () =>
  Response.json({ writing: await getItems('writing'), films: await getItems('films'), music: await getItems('music') });
