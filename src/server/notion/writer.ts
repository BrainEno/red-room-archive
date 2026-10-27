/**
 * Writing back to Notion: create pages, patch properties, replace bodies.
 *
 * Every write maps form field names onto the *actual* database columns (by
 * name or alias) and encodes the value for that column's type. Unknown fields
 * are dropped rather than sent, because Notion rejects the whole request when
 * one property is malformed.
 */
import { markdownToBlocks, type NotionBlock } from '../../core/blocks.ts';
import { badRequest } from '../../core/errors.ts';
import type { Kind } from '../../shared/kinds.ts';
import type { NotionField } from '../../shared/contracts.ts';
import { ALIASES, isPageId } from './mapper.ts';
import { NotionClient, type NotionBlockPayload } from './client.ts';

export type NotionSchema = Record<string, { name: string; type: string; [key: string]: unknown }>;

const chunksOf = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const richText = (value: string) => [{ type: 'text', text: { content: value.slice(0, 2000) } }];

/** Encode a scalar for one Notion property type (each needs its own wrapper key). */
const encode = (type: string, value: unknown): Record<string, unknown> | null => {
  const text = String(value);
  switch (type) {
    case 'select':
      return { select: { name: text } };
    case 'status':
      return { status: { name: text } };
    case 'multi_select':
      return {
        multi_select: text
          .split(',')
          .map((name) => ({ name: name.trim() }))
          .filter((option) => option.name),
      };
    case 'number':
      return { number: Number(value) };
    case 'checkbox':
      return { checkbox: value === true || value === 'true' || value === 'on' || value === 1 };
    case 'url':
      return { url: text };
    case 'email':
      return { email: text };
    case 'phone_number':
      return { phone_number: text };
    case 'date':
      return { date: { start: text } };
    case 'rich_text':
      return { rich_text: richText(text) };
    case 'title':
      return { title: richText(text) };
    default:
      return null;
  }
};

/** Map a form payload onto the database columns, encoding each by type. */
export function buildProperties(schema: NotionSchema, fields: Record<string, unknown>): Record<string, unknown> {
  const names = Object.keys(schema);
  const titleName = names.find((name) => schema[name]?.type === 'title');
  const properties: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'title' || key === 'body' || value === null || value === undefined || value === '') continue;
    const lower = key.toLowerCase();
    const column =
      names.find((name) => name.toLowerCase() === lower) ??
      names.find((name) => (ALIASES[lower] ?? []).includes(name.toLowerCase()));
    if (!column) continue;
    const encoded = encode(schema[column]!.type, value);
    if (encoded) properties[column] = encoded;
  }

  if (fields.title != null && fields.title !== '' && titleName) {
    properties[titleName] = { title: richText(String(fields.title)) };
  }
  return properties;
}

/** Public shape of a database schema, used by /admin to build the form. */
export function toFields(schema: NotionSchema): NotionField[] {
  return Object.values(schema).map((property) => {
    const config = property[property.type] as { options?: { name: string }[] } | undefined;
    return {
      name: property.name,
      type: property.type,
      options: (config?.options ?? []).map((option) => option.name),
    };
  });
}

const requirePageId = (pageId: string) => {
  if (!isPageId(pageId)) throw badRequest('invalid Notion page id', { pageId });
};

export class NotionWriter {
  private readonly client: NotionClient;
  private readonly databases: Record<Kind, string | undefined>;

  constructor(client: NotionClient, databases: Record<Kind, string | undefined>) {
    this.client = client;
    this.databases = databases;
  }

  databaseId(kind: Kind): string {
    const id = this.databases[kind];
    if (!id) throw badRequest(`Notion is not configured for ${kind}`, { kind });
    return id;
  }

  async schema(kind: Kind): Promise<NotionSchema> {
    return (await this.client.database(this.databaseId(kind))).properties as NotionSchema;
  }

  async fields(kind: Kind): Promise<NotionField[]> {
    return toFields(await this.schema(kind));
  }

  async create(kind: Kind, fields: Record<string, unknown>) {
    const databaseId = this.databaseId(kind);
    const properties = buildProperties(await this.schema(kind), fields);
    const children = markdownToBlocks(String(fields.body ?? '')).slice(0, 100);
    return this.client.createPage({ parent: { database_id: databaseId }, properties, children });
  }

  async update(kind: Kind, pageId: string, fields: Record<string, unknown>) {
    requirePageId(pageId);
    const properties = buildProperties(await this.schema(kind), fields);
    const page = Object.keys(properties).length
      ? await this.client.updatePage(pageId, { properties })
      : await this.client.getPage(pageId);
    if (typeof fields.body === 'string') await this.replaceBody(pageId, fields.body);
    return page;
  }

  /** Notion only exposes archive (the page stays recoverable in the trash). */
  async archive(pageId: string) {
    requirePageId(pageId);
    return this.client.updatePage(pageId, { archived: true });
  }

  /** Replace the whole page body: archive existing blocks, append the new ones. */
  async replaceBody(pageId: string, markdown: string) {
    requirePageId(pageId);
    const existing = await this.children(pageId);
    for (const chunk of chunksOf(existing, 10)) {
      await Promise.all(chunk.map((block) => this.client.deleteBlock(block.id).catch(() => null)));
    }
    for (const chunk of chunksOf(markdownToBlocks(markdown), 100)) {
      await this.client.appendBlocks(pageId, chunk);
    }
  }

  /** Flatten a page body (two levels of nested blocks) into renderable blocks. */
  async bodyBlocks(pageId: string, depth = 0): Promise<NotionBlock[]> {
    const blocks = await this.children(pageId);
    if (depth >= 2) return blocks;
    const out: NotionBlock[] = [];
    for (const block of blocks) {
      if (!block.has_children) {
        out.push(block);
        continue;
      }
      const children = await this.bodyBlocks(block.id, depth + 1).catch(() => []);
      out.push({ ...block, children });
    }
    return out;
  }

  private async children(pageId: string): Promise<NotionBlockPayload[]> {
    const out: NotionBlockPayload[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.blockChildren(pageId, cursor);
      out.push(...page.results);
      cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
    } while (cursor);
    return out;
  }
}
