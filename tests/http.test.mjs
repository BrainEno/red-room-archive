import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, conflict, upstreamError } from '../src/core/errors.ts';
import { errorResponse, paging, readJson, route, truthy } from '../src/server/http/respond.ts';
import { isSafeUrl } from '../src/core/safety.ts';

test('paging clamps limit and offset', () => {
  const u = (q) => new URL('https://x.test/api?' + q);
  assert.deepEqual(paging(u('limit=10&offset=5')), { limit: 10, offset: 5 });
  assert.deepEqual(paging(u('limit=9999')), { limit: 200, offset: 0 });
  assert.deepEqual(paging(u('limit=0&offset=-3')), { limit: 50, offset: 0 });
  assert.deepEqual(paging(u('limit=abc'), 25), { limit: 25, offset: 0 });
});

test('readJson rejects malformed and oversized bodies', async () => {
  const ok = await readJson(new Request('https://x.test/', { method: 'POST', body: '{"a":1}' }));
  assert.equal(ok.a, 1);
  await assert.rejects(readJson(new Request('https://x.test/', { method: 'POST', body: 'not json' })), /invalid JSON/);
  await assert.rejects(readJson(new Request('https://x.test/', { method: 'POST', body: '[1]' })), /must be an object/);
  await assert.rejects(readJson(new Request('https://x.test/', { method: 'POST', body: '{"a":"' + 'x'.repeat(50) + '"}', headers: { 'content-length': '99999999' } })), /too large/);
});

test('errorResponse uses the contract shape { error, code, details? }', async () => {
  const known = errorResponse(conflict('slug already exists', { slug: 'x' }));
  assert.equal(known.status, 409);
  assert.deepEqual(await known.json(), { error: 'slug already exists', code: 'conflict', details: { slug: 'x' } });

  const upstream = errorResponse(upstreamError('could not reach Notion'));
  assert.equal(upstream.status, 502);
  assert.equal((await upstream.json()).code, 'upstream_error');

  const unknown = errorResponse(new Error('secret internal detail'));
  assert.equal(unknown.status, 500);
  const body = await unknown.json();
  assert.equal(body.code, 'internal');
  assert.doesNotMatch(JSON.stringify(body), /secret/);
});

test('401 responses advertise the Bearer scheme', () => {
  const response = errorResponse(new AppError(401, 'unauthorized', 'nope'));
  assert.equal(response.headers.get('www-authenticate'), 'Bearer');
});

test('route() converts thrown errors into responses', async () => {
  const handler = route(() => { throw conflict('taken'); });
  const response = await handler({});
  assert.equal(response.status, 409);
});

test('truthy accepts the usual form/db spellings', () => {
  for (const v of [true, 'true', '1', 'on', 'yes']) assert.ok(truthy(v));
  for (const v of [false, 0, '0', '', null, undefined]) assert.ok(!truthy(v));
});

test('isSafeUrl blocks obfuscated and scripting schemes', () => {
  for (const url of ['https://a.test/x', '/uploads/a.mp3', 'mailto:a@b.test', 'tel:+123', '#top']) assert.ok(isSafeUrl(url), url);
  for (const url of ['javascript:alert(1)', 'JaVa\tScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', '', null]) assert.ok(!isSafeUrl(url), String(url));
});
