/**
 * Typed browser client for the JSON API.
 *
 * Browser code never builds URLs or parses error bodies by hand — it calls
 * these functions, which share their types with the server through
 * `src/shared/contracts.ts`. Relative URLs only, so it works behind any proxy.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  AuthResponse,
  BackupFile,
  BackupListResponse,
  ImportConflict,
  ImportReport,
  ItemDetail,
  ItemListResponse,
  MarkdownPreviewResponse,
  NotionSchemaResponse,
  NotionWriteBody,
  NotionWriteResponse,
  PostDetail,
  PostListResponse,
  RevisionDetail,
  RevisionListResponse,
  SearchResponse,
  SettingsResponse,
  SettingValues,
  SyncResponse,
  SyncStatusResponse,
  TrashResponse,
  UploadFile,
  UploadListResponse,
  UploadResponse,
} from '../../../shared/contracts.ts';
import type { Kind } from '../../../shared/kinds.ts';

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
export const RAW_UPLOAD_THRESHOLD = 8 * 1024 * 1024;

export interface ApiClientOptions {
  /** Returns the current bearer token ('' when logged out). */
  token?: () => string;
  /** Called on every 401 so the UI can return to the login screen. */
  onUnauthorized?: (error: ApiError) => void;
}

/** A downloaded file (authenticated downloads cannot use a plain link). */
export interface Download {
  blob: Blob;
  filename: string;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const token = options.token ?? (() => '');

  async function send(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
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
    return response;
  }

  async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const response = await send(path, init);
    if (response.status === 204) return undefined as T;
    return (await response.json().catch(() => ({}))) as T;
  }

  async function download(path: string, fallbackName: string): Promise<Download> {
    const response = await send(path);
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
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

    items: {
      list: (kind: Kind, page: { limit?: number; offset?: number } = {}) =>
        request<ItemListResponse>(`/api/items/${kind}${q(page)}`),
      get: (kind: Kind, slug: string, refresh = false) =>
        request<ItemDetail>(`/api/items/${kind}/${seg(slug)}${q({ refresh: refresh ? 1 : undefined })}`),
    },

    notion: {
      schema: (kind: Kind) => request<NotionSchemaResponse>(`/api/notion/${kind}`),
      create: (kind: Kind, body: NotionWriteBody) =>
        request<NotionWriteResponse>(`/api/notion/${kind}`, { method: 'POST', json: body }),
      update: (kind: Kind, id: string, body: NotionWriteBody) =>
        request<NotionWriteResponse>(`/api/notion/${kind}/${seg(id)}`, { method: 'PATCH', json: body }),
      archive: (kind: Kind, id: string) =>
        request<NotionWriteResponse>(`/api/notion/${kind}/${seg(id)}`, { method: 'DELETE' }),
    },

    posts: {
      list: (query: { drafts?: boolean; tag?: string; limit?: number; offset?: number } = {}) =>
        request<PostListResponse>(`/api/posts${q({ ...query, drafts: query.drafts ? 1 : undefined })}`),
      get: (slug: string, html = false) =>
        request<PostDetail>(`/api/posts/${seg(slug)}${q({ format: html ? 'html' : undefined })}`),
      create: (body: Partial<PostDetail> & { body: string; title: string }) =>
        request<PostDetail>('/api/posts', { method: 'POST', json: body }),
      update: (slug: string, body: Record<string, unknown>) =>
        request<PostDetail>(`/api/posts/${seg(slug)}`, { method: 'PATCH', json: body }),
      remove: (slug: string) => request<void>(`/api/posts/${seg(slug)}`, { method: 'DELETE' }),
      preview: (markdown: string) =>
        request<MarkdownPreviewResponse>('/api/markdown', { method: 'POST', json: { markdown } }),
      revisions: (slug: string) => request<RevisionListResponse>(`/api/posts/${seg(slug)}/revisions`),
      revision: (slug: string, id: number) => request<RevisionDetail>(`/api/posts/${seg(slug)}/revisions/${id}`),
      restore: (slug: string, id: number) =>
        request<PostDetail>(`/api/posts/${seg(slug)}/revisions/${id}/restore`, { method: 'POST' }),
    },

    trash: {
      list: () => request<TrashResponse>('/api/trash'),
      purge: (slug: string) => request<void>(`/api/trash/${seg(slug)}`, { method: 'DELETE' }),
    },

    backups: {
      list: () => request<BackupListResponse>('/api/backups'),
      create: () => request<BackupFile>('/api/backups', { method: 'POST' }),
      download: (name: string) => download(`/api/backups/${seg(name)}`, name),
      remove: (name: string) => request<void>(`/api/backups/${seg(name)}`, { method: 'DELETE' }),
    },

    data: {
      export: () => download('/api/export', 'red-room-archive.zip'),
      import: (file: File, opts: { onConflict?: ImportConflict; dryRun?: boolean; settings?: boolean } = {}) =>
        request<ImportReport>(
          `/api/import${q({
            name: file.name,
            onConflict: opts.onConflict,
            dryRun: opts.dryRun ? 1 : undefined,
            settings: opts.settings ? 1 : undefined,
          })}`,
          { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } },
        ),
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

    settings: {
      get: () => request<SettingsResponse>('/api/settings'),
      update: (values: Partial<SettingValues>) =>
        request<SettingsResponse>('/api/settings', { method: 'PATCH', json: values }),
    },

    sync: {
      status: () => request<SyncStatusResponse>('/api/sync'),
      run: (kind?: Kind) => request<SyncResponse>(`/api/sync${q({ kind })}`, { method: 'POST' }),
    },

    search: (query: string, limit = 20) => request<SearchResponse>(`/api/search${q({ q: query, limit })}`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
