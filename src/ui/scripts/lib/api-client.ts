/**
 * Typed browser client for the JSON API.
 *
 * Browser code never builds URLs or parses error bodies by hand — it calls
 * these functions, which share their types with the server through
 * `src/shared/contracts.ts`. Relative URLs only, so it works behind any proxy.
 */
import type { SiteProfileFile } from '../../../../public/profile-format.js';
import type {
  AnalyticsClearResponse,
  AnalyticsSettingsResponse,
  AnalyticsSummaryResponse,
  ApiErrorBody,
  ApiErrorCode,
  ArticleDetail,
  ArticleListResponse,
  AuthResponse,
  MoreDocument,
  MoreDocumentResponse,
  MoreResponse,
  NewsletterAvailability,
  NewsletterConfirmResponse,
  NewsletterListResponse,
  NewsletterResendResponse,
  NewsletterStatus,
  NewsletterSubscribeRequest,
  NewsletterSubscribeResponse,
  NewsletterUnsubscribeResponse,
  NotionSchemaResponse,
  WebhookStatusResponse,
  OverviewResponse,
  SearchResponse,
  SettingsResponse,
  SettingValues,
  SyncResponse,
  SyncStatusResponse,
  TagListResponse,
  UploadFile,
  UploadListResponse,
  UploadResponse,
} from '../../../shared/contracts.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.error || `request failed (${status})`);
    this.status = status;
    this.code = body.code ?? 'internal';
    this.details = body.details;
  }
}

/** Files above this size are streamed as a raw body instead of multipart. */
const RAW_UPLOAD_THRESHOLD = 8 * 1024 * 1024;

export interface ApiClientOptions {
  /** Returns the current bearer token ('' when logged out). */
  token?: () => string;
  /** Called on every 401 so the UI can return to the login screen. */
  onUnauthorized?: (error: ApiError) => void;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const token = options.token ?? (() => '');

  async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const auth = token();
    if (auth) headers.set('Authorization', `Bearer ${auth}`);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.json);
    }
    const response = await fetch(path, { ...init, headers, body });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as Partial<ApiErrorBody>;
      const error = new ApiError(response.status, data);
      if (response.status === 401) options.onUnauthorized?.(error);
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return (await response.json().catch(() => ({}))) as T;
  }

  /** Authenticated binary download (same error handling as `request`). */
  async function download(path: string): Promise<{ blob: Blob; filename: string }> {
    const headers = new Headers();
    const auth = token();
    if (auth) headers.set('Authorization', `Bearer ${auth}`);
    const response = await fetch(path, { headers });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as Partial<ApiErrorBody>;
      const error = new ApiError(response.status, data);
      if (response.status === 401) options.onUnauthorized?.(error);
      throw error;
    }
    const filename = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
    return { blob: await response.blob(), filename };
  }

  const q = (params: Record<string, string | number | boolean | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
    const text = search.toString();
    return text ? `?${text}` : '';
  };
  const seg = encodeURIComponent;

  return {
    auth: {
      login: (candidate: string) =>
        request<AuthResponse>('/api/auth', { method: 'POST', json: { token: candidate } }),
    },

    articles: {
      list: (query: { tag?: string; limit?: number; offset?: number } = {}) =>
        request<ArticleListResponse>(`/api/articles${q(query)}`),
      /** `refresh` re-fetches the body from Notion (admin only). */
      get: (slug: string, refresh = false) =>
        request<ArticleDetail>(`/api/articles/${seg(slug)}${q({ refresh: refresh ? 1 : undefined })}`),
      tags: () => request<TagListResponse>('/api/tags'),
    },

    overview: () => request<OverviewResponse>('/api/overview'),

    analytics: {
      summary: (days = 30) => request<AnalyticsSummaryResponse>(`/api/analytics/admin/summary${q({ days })}`),
      update: (enabled: boolean) => request<AnalyticsSettingsResponse>('/api/analytics/admin/settings', { method: 'PATCH', json: { enabled } }),
      clear: () => request<AnalyticsClearResponse>('/api/analytics/admin/data', { method: 'DELETE' }),
      exportCsv: (days = 30) => download(`/api/analytics/admin/export${q({ days })}`),
    },

    notion: {
      schema: () => request<NotionSchemaResponse>('/api/notion/schema'),
      webhook: () => request<WebhookStatusResponse>('/api/webhooks/notion'),
      resetWebhook: () => request<WebhookStatusResponse>('/api/webhooks/notion', { method: 'DELETE' }),
    },

    uploads: {
      list: () => request<UploadListResponse>('/api/uploads'),
      /** Small files use multipart; large ones stream as the raw body. */
      upload: (file: File, opts: { asModel?: boolean } = {}) => {
        const as = opts.asModel ? 'model' : undefined;
        if (file.size > RAW_UPLOAD_THRESHOLD) {
          return request<UploadResponse>(`/api/uploads${q({ name: file.name, as })}`, {
            method: 'POST',
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
          });
        }
        const form = new FormData();
        form.append('file', file);
        return request<UploadResponse>(`/api/uploads${q({ as })}`, { method: 'POST', body: form });
      },
      rename: (name: string, next: string) =>
        request<UploadFile>(`/api/uploads/${seg(name)}`, { method: 'PATCH', json: { name: next } }),
      remove: (name: string) => request<void>(`/api/uploads/${seg(name)}`, { method: 'DELETE' }),
    },

    more: {
      /** Public, one language. */
      get: (lang?: string) => request<MoreResponse>(`/api/more${q({ lang })}`),
      document: () => request<MoreDocumentResponse>('/api/more/document'),
      save: (document: MoreDocument) => request<MoreDocumentResponse>('/api/more/document', { method: 'PUT', json: document }),
      reset: () => request<MoreDocumentResponse>('/api/more/document', { method: 'DELETE' }),
    },

    settings: {
      get: () => request<SettingsResponse>('/api/settings'),
      /** ZIP of profile + More page + its uploads + statue, for static builds. */
      contentBundle: () => download('/api/content-bundle'),
      importProfile: (profile: SiteProfileFile) => request<SettingsResponse>('/api/settings/profile', { method: 'POST', json: profile }),
      update: (values: Partial<SettingValues>) =>
        request<SettingsResponse>('/api/settings', { method: 'PATCH', json: values }),
    },

    sync: {
      status: () => request<SyncStatusResponse>('/api/sync'),
      run: (opts: { full?: boolean; bodies?: boolean } = {}) =>
        request<SyncResponse>(`/api/sync${q({ full: opts.full ? 1 : undefined, bodies: opts.bodies ? 1 : undefined })}`, { method: 'POST' }),
    },

    search: (query: string, limit = 20) => request<SearchResponse>(`/api/search${q({ q: query, limit })}`),

    /** Served by the Node server or, on the static deployment, by the Netlify Function. */
    newsletter: {
      status: () => request<NewsletterAvailability>('/api/newsletter/status'),
      subscribe: (body: NewsletterSubscribeRequest) =>
        request<NewsletterSubscribeResponse>('/api/newsletter/subscribe', { method: 'POST', json: body }),
      confirm: (token: string) => request<NewsletterConfirmResponse>('/api/newsletter/confirm', { method: 'POST', json: { token } }),
      unsubscribe: (token: string) => request<NewsletterUnsubscribeResponse>('/api/newsletter/unsubscribe', { method: 'POST', json: { token } }),
      list: (query: { q?: string; status?: NewsletterStatus | ''; limit?: number; offset?: number } = {}) =>
        request<NewsletterListResponse>(`/api/newsletter/admin/subscribers${q(query)}`),
      exportCsv: (query: { q?: string; status?: NewsletterStatus | '' } = {}) => download(`/api/newsletter/admin/export${q(query)}`),
      resend: (id: number) => request<NewsletterResendResponse>(`/api/newsletter/admin/subscribers/${id}/resend`, { method: 'POST' }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
