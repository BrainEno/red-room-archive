/**
 * Domain errors.
 *
 * Services and HTTP adapters throw `AppError`; a single wrapper in
 * `server/http/route.ts` turns it into a response with the matching status and
 * machine-readable code. Anything that is not an `AppError` is treated as a
 * bug: logged server-side, reported as a generic 500.
 */
import type { ApiErrorCode } from '../shared/contracts.ts';

export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'bad_request', message, details);

export const unauthorized = (message = 'a valid admin token is required') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'not allowed') => new AppError(403, 'forbidden', message);

export const notFound = (message = 'not found', details?: Record<string, unknown>) =>
  new AppError(404, 'not_found', message, details);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'conflict', message, details);

export const payloadTooLarge = (message = 'request body too large') =>
  new AppError(413, 'payload_too_large', message);

export const rateLimited = (message = 'too many failed attempts, try again later') =>
  new AppError(429, 'rate_limited', message);

export const gone = (message: string, details?: Record<string, unknown>) =>
  new AppError(410, 'gone', message, details);

export const upstreamError = (message: string, details?: Record<string, unknown>) =>
  new AppError(502, 'upstream_error', message, details);

export const unavailable = (message: string) => new AppError(503, 'unavailable', message);

export const internal = (message = 'internal error') => new AppError(500, 'internal', message);
