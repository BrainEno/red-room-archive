/**
 * Permanent redirects from earlier URL schemes to /articles:
 *
 *   /works, /works/:slug           (this site's old "Works" collection)
 *   /writing/:slug                 (older alias of /works)
 *   /journal, /journal/:slug       (this site's old local journal)
 *   /posts, /posts/:slug, /posts/tag/:tag   (BrainEno/astro-notion)
 *
 * `?tag=` and tag paths land on the topic page (any name of a topic works —
 * the topic page redirects aliases to the canonical slug), everything else on
 * the article index. A `/zh-CN/…` legacy URL keeps its language.
 */
import type { APIContext } from 'astro';
import { localePath } from '../../../shared/i18n.ts';
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

/** `/posts/tag/x` → `tag/x` (still percent-encoded; legacyTarget decodes). */
const legacyRest = (path: string) => path.split('/').filter(Boolean).slice(1).join('/');

export const redirectLegacy = (context: APIContext) =>
  new Response(null, {
    status: 301,
    headers: {
      // From the neutral path, not context.params: endpoints reached through the
      // `/zh-CN` rewrite keep the params of the original (unmatched) URL.
      Location: localePath(legacyTarget(legacyRest(context.locals.path ?? context.url.pathname), context.url.searchParams), context.locals.locale),
      'Cache-Control': 'public, max-age=86400',
    },
  });
