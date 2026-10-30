// Security headers for HTML responses (server/http/security.ts) and the middleware wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentSecurityPolicy, frameAncestors, securityHeaders } from '../src/server/http/security.ts';

test('CSP is strict: same-origin scripts and styles, no unsafe-inline or eval', () => {
  const csp = contentSecurityPolicy("'self'");
  assert.match(csp, /(^|; )default-src 'self'(;|$)/);
  assert.match(csp, /(^|; )script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  assert.match(csp, /(^|; )style-src 'self'(;|$)/);
  assert.match(csp, /(^|; )object-src 'none'(;|$)/);
  assert.match(csp, /(^|; )frame-ancestors 'self'$/);
  assert.doesNotMatch(csp, /unsafe-inline|'unsafe-eval'/);
  const headers = securityHeaders("'self'");
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
});

test('FRAME_ANCESTORS accepts sources and rejects directive injection', () => {
  assert.equal(frameAncestors(undefined), "'self'");
  assert.equal(frameAncestors(''), "'self'");
  assert.equal(frameAncestors('*'), '*');
  assert.equal(frameAncestors("'none'"), "'none'");
  assert.equal(frameAncestors("'self' https://*.e2b.app https://preview.example:8443"), "'self' https://*.e2b.app https://preview.example:8443");
  for (const bad of ["'self'; script-src *", 'https://a.example,https://b.example', 'javascript:', "'unsafe-inline'", 'https://a.example/path']) {
    assert.equal(frameAncestors(bad), "'self'", bad);
  }
});

test('middleware adds the headers to HTML and keeps /admin out of caches', () => {
  const source = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
  assert.match(source, /securityHeaders\(\)/);
  assert.match(source, /'\/admin'[\s\S]*no-store/);
});

test('pages ship no inline handlers or styles that the CSP would block', () => {
  const base = readFileSync(new URL('../src/ui/layouts/Base.astro', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../src/ui/views/HomeView.astro', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  for (const source of [base, home]) {
    assert.doesNotMatch(source, /\son[a-z]+="/);
    assert.doesNotMatch(source, /<style[\s>]/);
  }
  assert.match(config, /inlineStylesheets: 'never'/);
  assert.match(config, /assetsInlineLimit: 0/);
});
