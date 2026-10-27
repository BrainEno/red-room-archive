/**
 * Picks the interface language for every request (see shared/i18n.ts):
 * `?lang=` → `lang` cookie → Accept-Language → English.
 *
 * - The result is `Astro.locals.locale`; pages pass it to `getSite()` and views.
 * - An explicit `?lang=` is remembered in a cookie, so the choice survives
 *   navigation without every link carrying the parameter.
 * - HTML responses say which language they are in and that they vary by
 *   cookie / Accept-Language, so no shared cache serves one reader's language
 *   to another.
 */
import { defineMiddleware } from 'astro:middleware';
import { LOCALE_COOKIE, LOCALE_PARAM, parseLocale, resolveLocale } from './shared/i18n.ts';

const ONE_YEAR = 60 * 60 * 24 * 365;

export const onRequest = defineMiddleware(async (context, next) => {
  const explicit = parseLocale(context.url.searchParams.get(LOCALE_PARAM));
  const cookie = context.cookies.get(LOCALE_COOKIE)?.value;
  const locale = resolveLocale({
    param: explicit,
    cookie,
    acceptLanguage: context.request.headers.get('accept-language'),
  });
  context.locals.locale = locale;
  if (explicit && explicit !== cookie) {
    context.cookies.set(LOCALE_COOKIE, explicit, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
  }

  const response = await next();
  if (!response.headers.get('content-type')?.startsWith('text/html')) return response;
  try {
    response.headers.set('Content-Language', locale);
    const vary = response.headers.get('Vary');
    response.headers.set('Vary', [vary, 'Cookie', 'Accept-Language'].filter(Boolean).join(', '));
  } catch {
    // Immutable headers (e.g. Response.redirect) — nothing to annotate.
  }
  return response;
});
