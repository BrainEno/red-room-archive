/**
 * Admin authentication.
 *
 * One shared bearer token (`ADMIN_TOKEN`), compared in constant time. Wrong
 * tokens are rate-limited per IP; *missing* tokens are not — an anonymous
 * visitor probing an endpoint must never be able to lock out the owner.
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { APIContext } from 'astro';
import { rateLimited, unauthorized, unavailable } from '../../core/errors.ts';
import { readEnv } from '../../core/env.ts';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 12;
const MAX_BUCKETS = 1024;
const MAX_GLOBAL_FAILURES = 1200;

interface Bucket {
  count: number;
  first: number;
}

const failures = new Map<string, Bucket>();
let globalBucket: Bucket | undefined;

const sameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

const bearerToken = (request: Request): string =>
  (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

/** No forwarded header is trusted. Requests containing one share a bucket;
 * Astro's adapter can otherwise expose an X-Forwarded-For-derived address when
 * allowedDomains is configured, so never assume that address is the socket. */
export function clientIp(request: Request, peer = ''): string {
  if (request.headers.has('x-forwarded-for') || request.headers.has('x-real-ip') || request.headers.has('forwarded')) return 'forwarded-shared';
  const normalized = peer.startsWith('::ffff:') ? peer.slice(7) : peer;
  return isIP(normalized) ? normalized : 'unknown';
}

export function requestPeer(context: APIContext): string {
  try { return context.clientAddress || ''; } catch { return ''; }
}

const bucketFor = (ip: string): Bucket => {
  const now = Date.now();
  const existing = failures.get(ip);
  if (!existing || now - existing.first > WINDOW_MS) {
    for (const [key, bucket] of failures) if (now - bucket.first > WINDOW_MS) failures.delete(key);
    if (failures.size >= MAX_BUCKETS) failures.delete(failures.keys().next().value!);
    const fresh: Bucket = { count: 0, first: now };
    failures.set(ip, fresh);
    return fresh;
  }
  return existing;
};

const isThrottled = (ip: string): boolean => {
  const bucket = failures.get(ip);
  const now = Date.now();
  return Boolean((bucket && bucket.count >= MAX_FAILURES && now - bucket.first <= WINDOW_MS) ||
    (globalBucket && globalBucket.count >= MAX_GLOBAL_FAILURES && now - globalBucket.first <= WINDOW_MS));
};

const noteFailure = (ip: string) => {
  bucketFor(ip).count++;
  const now = Date.now();
  if (!globalBucket || now - globalBucket.first > WINDOW_MS) globalBucket = { count: 0, first: now };
  globalBucket.count++;
};

const noteSuccess = (ip: string) => {
  failures.delete(ip);
};

/**
 * The configured token, or `undefined` when the deployment forgot to set one.
 * Deliberately environment-only: the admin token can never be changed (or
 * locked out) through the database.
 */
export const adminToken = (): string | undefined => readEnv('ADMIN_TOKEN') || undefined;

/** True when the request carries the right token. */
export function isAdmin(request: Request): boolean {
  const expected = adminToken();
  const provided = bearerToken(request);
  return Boolean(expected && provided && sameSecret(provided, expected));
}

/** Throws `AppError` unless the request is authenticated. */
export function requireAdmin(request: Request, peer = ''): void {
  const expected = adminToken();
  if (!expected) throw unavailable('ADMIN_TOKEN is not configured on the server');
  if (isThrottled(clientIp(request, peer))) throw rateLimited();

  const provided = bearerToken(request);
  if (!provided) throw unauthorized();
  if (!sameSecret(provided, expected)) {
    noteFailure(clientIp(request, peer));
    throw unauthorized('invalid admin token');
  }
  noteSuccess(clientIp(request, peer));
}

/** Login endpoint: validates a token from the request body. */
export function authenticate(request: Request, token: unknown, peer = ''): void {
  const expected = adminToken();
  if (!expected) throw unavailable('ADMIN_TOKEN is not configured on the server');
  if (isThrottled(clientIp(request, peer))) throw rateLimited();
  if (!token || !sameSecret(String(token), expected)) {
    noteFailure(clientIp(request, peer));
    throw unauthorized('invalid token');
  }
  noteSuccess(clientIp(request, peer));
}

/** Test helper: forget throttling state. */
export const resetAuthThrottle = () => { failures.clear(); globalBucket = undefined; };
