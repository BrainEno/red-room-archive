/**
 * Security headers for HTML documents.
 *
 * The pages ship no inline scripts, inline styles or event-handler attributes
 * (astro.config.mjs: `inlineStylesheets: 'never'`, `assetsInlineLimit: 0`),
 * so a strict same-origin policy holds. External content the site can show:
 *
 * - images: Notion/More covers on any https host, `data:`/`blob:` previews
 * - media:  https audio/video embeds; Notion files are proxied (same origin)
 * - frames: https embeds from Notion (YouTube, maps, …)
 *
 * `'wasm-unsafe-eval'` lets three.js's meshopt decoder compile WebAssembly;
 * it does not allow `eval()` of JavaScript.
 *
 * `FRAME_ANCESTORS` controls who may embed the site (default `'self'`); set it
 * to `*` or a list of origins for preview tools that show the site in a frame.
 * The static build copies these headers into `_headers` (Netlify, Cloudflare).
 */
import { readEnv } from '../../core/env.ts';

const DEFAULT_ANCESTORS = "'self'";

/** Space-separated sources only; anything that could inject a directive falls back to the default. */
export function frameAncestors(raw = readEnv('FRAME_ANCESTORS')): string {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_ANCESTORS;
  const ok = value.split(/\s+/).every((source) =>
    /^(?:\*|'self'|'none'|https?:|https?:\/\/(?:\*\.)?[a-z0-9.-]+(?::\d+)?)$/i.test(source));
  return ok ? value : DEFAULT_ANCESTORS;
}

export function contentSecurityPolicy(ancestors = frameAncestors()): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https:",
    'frame-src https:',
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}

/** Headers for every HTML response (and the static `_headers` file). */
export function securityHeaders(ancestors = frameAncestors()): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(ancestors),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
