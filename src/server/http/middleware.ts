/**
 * Request middleware (wired in `src/middleware.ts`).
 *
 * Background upkeep piggybacks on traffic instead of timers: each hook is
 * throttled, never throws and never delays the response.
 */
import type { MiddlewareHandler } from 'astro';
import { scheduledBackupTick } from '../services/backups.ts';

export const maintenance: MiddlewareHandler = (context, next) => {
  if (!context.isPrerendered) scheduledBackupTick();
  return next();
};
