/**
 * Wire contracts between the HTTP API and every client (Astro pages and the
 * browser-side admin). Type-only: this module must stay free of runtime
 * imports so it can be used on the server and in the browser alike.
 */
import type { Kind } from './kinds.ts';

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

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export interface Paged {
  total: number;
  limit: number;
  offset: number;
}

/* ── Archive entries (Notion-backed) ────────────────────────────────── */

export interface ItemSummary {
  id: string;
  kind: Kind;
  title: string;
  slug: string;
  year: number | null;
  summary: string | null;
  type: string | null;
  tags: string[];
  cover: string | null;
  url: string | null;
  href: string;
  updated: string;
  /** Raw mapped Notion properties, lower-cased column names. */
  data: Record<string, unknown>;
}

export interface ItemDetail extends ItemSummary {
  /** Sanitised HTML rendered from the Notion page body. */
  bodyHtml: string;
}

export interface ItemListResponse extends Paged {
  kind: Kind;
  items: ItemSummary[];
}

export interface ArchiveResponse {
  items: Record<Kind, ItemSummary[]>;
  counts: Record<Kind, number>;
}

/* ── Posts (SQLite-backed journal) ──────────────────────────────────── */

export interface PostSummary {
  slug: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
  published: boolean;
  excerpt: string;
  href: string;
}

export interface PostDetail extends PostSummary {
  markdown: string;
  html?: string;
}

export interface PostListResponse extends Paged {
  posts: PostSummary[];
  draftsIncluded: boolean;
}

export interface SearchResponse {
  query: string;
  total: number;
  posts: PostSummary[];
  items: ItemSummary[];
}

/* ── Site + status ──────────────────────────────────────────────────── */

export interface SiteResponse {
  name: string;
  email: string;
  about: string;
  intro: string;
  notionConfigured: boolean;
  counts: Record<Kind, number>;
}

export interface SyncStatus {
  notion: boolean;
  databases: Record<Kind, boolean>;
  syncedAt: number;
  syncing: boolean;
  syncError: string | null;
  counts: Record<Kind, number>;
  posts: number;
  drafts: number;
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

/* ── Admin: settings, sync, Notion, uploads ─────────────────────────── */

export type SettingKey =
  | 'site_name'
  | 'site_email'
  | 'site_about'
  | 'site_intro'
  | 'NOTION_TOKEN'
  | 'NOTION_DB_WRITING'
  | 'NOTION_DB_FILMS'
  | 'NOTION_DB_MUSIC';

export type SettingValues = Record<SettingKey, string>;

export interface SettingsResponse {
  values: SettingValues & { hasToken: boolean };
  status: SyncStatus;
}

export interface SyncResponse {
  ok: boolean;
  /** Number of entries refreshed, per kind. */
  synced: Partial<Record<Kind, number>>;
  status: SyncStatus;
}

export interface NotionField {
  name: string;
  type: string;
  options: string[];
}

export interface NotionSchemaResponse {
  kind: Kind;
  fields: NotionField[];
}

export type NotionWriteBody = Record<string, unknown> & { title?: string; body?: string };

export interface NotionWriteResponse {
  ok: boolean;
  id: string;
  url?: string;
  updated?: boolean;
  archived?: boolean;
}

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

export interface MarkdownPreviewResponse {
  html: string;
}
