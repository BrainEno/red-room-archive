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
  /** Cached copies of Notion-hosted images/files (their signed URLs expire). */
  mediaDir: () => path.resolve(readEnv('MEDIA_CACHE_DIR') || path.join(config.dataDir(), 'notion-media')),
  /** Largest Notion file the media proxy will download. */
  maxMediaBytes: () => number(readEnv('MAX_MEDIA_MB'), 50) * 1024 * 1024,
  /** Seconds a cached Notion snapshot stays fresh before a background refresh. */
  syncTtlMs: () => number(readEnv('SYNC_TTL_SECONDS'), 300) * 1000,
  maxUploadBytes: () => number(readEnv('MAX_UPLOAD_MB'), 300) * 1024 * 1024,
  maxJsonBytes: () => number(readEnv('MAX_JSON_KB'), 256) * 1024,
  notionTimeoutMs: () => number(readEnv('NOTION_TIMEOUT_MS'), 15_000),
  /** Bookmark previews: the server reads the title/description of bookmarked pages. `off` disables it. */
  linkPreviews: () => !/^(0|off|false|no)$/i.test(readEnv('LINK_PREVIEWS') ?? ''),
  /** Override for tests and proxies; the real API is the default. */
  notionApiBase: () => (readEnv('NOTION_API_BASE') || 'https://api.notion.com/v1').replace(/\/+$/, ''),
} as const;
