/**
 * Notion → domain mapping.
 *
 * Notion databases are hand-made, so column names vary between workspaces.
 * The mapper is deliberately forgiving: the title column is found by type, the
 * rest by alias, and every value is normalised into a plain object the rest of
 * the app can treat as "item data".
 */
import { slugify } from '../../core/slug.ts';
import { safeUrl } from '../../core/safety.ts';
import type { Kind } from '../../shared/kinds.ts';
import type { ItemRow } from '../db/items.repository.ts';
import type { NotionPage } from './client.ts';

/** Column aliases (lower-case). Add your own here if your database differs. */
export const ALIASES: Record<string, string[]> = {
  slug: ['slug'],
  date: ['date', 'published date', 'publishdate', 'created'],
  summary: ['summary', 'excerpt', 'description', 'abstract'],
  cover: ['cover', 'featuredimage', 'featured image', 'image', 'poster'],
  type: ['type', 'category', 'categories'],
  tags: ['tags', 'tag'],
  published: ['published', 'public', 'publish'],
};

export const PAGE_ID_PATTERN =
  /^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Notion page IDs are 32 hex chars, optionally dashed. Rejects path injection. */
export const isPageId = (value: unknown): value is string =>
  typeof value === 'string' && PAGE_ID_PATTERN.test(value);

type RichText = { plain_text?: string; text?: { content?: string } }[];

const plainText = (items: RichText = []): string => items.map((item) => item.plain_text ?? item.text?.content ?? '').join('');

interface NotionProperty {
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
  files?: { file?: { url?: string }; external?: { url?: string } }[];
}

/** Decode one Notion property into a JSON-friendly value. */
export function decodeProperty(property: NotionProperty | undefined): unknown {
  if (!property) return null;
  switch (property.type) {
    case 'title':
      return plainText(property.title);
    case 'rich_text':
      return plainText(property.rich_text);
    case 'select':
      return property.select?.name ?? null;
    case 'status':
      return property.status?.name ?? null;
    case 'number':
      return property.number ?? null;
    case 'checkbox':
      return property.checkbox ?? false;
    case 'url':
      return property.url ?? null;
    case 'date':
      return property.date?.start ?? null;
    case 'multi_select':
      return (property.multi_select ?? []).map((option) => option.name);
    case 'files':
      return property.files?.[0]?.file?.url ?? property.files?.[0]?.external?.url ?? null;
    default:
      return null;
  }
}

const firstPresent = (data: Record<string, unknown>, names: string[]): unknown =>
  names
    .map((name) => data[name])
    .find(
      (value) =>
        value !== undefined &&
        value !== null &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0),
    );

/** Apply aliases, coerce the published flag and derive year/date. */
export function normalizeData(raw: Record<string, unknown>, createdTime: string): Record<string, unknown> {
  const data = { ...raw };
  for (const [canonical, names] of Object.entries(ALIASES)) {
    const value = firstPresent(data, names);
    if (value !== undefined) data[canonical] = value;
  }
  if (Array.isArray(data.type)) data.type = data.type[0];
  data.type ??= Array.isArray(data.tags) ? (data.tags as unknown[])[0] : data.tags;
  if (typeof data.published === 'string') {
    data.published = /^(published|public|done|live|yes|true)$/i.test(data.published);
  }
  data.date ??= createdTime;
  const year = new Date(String(data.date)).getFullYear();
  if (data.year == null) data.year = Number.isNaN(year) ? null : year;
  return data;
}

const titleOf = (properties: Record<string, NotionProperty>): string =>
  String(
    Object.values(properties)
      .filter((property) => property?.type === 'title')
      .map((property) => plainText(property.title))
      .join('') || 'Untitled',
  );

/** Turn a database query into cache rows, keeping slugs unique per kind. */
export function toItems(kind: Kind, pages: NotionPage[]): ItemRow[] {
  const used = new Set<string>();
  const items: ItemRow[] = [];

  for (const page of pages) {
    const properties = page.properties as Record<string, NotionProperty>;
    const raw: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) raw[name.toLowerCase()] = decodeProperty(property);

    const data = normalizeData(raw, page.created_time);
    data.archived = Boolean(page.archived);
    if (data.published === false) continue; // column exists and is unchecked → not public

    const title = titleOf(properties);
    const base = String(data.slug || '').trim() || slugify(title) || page.id.slice(0, 8);

    // Two entries may share a title (and therefore a slug). Suffix the second
    // one instead of letting `getBySlug` silently pick a random row.
    let slug = slugify(base) || page.id.slice(0, 8);
    let suffix = 2;
    while (used.has(slug)) slug = `${slugify(base)}-${suffix++}`;
    used.add(slug);

    items.push({ id: page.id, kind, title, slug, data, updated: page.last_edited_time });
  }

  return items;
}

/** Presentation-safe summary fields (URLs are allow-listed). */
export const summaryFields = (item: ItemRow) => ({
  year: typeof item.data.year === 'number' ? item.data.year : null,
  summary: typeof item.data.summary === 'string' ? item.data.summary : null,
  type: typeof item.data.type === 'string' ? item.data.type : null,
  tags: Array.isArray(item.data.tags)
    ? (item.data.tags as unknown[]).map(String).filter(Boolean)
    : typeof item.data.tags === 'string'
      ? String(item.data.tags).split(',').map((tag) => tag.trim()).filter(Boolean)
      : [],
  cover: safeUrl(item.data.cover),
  url: safeUrl(item.data.url),
});
