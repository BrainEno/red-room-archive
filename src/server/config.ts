/**
 * Runtime configuration read from the environment.
 *
 * Values are resolved on every call (cheap: the `.env` file is cached in
 * `core/env.ts`) so tests can change them after import.
 */
import path from 'node:path';
import { readEnv } from '../core/env.ts';

const number = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  /** Absolute path used by the public site when building canonical URLs. */
  siteUrl: () => (readEnv('SITE_URL') ?? '').replace(/\/+$/, ''),
  dbPath: () => readEnv('DB_PATH') || 'data/archive.db',
  dataDir: () => path.dirname(path.resolve(config.dbPath())) || '.',
  uploadDir: () => path.resolve(readEnv('UPLOAD_DIR') || 'data/uploads'),
  /** Seconds a cached Notion snapshot stays fresh before a background refresh. */
  syncTtlMs: () => number(readEnv('SYNC_TTL_SECONDS'), 300) * 1000,
  maxUploadBytes: () => number(readEnv('MAX_UPLOAD_MB'), 300) * 1024 * 1024,
  maxJsonBytes: () => number(readEnv('MAX_JSON_KB'), 2048) * 1024,
  notionTimeoutMs: () => number(readEnv('NOTION_TIMEOUT_MS'), 15_000),
} as const;
