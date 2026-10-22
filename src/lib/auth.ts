import { env } from './notion';
export const authed = (r: Request) => !!env('ADMIN_TOKEN') && r.headers.get('authorization') === `Bearer ${env('ADMIN_TOKEN')}`;
export const deny = () => new Response('Unauthorized', { status: 401 });
