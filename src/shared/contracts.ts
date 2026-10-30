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
  | 'gone'
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

/** A topic as linked from an article: display name + URL slug (`/topics/<slug>`). */
export interface TopicRef {
  name: string;
  slug: string;
}

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
  /** The same topics as `tags`, with their page slugs (`/topics/<slug>`, `/zh-CN/topics/<slug>`). */
  topics: TopicRef[];
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
  /** URL slug of the topic page: `/topics/<slug>` (unique, the same in every language). */
  slug: string;
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
  /** Homepage facts row (empty when hidden). */
  facts: { key: string; value: string }[];
  /** Language of `about` / `intro` / `tagline` / `facts` (`?lang=en|zh-CN`, default `en`). */
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

/** Notion webhook subscription (/admin → Settings → Notion). */
export interface WebhookStatus {
  /** Full public URL to give Notion ('' until SITE_URL is set). */
  url: string;
  path: string;
  /** off = no token yet · pending = token received, waiting for the first signed event · active = verified. */
  state: 'off' | 'pending' | 'active';
  /** The token is pinned by NOTION_WEBHOOK_TOKEN. */
  fromEnv: boolean;
  /** Full token while pending (to paste into Notion); afterwards only a masked tail. */
  token: string | null;
  tokenAt: string | null;
  events: number;
  lastEventAt: string | null;
  lastType: string | null;
  rejected: number;
  lastRejectedAt: string | null;
}

export interface WebhookStatusResponse {
  webhook: WebhookStatus;
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
  | 'site_facts'
  | 'site_facts_zh'
  | 'tag_glossary'
  /** `on` / `off`: show the newsletter sign-up on public pages (home, articles, footer). */
  | 'newsletter_signup'
  | 'NOTION_TOKEN'
  | 'NOTION_DATABASE_ID';

export type SettingValues = Record<SettingKey, string>;

export interface SettingsResponse {
  values: SettingValues & { hasToken: boolean };
  status: SyncStatus;
}

/* ── Admin: overview (/admin → Overview) ────────────────────────────── */

/**
 * Something the admin may want to fix or know. Codes, not sentences, so the
 * admin shows them in its own language (src/ui/scripts/admin/i18n.ts).
 */
export type OverviewCheckCode =
  | 'notion-missing'
  | 'sync-error'
  | 'never-synced'
  | 'no-articles'
  | 'bodies-partial'
  | 'site-url-missing'
  | 'email-missing'
  | 'untagged'
  | 'more-sample'
  | 'webhook-pending';

export interface OverviewCheck {
  code: OverviewCheckCode;
  /** `warn` = the public site is affected; `info` = worth knowing. */
  level: 'warn' | 'info';
  /** How many things it concerns (untagged articles, uncached bodies…), when that applies. */
  count?: number;
}

export interface OverviewResponse {
  status: SyncStatus;
  site: {
    name: string;
    email: string;
    /** SITE_URL ('' when unset). */
    url: string;
  };
  articles: {
    total: number;
    /** Rank > 0 (shown under Featured, at most 10 on the homepage). */
    featured: number;
    topics: number;
    untagged: number;
    latest: { title: string; href: string; date: string } | null;
    /** Articles per year, newest year first ('' = undated). */
    years: { year: string; count: number }[];
  };
  more: { custom: boolean; updated: string | null; publications: number; channels: number };
  uploads: { count: number; bytes: number };
  checks: OverviewCheck[];
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

/* ── Newsletter ───────────────────────────────────────────────────────
 * Double opt-in: subscribe → confirmation email → confirm → active.
 * Public responses never reveal whether an address is already known. */

export type NewsletterStatus = 'pending' | 'active' | 'unsubscribed';

/** Public: is sign-up available on this deployment? (No configuration details.) */
export interface NewsletterAvailability {
  enabled: boolean;
}

export interface NewsletterSubscribeRequest {
  email: string;
  /** Interface language of the page; selects the email language. */
  locale?: string;
  /** Which entry point was used (`subscribe-page`, `article`, …). Free text, capped. */
  source?: string;
  /** Honeypot: hidden from people, filled by naive bots. Must be empty. */
  website?: string;
}

/** The same body whether the address is new, pending, active or unsubscribed. */
export interface NewsletterSubscribeResponse {
  status: 'check-inbox';
}

export interface NewsletterTokenRequest {
  token: string;
}

export interface NewsletterConfirmResponse {
  status: 'confirmed' | 'already-confirmed';
}

export interface NewsletterUnsubscribeResponse {
  status: 'unsubscribed';
}

export interface NewsletterCounts {
  total: number;
  active: number;
  pending: number;
  unsubscribed: number;
}

/** Admin view of one subscriber. Tokens, hashes and secrets never leave the server. */
export interface NewsletterSubscriber {
  id: number;
  email: string;
  status: NewsletterStatus;
  locale: string;
  source: string;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  /** Last delivery problem for this address (`send_failed`), cleared on success. */
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface NewsletterDelivery {
  /** Email provider configured and every required variable present. */
  configured: boolean;
  provider: string | null;
  /** Variables that are missing (names only). */
  missing: string[];
  storage: 'sqlite' | 'netlify-blobs';
  /** Emails per UTC day / calendar month (NEWSLETTER_DAILY_LIMIT / NEWSLETTER_MONTHLY_LIMIT). */
  dailyLimit: number;
  monthlyLimit: number;
  /** Counted here, raised to the provider's own figures when it reports them. */
  sentToday: number;
  sentThisMonth: number;
}

export interface NewsletterListResponse {
  subscribers: NewsletterSubscriber[];
  total: number;
  counts: NewsletterCounts;
  delivery: NewsletterDelivery;
}

export interface NewsletterResendResponse {
  status: 'sent';
}
