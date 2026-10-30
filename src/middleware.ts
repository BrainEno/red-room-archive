/**
 * Picks the interface language for every request (see shared/i18n.ts).
 *
 * Pages: the path decides. `/zh-CN/…` is served by the same page route as
 * `/…` (a rewrite), with `Astro.locals.locale` = zh-CN and `Astro.locals.path`
 * = the locale-neutral path views build links from. The other signals only
 * redirect, so every URL always shows the same language:
 *   - `?lang=` (what the switcher links to) is remembered in the `lang`
 *     cookie, then 302 → the clean URL in that language;
 *   - an unprefixed page with a non-default `lang` cookie 302s to its prefix;
 *   - `/` with no cookie follows Accept-Language.
 * APIs and files have no prefix: `?lang=` → cookie → Accept-Language → English.
 *
 * - HTML responses say which language they are in and that they vary by
 *   cookie / Accept-Language (the redirects above depend on them).
 * - HTML responses also carry the security headers (server/http/security.ts);
 *   /admin is never cached. The CSP is skipped under `astro dev`, where Vite
 *   injects inline styles and scripts.
 */
import { defineMiddleware } from 'astro:middleware';
import {
  DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_PARAM, isPagePath, localePath, negotiateLocale, parseLocale, resolveLocale, splitLocale, type Locale,
} from './shared/i18n.ts';
import { securityHeaders } from './server/http/security.ts';

const ONE_YEAR = 60 * 60 * 24 * 365;

const redirect = (location: string, vary: string) =>
  new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', Vary: vary } });

export const onRequest = defineMiddleware(async (context, next) => {
  const { url } = context;
  const cookie = context.cookies.get(LOCALE_COOKIE)?.value;
  const explicit = parseLocale(url.searchParams.get(LOCALE_PARAM));
  const remember = (locale: string) => {
    if (locale !== cookie) context.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
  };
  const { locale: prefixed, path } = splitLocale(url.pathname);
  const page = isPagePath(path) && (context.request.method === 'GET' || context.request.method === 'HEAD');

  let response: Response;
  let locale: Locale;
  if (!page) {
    // APIs, files, the admin shell: no prefix, classic resolution.
    locale = resolveLocale({ param: explicit, cookie, acceptLanguage: context.request.headers.get('accept-language') });
    context.locals.locale = locale;
    context.locals.path = url.pathname;
    if (explicit) remember(explicit);
    response = await next();
  } else {
    const query = new URLSearchParams(url.search);
    query.delete(LOCALE_PARAM);
    const search = query.size ? `?${query}` : '';
    if (explicit) {
      const response = redirect(`${localePath(path, explicit)}${search}`, 'Cookie');
      // Set by hand: Astro only applies cookies.set() to responses it renders.
      if (explicit !== cookie) response.headers.append('Set-Cookie', `${LOCALE_COOKIE}=${explicit}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`);
      return response;
    }
    if (!prefixed) {
      const wanted = parseLocale(cookie) ?? (path === '/' ? negotiateLocale(context.request.headers.get('accept-language')) : null);
      if (wanted && wanted !== DEFAULT_LOCALE) return redirect(`${localePath(path, wanted)}${search}`, 'Cookie, Accept-Language');
    }
    locale = prefixed ?? DEFAULT_LOCALE;
    context.locals.locale = locale;
    context.locals.path = path;
    response = prefixed ? await next(new URL(`${path}${url.search}`, url)) : await next();
  }

  if (!response.headers.get('content-type')?.startsWith('text/html')) return response;
  try {
    response.headers.set('Content-Language', locale);
    for (const [name, value] of Object.entries(securityHeaders())) {
      if (name === 'Content-Security-Policy' && import.meta.env.DEV) continue;
      response.headers.set(name, value);
    }
    // The admin shell holds no secrets, but never keep it in shared or back/forward caches.
    if (context.url.pathname === '/admin' || context.url.pathname.startsWith('/admin/')) response.headers.set('Cache-Control', 'no-store');
    // Public HTML contains editable settings; never serve a stale copy without revalidation.
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-cache');
    const vary = response.headers.get('Vary');
    response.headers.set('Vary', [vary, 'Cookie', 'Accept-Language'].filter(Boolean).join(', '));
  } catch {
    // Immutable headers (e.g. Response.redirect) — nothing to annotate.
  }
  return response;
});
