/**
 * Permanent redirects from earlier URL schemes to /articles:
 *
 *   /works, /works/:slug           (this site's old "Works" collection)
 *   /writing/:slug                 (older alias of /works)
 *   /journal, /journal/:slug       (this site's old local journal)
 *   /posts, /posts/:slug, /posts/tag/:tag   (BrainEno/astro-notion)
 *
 * `?tag=` is carried over, everything else lands on the article index.
 */
import type { APIContext } from 'astro';
import { ARTICLES_PATH, articlePath, tagPath } from '../../../shared/routes.ts';

const segments = (value: string | undefined) =>
  String(value ?? '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

export function legacyTarget(rest: string | undefined, search: URLSearchParams): string {
  const parts = segments(rest);
  if (parts[0] === 'tag' && parts[1]) return tagPath(parts[1]);
  if (parts.length === 1 && parts[0]) return articlePath(parts[0]);
  const tag = search.get('tag');
  return tag ? tagPath(tag) : ARTICLES_PATH;
}

export const redirectLegacy = (context: APIContext) =>
  new Response(null, {
    status: 301,
    headers: { Location: legacyTarget(context.params.rest ?? context.params.slug, context.url.searchParams), 'Cache-Control': 'public, max-age=86400' },
  });
