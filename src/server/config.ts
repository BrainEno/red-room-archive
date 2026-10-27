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

/** Like `number`, but an explicit `0` is kept (used for "disabled"). */
const whole = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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
  /** Saved versions kept per journal post (older ones are pruned). */
  revisionsKeep: () => Math.floor(number(readEnv('POST_REVISIONS_KEEP'), 50)),
  /** Database snapshots (`VACUUM INTO`); defaults to `<data dir>/backups`. */
  backupDir: () => path.resolve(readEnv('BACKUP_DIR') || path.join(config.dataDir(), 'backups')),
  /** Hours between automatic snapshots; `0` turns automatic backups off. */
  backupIntervalHours: () => whole(readEnv('BACKUP_INTERVAL_HOURS'), 24),
  /** Automatic snapshots kept; manual ones are never pruned. */
  backupKeep: () => Math.max(1, Math.floor(number(readEnv('BACKUP_KEEP'), 14))),
  maxImportBytes: () => number(readEnv('MAX_IMPORT_MB'), 50) * 1024 * 1024,
} as const;
