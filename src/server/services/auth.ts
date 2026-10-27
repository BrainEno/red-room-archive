/**
 * Admin authentication.
 *
 * One shared bearer token (`ADMIN_TOKEN`), compared in constant time. Wrong
 * tokens are rate-limited per IP; *missing* tokens are not — an anonymous
 * visitor probing an endpoint must never be able to lock out the owner.
 */
import { timingSafeEqual } from 'node:crypto';
import { rateLimited, unauthorized, unavailable } from '../../core/errors.ts';
import { readEnv } from '../../core/env.ts';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 12;

interface Bucket {
  count: number;
  first: number;
}

const failures = new Map<string, Bucket>();

const sameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

export const bearerToken = (request: Request): string =>
  (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

export const clientIp = (request: Request): string =>
  (request.headers.get('x-forwarded-for')?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'local').trim();

const bucketFor = (ip: string): Bucket => {
  const now = Date.now();
  const existing = failures.get(ip);
  if (!existing || now - existing.first > WINDOW_MS) {
    const fresh: Bucket = { count: 0, first: now };
    failures.set(ip, fresh);
    return fresh;
  }
  return existing;
};

const isThrottled = (ip: string): boolean => {
  const bucket = failures.get(ip);
  return !!bucket && bucket.count >= MAX_FAILURES && Date.now() - bucket.first <= WINDOW_MS;
};

const noteFailure = (ip: string) => {
  bucketFor(ip).count++;
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
export function requireAdmin(request: Request): void {
  const expected = adminToken();
  if (!expected) throw unavailable('ADMIN_TOKEN is not configured on the server');
  if (isThrottled(clientIp(request))) throw rateLimited();

  const provided = bearerToken(request);
  if (!provided) throw unauthorized();
  if (!sameSecret(provided, expected)) {
    noteFailure(clientIp(request));
    throw unauthorized('invalid admin token');
  }
  noteSuccess(clientIp(request));
}

/** Login endpoint: validates a token from the request body. */
export function authenticate(request: Request, token: unknown): void {
  const expected = adminToken();
  if (!expected) throw unavailable('ADMIN_TOKEN is not configured on the server');
  if (isThrottled(clientIp(request))) throw rateLimited();
  if (!token || !sameSecret(String(token), expected)) {
    noteFailure(clientIp(request));
    throw unauthorized('invalid token');
  }
  noteSuccess(clientIp(request));
}

/** Test helper: forget throttling state. */
export const resetAuthThrottle = () => failures.clear();
