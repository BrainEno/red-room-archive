/**
 * Minimal, read-only Notion REST client (API version 2022-06-28).
 *
 * Responsibilities: authentication header, timeouts, retries on rate limits
 * and transient errors, pagination, and turning transport/HTTP failures into
 * one `AppError`. Response bodies are logged, not forwarded — they can contain
 * database and workspace details.
 */
import { config } from '../config.ts';
import { upstreamError } from '../../core/errors.ts';

const NOTION_VERSION = '2022-06-28';
const MAX_RETRIES = 2;

export interface NotionPage {
  object?: 'page';
  id: string;
  url?: string;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  cover?: NotionFile | null;
  properties: Record<string, NotionProperty>;
}

export interface NotionFile {
  type?: 'file' | 'external' | string;
  name?: string;
  file?: { url?: string; expiry_time?: string };
  external?: { url?: string };
}

type RichText = { plain_text?: string; text?: { content?: string } }[];

export interface NotionProperty {
  id?: string;
  type: string;
  title?: RichText;
  rich_text?: RichText;
  select?: { name: string } | null;
  status?: { name: string } | null;
  number?: number | null;
  checkbox?: boolean;
  url?: string | null;
  date?: { start?: string } | null;
  multi_select?: { name: string }[];
  files?: NotionFile[];
  formula?: { type?: string; string?: string | null; number?: number | null; boolean?: boolean | null; date?: { start?: string } | null };
}

export interface NotionDatabase {
  id: string;
  title?: RichText;
  properties: Record<string, { id?: string; name: string; type: string }>;
}

export interface ListResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** Structural subset of a Notion block we consume. */
export interface NotionBlockPayload {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds from `Retry-After`, capped so one request never stalls a page for long. */
const retryDelay = (response: Response | undefined, attempt: number) => {
  const header = Number(response?.headers.get('retry-after'));
  const seconds = Number.isFinite(header) && header > 0 ? header : 0.5 * 2 ** attempt;
  return Math.min(seconds, 10) * 1000;
};

export class NotionClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(config.notionApiBase() + path, {
          ...init,
          signal: AbortSignal.timeout(config.notionTimeoutMs()),
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          },
        });
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await sleep(retryDelay(undefined, attempt));
          continue;
        }
        console.error('[notion] request failed', path, error);
        throw upstreamError('could not reach Notion');
      }

      // 429 = rate limited (≈3 requests/s per integration), 5xx = Notion hiccup.
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await response.body?.cancel().catch(() => undefined);
        await sleep(retryDelay(response, attempt));
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error('[notion]', response.status, path, body.slice(0, 800));
        throw upstreamError(
          response.status === 401
            ? 'Notion rejected the integration token'
            : response.status === 403 || response.status === 404
              ? 'Notion database or page not found — check the id and share the database with the integration'
              : response.status === 429
                ? 'Notion rate limit reached, try again shortly'
                : `Notion request failed (${response.status})`,
          { notionStatus: response.status },
        );
      }

      return (await response.json()) as T;
    }
  }

  /** Walk every page of a POST list endpoint. */
  async paginate<T>(path: string, body: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const page: ListResponse<T> = await this.request<ListResponse<T>>(path, {
        method: 'POST',
        body: JSON.stringify({ ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      out.push(...page.results);
      cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
    } while (cursor);
    return out;
  }

  /** Every page of a database. Filtering happens locally so any schema works. */
  async queryDatabase(databaseId: string): Promise<NotionPage[]> {
    return this.paginate<NotionPage>(`/databases/${databaseId}/query`);
  }

  async database(databaseId: string): Promise<NotionDatabase> {
    return this.request<NotionDatabase>(`/databases/${databaseId}`);
  }

  async page(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>(`/pages/${pageId}`);
  }

  async block(blockId: string): Promise<NotionBlockPayload> {
    return this.request<NotionBlockPayload>(`/blocks/${blockId}`);
  }

  /** All direct children of a block (follows the cursor). */
  async blockChildren(blockId: string): Promise<NotionBlockPayload[]> {
    const out: NotionBlockPayload[] = [];
    let cursor: string | undefined;
    do {
      const query = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await this.request<ListResponse<NotionBlockPayload>>(`/blocks/${blockId}/children?${query}`);
      out.push(...page.results);
      cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
    } while (cursor);
    return out;
  }
}
