/**
 * Notion database pages → articles.
 *
 * Notion databases are hand-made, so column names vary. The title column is
 * found by type; every other field by a list of aliases *and* an accepted
 * column type, so a "Date" text column can never be misread as a date. The
 * defaults follow the conventions of the original astro-notion blog (Page,
 * Slug, Date, Published, Tags, Excerpt, FeaturedImage, Rank), so that
 * database works unchanged — but none of them except the title is required.
 */
import { cleanSlug, slugify } from '../../core/slug.ts';
import { safeUrl } from '../../core/safety.ts';
import { instant, newestFirst } from '../../core/order.ts';
import { truncate } from '../../core/text.ts';
import type { ArticleField, FieldMapping, NotionField, NotionSchemaResponse } from '../../shared/contracts.ts';
import { notionMediaPath } from '../../shared/routes.ts';
import type { ArticleRow } from '../db/articles.repository.ts';
import type { NotionDatabase, NotionFile, NotionPage, NotionProperty } from './client.ts';

interface FieldSpec {
  /** Normalised (lower-case, no spaces/underscores/dashes) column names, in priority order. */
  aliases: string[];
  accepts: string[];
  required: boolean;
  fallback: string;
}

export const FIELDS: Record<ArticleField, FieldSpec> = {
  title: { aliases: [], accepts: ['title'], required: true, fallback: 'pages without a title are skipped' },
  slug: { aliases: ['slug', 'url', 'path', '链接', '网址'], accepts: ['rich_text', 'formula'], required: false, fallback: 'derived from the title' },
  date: {
    aliases: ['date', 'publishdate', 'publisheddate', 'publishedat', 'published', 'pubdate', '发布日期', '发布时间', '日期', 'created'],
    accepts: ['date', 'created_time', 'formula'],
    required: false,
    fallback: "the page's creation time",
  },
  published: {
    aliases: ['published', 'publish', 'public', 'ispublished', 'status', '发布', '已发布', '公开', '状态'],
    accepts: ['checkbox', 'status', 'select', 'formula'],
    required: false,
    fallback: 'every page in the database is public',
  },
  tags: { aliases: ['tags', 'tag', 'topics', 'category', 'categories', '标签', '分类'], accepts: ['multi_select', 'select'], required: false, fallback: 'no tags' },
  excerpt: {
    aliases: ['excerpt', 'summary', 'description', 'abstract', 'subtitle', '摘要', '简介', '描述'],
    accepts: ['rich_text'],
    required: false,
    fallback: 'no excerpt',
  },
  cover: {
    aliases: ['featuredimage', 'cover', 'coverimage', 'image', 'thumbnail', 'poster', '封面', '题图'],
    accepts: ['files', 'url'],
    required: false,
    fallback: "the page's own cover, if any",
  },
  rank: { aliases: ['rank', 'featured', 'priority', 'pin', 'weight', '排序', '权重', '精选'], accepts: ['number', 'checkbox'], required: false, fallback: 'nothing is featured' },
};

const ARTICLE_FIELDS = Object.keys(FIELDS) as ArticleField[];

const normalise = (name: string) => name.toLowerCase().replace(/[\s_\-]+/g, '');

export type Mapping = Record<ArticleField, { property: string; type: string } | null>;

/** Pick the column for every field from `{ name → type }`. */
export function resolveMapping(columns: Record<string, string>): Mapping {
  const entries = Object.entries(columns);
  const taken = new Set<string>();
  const mapping = {} as Mapping;
  for (const field of ARTICLE_FIELDS) {
    const spec = FIELDS[field];
    let found: [string, string] | undefined;
    if (field === 'title') {
      found = entries.find(([, type]) => type === 'title');
    } else {
      for (const alias of spec.aliases) {
        found = entries.find(([name, type]) => !taken.has(name) && normalise(name) === alias && spec.accepts.includes(type));
        if (found) break;
      }
    }
    if (found) taken.add(found[0]);
    mapping[field] = found ? { property: found[0], type: found[1] } : null;
  }
  return mapping;
}

const columnsOf = (properties: Record<string, { type: string }>) =>
  Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, property?.type ?? '']));

/* ── value decoding ────────────────────────────────────────────────── */

type RichText = { plain_text?: string; text?: { content?: string } }[];
const plain = (items: RichText = []) => items.map((item) => item.plain_text ?? item.text?.content ?? '').join('');

const textOf = (property: NotionProperty | undefined): string => {
  if (!property) return '';
  if (property.type === 'title') return plain(property.title);
  if (property.type === 'rich_text') return plain(property.rich_text);
  if (property.type === 'url') return property.url ?? '';
  if (property.type === 'formula') return property.formula?.string ?? '';
  return '';
};

const dateOf = (property: NotionProperty | undefined): string | null => {
  if (!property) return null;
  if (property.type === 'date') return property.date?.start ?? null;
  if (property.type === 'created_time') return (property as { created_time?: string }).created_time ?? null;
  if (property.type === 'formula') return property.formula?.date?.start ?? null;
  return null;
};

const PUBLISHED_WORDS = /^(published|publish|public|live|done|yes|true|on|已发布|发布|公开|完成)$/i;

const publishedOf = (property: NotionProperty | undefined): boolean => {
  if (!property) return true;
  switch (property.type) {
    case 'checkbox':
      return property.checkbox === true;
    case 'status':
      return PUBLISHED_WORDS.test(property.status?.name?.trim() ?? '');
    case 'select':
      return PUBLISHED_WORDS.test(property.select?.name?.trim() ?? '');
    case 'formula':
      return property.formula?.boolean === true || PUBLISHED_WORDS.test(property.formula?.string ?? '');
    default:
      return true;
  }
};

const tagsOf = (property: NotionProperty | undefined): string[] => {
  const names =
    property?.type === 'multi_select'
      ? (property.multi_select ?? []).map((option) => option.name)
      : property?.type === 'select' && property.select
        ? [property.select.name]
        : [];
  return [...new Set(names.map((name) => String(name).trim()).filter(Boolean))];
};

const rankOf = (property: NotionProperty | undefined): number => {
  if (property?.type === 'number') return Number(property.number) || 0;
  if (property?.type === 'checkbox') return property.checkbox ? 1 : 0;
  return 0;
};

const compactId = (id: string) => id.replace(/-/g, '').toLowerCase();

export type FileSource = { kind: 'external'; url: string } | { kind: 'file'; url: string };

const fileSource = (file: NotionFile | null | undefined): FileSource | null => {
  if (!file) return null;
  if (file.type === 'external' && safeUrl(file.external?.url)) return { kind: 'external', url: file.external!.url! };
  if (file.type === 'file' && file.file?.url) return { kind: 'file', url: file.file.url };
  return null;
};

/** The cover image of a page: the mapped column first, then Notion's page cover. */
export function coverSource(page: NotionPage, mapping: Mapping = resolveMapping(columnsOf(page.properties))): FileSource | null {
  const column = mapping.cover ? page.properties[mapping.cover.property] : undefined;
  if (column?.type === 'files') {
    const image = (column.files ?? []).map(fileSource).find(Boolean);
    if (image) return image;
  } else if (column?.type === 'url' && safeUrl(column.url)) {
    return { kind: 'external', url: column.url! };
  }
  return fileSource(page.cover);
}

/* ── pages → rows ──────────────────────────────────────────────────── */

export interface MappedArticles {
  rows: ArticleRow[];
  /** Pages whose cover is a Notion-hosted file (served through the media proxy). */
  covers: { id: string; articleId: string }[];
  skipped: { id: string; reason: 'untitled' | 'unpublished' | 'scheduled' | 'archived' }[];
}

/**
 * Keep only what a visitor may see — published, not archived, publish date
 * reached — and give every article a unique slug. Slugs are assigned oldest
 * page first, so an existing URL never changes when a newer page reuses a title.
 */
export function toArticles(pages: NotionPage[], now = Date.now()): MappedArticles {
  const result: MappedArticles = { rows: [], covers: [], skipped: [] };
  const used = new Set<string>();
  const ordered = [...pages].sort((a, b) => instant(a.created_time) - instant(b.created_time) || a.id.localeCompare(b.id));

  for (const page of ordered) {
    if (page.archived || page.in_trash) {
      result.skipped.push({ id: page.id, reason: 'archived' });
      continue;
    }
    const properties = page.properties ?? {};
    const mapping = resolveMapping(columnsOf(properties));
    const field = (name: ArticleField) => (mapping[name] ? properties[mapping[name]!.property] : undefined);

    const title = textOf(field('title')).trim();
    if (!title) {
      result.skipped.push({ id: page.id, reason: 'untitled' });
      continue;
    }
    if (!publishedOf(field('published'))) {
      result.skipped.push({ id: page.id, reason: 'unpublished' });
      continue;
    }
    const date = dateOf(field('date')) ?? page.created_time;
    if (instant(date) > now) {
      result.skipped.push({ id: page.id, reason: 'scheduled' });
      continue;
    }

    const base = cleanSlug(textOf(field('slug'))) || slugify(title) || compactId(page.id).slice(0, 8);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);

    const cover = coverSource(page, mapping);
    if (cover?.kind === 'file') result.covers.push({ id: compactId(page.id), articleId: page.id });

    result.rows.push({
      id: page.id,
      slug,
      title,
      date,
      created: page.created_time,
      tags: tagsOf(field('tags')),
      excerpt: truncate(textOf(field('excerpt')), 500),
      cover: cover ? (cover.kind === 'file' ? notionMediaPath(page.id) : cover.url) : null,
      rank: rankOf(field('rank')),
      updated: page.last_edited_time,
    });
  }

  result.rows.sort(newestFirst);
  return result;
}

/* ── schema check (admin) ──────────────────────────────────────────── */

export function describeSchema(databaseId: string, database: NotionDatabase): NotionSchemaResponse {
  const columns = columnsOf(database.properties ?? {});
  const resolved = resolveMapping(columns);
  const fields: NotionField[] = Object.entries(columns).map(([name, type]) => ({ name, type }));
  const mapping = Object.fromEntries(
    ARTICLE_FIELDS.map((field) => {
      const spec = FIELDS[field];
      const value: FieldMapping = {
        property: resolved[field]?.property ?? null,
        type: resolved[field]?.type ?? null,
        accepts: spec.accepts,
        required: spec.required,
        fallback: spec.fallback,
      };
      return [field, value];
    }),
  ) as Record<ArticleField, FieldMapping>;

  const warnings: string[] = [];
  if (!resolved.title) warnings.push('No title column found — nothing can be published.');
  if (!resolved.published) warnings.push('No "Published" checkbox found: every page in this database will be public.');
  if (!resolved.date) warnings.push('No "Date" column found: articles are dated by creation time and cannot be scheduled.');
  for (const field of ARTICLE_FIELDS) {
    if (resolved[field] || field === 'title') continue;
    const spec = FIELDS[field];
    const misTyped = Object.entries(columns).find(([name, type]) => spec.aliases.includes(normalise(name)) && !spec.accepts.includes(type));
    if (misTyped) warnings.push(`Column "${misTyped[0]}" is a ${misTyped[1]} column; ${field} needs ${spec.accepts.join(' or ')}.`);
  }

  return { database: { id: databaseId, title: plain(database.title ?? []) || 'Untitled database' }, fields, mapping, warnings };
}

/* ── ids ───────────────────────────────────────────────────────────── */

export const PAGE_ID_PATTERN =
  /^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Notion ids are 32 hex chars, optionally dashed. Rejects path injection. */
export const isPageId = (value: unknown): value is string => typeof value === 'string' && PAGE_ID_PATTERN.test(value);

/**
 * Accept what people paste: a bare id, a dashed id, or a Notion URL such as
 * `https://www.notion.so/team/My-Blog-0123…cdef?v=…`. Returns 32 hex chars or
 * null. (In database URLs the `?v=` part is the *view* id, so it is ignored.)
 */
export function parseNotionId(input: unknown): string | null {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (PAGE_ID_PATTERN.test(text)) return compactId(text);
  let path = text;
  try {
    path = new URL(text).pathname;
  } catch {
    /* not a URL */
  }
  const match = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/i.exec(path.split('?')[0]!);
  return match ? compactId(match[1]!) : null;
}
