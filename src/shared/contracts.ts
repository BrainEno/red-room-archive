/**
 * Wire contracts between the HTTP API and every client (Astro pages and the
 * browser-side admin). Type-only: this module must stay free of runtime
 * imports so it can be used on the server and in the browser alike.
 *
 * API v2: Notion is the single source of truth; the site only reads.
 */

/* ── Errors ─────────────────────────────────────────────────────────── */

/** Machine-readable error codes. Clients branch on these, never on messages. */
export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'upstream_error'
  | 'unavailable'
  | 'internal';

/** Every failing response has this shape (`details` carries context such as a slug). */
export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  details?: Record<string, unknown>;
}

/* ── Paging ─────────────────────────────────────────────────────────── */

export interface Paged {
  total: number;
  limit: number;
  offset: number;
}

/* ── Articles ───────────────────────────────────────────────────────── */

export interface ArticleSummary {
  /** Notion page id (dashed). */
  id: string;
  slug: string;
  title: string;
  /** Publish date (`YYYY-MM-DD` or ISO datetime), falls back to the page's creation time. */
  date: string;
  tags: string[];
  excerpt: string;
  /** Site-relative proxy URL (`/media/notion/…`) or an external https URL. */
  cover: string | null;
  /** Featured weight (Notion "Rank" column); 0 = not featured. */
  rank: number;
  /** Public page, e.g. `/articles/first-light`. */
  href: string;
  /** Notion `last_edited_time`. */
  updated: string;
}

export interface ArticleLink {
  slug: string;
  title: string;
  href: string;
}

export interface TocEntry {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

export interface ArticleDetail extends ArticleSummary {
  /** Sanitised body HTML rendered from the Notion blocks. */
  html: string;
  toc: TocEntry[];
  readingMinutes: number;
  /** Newer article (by date). */
  previous: ArticleLink | null;
  /** Older article (by date). */
  next: ArticleLink | null;
}

export interface ArticleListResponse extends Paged {
  tag: string | null;
  articles: ArticleSummary[];
}

export interface TagCount {
  name: string;
  count: number;
}

export interface TagListResponse {
  tags: TagCount[];
}

export interface SearchResponse {
  query: string;
  total: number;
  articles: ArticleSummary[];
}

/* ── Site / status ──────────────────────────────────────────────────── */

export interface SiteResponse {
  name: string;
  email: string;
  about: string;
  intro: string;
  /** Language of `about` / `intro` (`?lang=en|zh-CN`, default `en`). */
  locale: 'en' | 'zh-CN';
  notionConfigured: boolean;
  /** True while the built-in demo articles are shown (Notion not configured). */
  demo: boolean;
  articles: number;
}

export interface SyncStatus {
  notion: boolean;
  demo: boolean;
  /** Epoch ms of the last successful sync (0 = never). */
  syncedAt: number;
  syncing: boolean;
  syncError: string | null;
  articles: number;
  /** Articles whose rendered body is cached locally. */
  bodiesCached: number;
}

export interface HealthResponse {
  ok: boolean;
  time: string;
  uptime: number;
  database: boolean;
  notion: boolean;
}

export interface AuthStatusResponse {
  configured: boolean;
}

export interface AuthResponse {
  ok: true;
}

export interface SyncStatusResponse {
  status: SyncStatus;
}

/* ── Admin: settings / sync / schema ────────────────────────────────── */

export type SettingKey =
  | 'site_name'
  | 'site_email'
  | 'site_about'
  | 'site_intro'
  | 'site_about_zh'
  | 'site_intro_zh'
  | 'NOTION_TOKEN'
  | 'NOTION_DATABASE_ID';

export type SettingValues = Record<SettingKey, string>;

export interface SettingsResponse {
  values: SettingValues & { hasToken: boolean };
  status: SyncStatus;
}

export interface SyncResponse {
  ok: boolean;
  /** Published articles after the sync. */
  synced: number;
  /** Bodies rendered during this request (`?bodies=1`). */
  bodies: number;
  status: SyncStatus;
}

/** The article fields the site reads from a Notion database. */
export type ArticleField = 'title' | 'slug' | 'date' | 'published' | 'tags' | 'excerpt' | 'cover' | 'rank';

export interface NotionField {
  name: string;
  type: string;
}

export interface FieldMapping {
  /** Notion column used for this field, or null when none matched. */
  property: string | null;
  type: string | null;
  /** Accepted Notion column types. */
  accepts: string[];
  required: boolean;
  /** What happens when the column is missing. */
  fallback: string;
}

export interface NotionSchemaResponse {
  database: { id: string; title: string };
  fields: NotionField[];
  mapping: Record<ArticleField, FieldMapping>;
  warnings: string[];
}

/* ── Uploads ────────────────────────────────────────────────────────── */

export interface UploadFile {
  name: string;
  size: number;
  mtime: number;
  url: string;
}

export interface UploadUsage {
  count: number;
  bytes: number;
  limitBytes: number;
  diskDir: string;
}

export interface UploadListResponse {
  files: UploadFile[];
  usage: UploadUsage;
}

export interface UploadResponse {
  ok: boolean;
  name: string;
  size: number;
  url: string;
}
