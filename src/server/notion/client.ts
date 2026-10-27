/**
 * Minimal Notion REST client (API version 2022-06-28).
 *
 * Responsibilities: authentication header, timeouts, pagination and turning
 * transport/HTTP failures into one `AppError`. Response bodies are logged, not
 * forwarded — they can contain database and workspace details.
 */
import { config } from '../config.ts';
import { upstreamError } from '../../core/errors.ts';

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionPage {
  id: string;
  url?: string;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  properties: Record<string, unknown>;
}

export interface ListResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export class NotionClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(API + path, {
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
      console.error('[notion] request failed', path, error);
      throw upstreamError('could not reach Notion');
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[notion]', response.status, path, body.slice(0, 800));
      // 429 means "slow down"; everything else is either our bug or Notion's.
      throw upstreamError(
        response.status === 401 || response.status === 403
          ? 'Notion rejected the integration token or permissions'
          : response.status === 404
            ? 'Notion database or page not found — check the database IDs'
            : `Notion request failed (${response.status})`,
        { notionStatus: response.status },
      );
    }

    return (await response.json()) as T;
  }

  /** Walk every page of a list endpoint. */
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

  async queryDatabase(databaseId: string): Promise<NotionPage[]> {
    return this.paginate<NotionPage>(`/databases/${databaseId}/query`);
  }

  async database(databaseId: string): Promise<{ properties: Record<string, { name: string; type: string }> }> {
    return this.request(`/databases/${databaseId}`);
  }

  async blockChildren(blockId: string, cursor?: string): Promise<ListResponse<NotionBlockPayload>> {
    const query = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
    return this.request<ListResponse<NotionBlockPayload>>(`/blocks/${blockId}/children?${query}`);
  }

  async createPage(body: Record<string, unknown>): Promise<NotionPage> {
    return this.request<NotionPage>('/pages', { method: 'POST', body: JSON.stringify(body) });
  }

  async updatePage(pageId: string, body: Record<string, unknown>): Promise<NotionPage> {
    return this.request<NotionPage>(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async getPage(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>(`/pages/${pageId}`);
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.request(`/blocks/${blockId}`, { method: 'DELETE' });
  }

  async appendBlocks(blockId: string, children: unknown[]): Promise<void> {
    await this.request(`/blocks/${blockId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children }),
    });
  }
}

/** Structural subset of a Notion block we consume. */
export interface NotionBlockPayload {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

export { API as NOTION_API };
