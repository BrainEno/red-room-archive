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
  /**
   * Tag display names in the requested language (`?lang=`, default `en`): one
   * name per topic, so `Fiction` and `小说` on the same article appear once.
   * Any of them works as a `?tag=` filter.
   */
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
  /** Stable topic id, the same in every language (e.g. `fiction` for Fiction / 小说). Usable as `?tag=`. */
  key: string;
  /** Display name in the requested language. */
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

/* ── More page (/more) ──────────────────────────────────────────────── */

/** Text in both interface languages; an empty side falls back to the other one on the page. */
export interface LocalizedText {
  en: string;
  'zh-CN': string;
}

/** One self-published book, as edited in /admin → More. */
export interface MorePublicationDoc {
  /** Stable id (for reordering in the editor); generated when missing. */
  id: string;
  title: LocalizedText;
  subtitle: LocalizedText;
  year: string;
  /** Printing / binding, e.g. “Risograph, two colours”. */
  format: LocalizedText;
  pages: number | null;
  /** Print run, e.g. “Edition of 100”. */
  edition: LocalizedText;
  size: LocalizedText;
  /** Image URL: `/uploads/…`, another site path, or https. '' = draw a typographic cover. */
  cover: string;
  /** Selected passage; a blank line starts a new paragraph. */
  excerpt: LocalizedText;
  excerptSource: LocalizedText;
  /** Shop / order page (http, https or mailto). '' = the button emails you instead. */
  link: string;
  linkLabel: LocalizedText;
}

/** A social account or other way to reach you. */
export interface MoreChannelDoc {
  id: string;
  /** Platform, e.g. 微信公众号 / WeChat Official Account. */
  name: LocalizedText;
  handle: string;
  href: string;
  /** QR code image URL ('' = none). */
  qr: string;
  note: LocalizedText;
}

/** The whole /more page, both languages. */
export interface MoreDocument {
  intro: LocalizedText;
  publications: MorePublicationDoc[];
  channels: MoreChannelDoc[];
}

/** GET /api/more/document (admin). */
export interface MoreDocumentResponse {
  document: MoreDocument;
  /** False while the built-in sample content (content/more.ts) is shown. */
  custom: boolean;
  /** ISO time of the last save, null for the built-in content. */
  updated: string | null;
}

/** A publication in one language (public). */
export interface MorePublication {
  id: string;
  title: string;
  subtitle?: string;
  year: string;
  format?: string;
  pages?: number;
  edition?: string;
  size?: string;
  cover?: string;
  excerpt: string[];
  excerptSource?: string;
  link?: { href: string; label?: string };
}

export interface MoreChannel {
  id: string;
  name: string;
  handle: string;
  href?: string;
  /** Image URL; `''` = an empty frame (built-in samples only); undefined = no QR. */
  qr?: string;
  note?: string;
}

/** GET /api/more?lang= — the page in one language. */
export interface MoreResponse {
  locale: 'en' | 'zh-CN';
  intro: string;
  publications: MorePublication[];
  channels: MoreChannel[];
}

/* ── Site / status ──────────────────────────────────────────────────── */

export interface SiteResponse {
  name: string;
  email: string;
  about: string;
  intro: string;
  tagline: string;
  /** Language of `about` / `intro` / `tagline` (`?lang=en|zh-CN`, default `en`). */
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
  | 'site_tagline'
  | 'site_tagline_zh'
  | 'tag_glossary'
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
  /** Pages that show this file (list endpoint only), e.g. `['more']`. */
  usedBy?: string[];
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
