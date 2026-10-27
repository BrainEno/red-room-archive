// 直接调用 Notion REST API（固定 2022-06-28 版本），不依赖 SDK。
import { blocksToHtml, markdownToBlocks, type NotionBlock } from './blocks.ts';
import { readEnv } from './env.ts';
import { esc, safeUrl } from './safety.ts';
import { slugify } from './slug.ts';

export { esc, slugify };
export type { NotionBlock };
export type Kind = 'writing' | 'films' | 'music';
export const KINDS: Kind[] = ['writing', 'films', 'music'];
export const isKind = (k: unknown): k is Kind => KINDS.includes(k as Kind);
/** Notion 页面 ID（32 位或带连字符的 UUID），防止把任意路径拼进 API 请求。 */
export const isPageId = (id: unknown): id is string =>
  typeof id === 'string' && /^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id);
export interface Item { id: string; kind: Kind; title: string; slug: string; data: Record<string, any>; updated: string; body?: string | null }

/**
 * 读取环境变量：process.env → import.meta.env（构建时注入）→ 运行目录的 .env。
 * 具体顺序与原因见 lib/env.ts。
 */
export const raw = (k: string): string | undefined => readEnv(k);
let resolve = raw;   // db.ts 初始化后改为：后台设置优先，其次环境变量
export const setResolver = (f: (k: string) => string | undefined) => { resolve = f; };
export const env = (k: string): string | undefined => resolve(k);

const DB: Record<Kind, string> = { writing: 'NOTION_DB_WRITING', films: 'NOTION_DB_FILMS', music: 'NOTION_DB_MUSIC' };
export const notionReady = (k?: Kind) => !!env('NOTION_TOKEN') && (k ? !!env(DB[k]) : Object.values(DB).some((n) => !!env(n)));

// 列名别名（小写）：兼容 astro-notion 系博客模板常见列名。标题列按“类型”识别，叫 Name / Page / Title 都行。
export const ALIASES: Record<string, string[]> = {
  slug: ['slug'], date: ['date', 'published date', 'publishdate', 'created'],
  summary: ['summary', 'excerpt', 'description', 'abstract'],
  cover: ['cover', 'featuredimage', 'featured image', 'image', 'poster'],
  type: ['type', 'category', 'categories'], tags: ['tags', 'tag'], published: ['published', 'public', 'publish'],
};
const pick = (d: Record<string, any>, names: string[]) => names.map((n) => d[n]).find((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
function normalize(d: Record<string, any>, created: string) {
  for (const [k, names] of Object.entries(ALIASES)) { const v = pick(d, names); if (v !== undefined) d[k] = v; }
  if (Array.isArray(d.type)) d.type = d.type[0];
  d.type ??= Array.isArray(d.tags) ? d.tags[0] : d.tags;
  if (typeof d.published === 'string') d.published = /^(published|public|done|live|yes|true)$/i.test(d.published);
  d.date ??= created;
  const y = new Date(d.date).getFullYear(); if (d.year == null) d.year = isNaN(y) ? null : y;
}

const API = 'https://api.notion.com/v1';
async function nf(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, {
    ...init, headers: { Authorization: `Bearer ${env('NOTION_TOKEN')}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`Notion ${r.status}: ${await r.text()}`);
  return r.json() as Promise<any>;
}
const txt = (a: any[] = []) => a.map((t) => t.plain_text).join('');
const val = (p: any): any => {
  switch (p?.type) {
    case 'title': return txt(p.title); case 'rich_text': return txt(p.rich_text);
    case 'select': return p.select?.name ?? null; case 'status': return p.status?.name ?? null;
    case 'number': return p.number; case 'checkbox': return p.checkbox; case 'url': return p.url;
    case 'date': return p.date?.start ?? null; case 'multi_select': return p.multi_select.map((s: any) => s.name);
    case 'files': return p.files[0]?.file?.url ?? p.files[0]?.external?.url ?? null;
    default: return null;
  }
};

/** 读取整个数据库（自动翻页）。属性名统一转小写作为 data 的键。 */
export async function fetchKind(kind: Kind): Promise<Item[]> {
  const out: Item[] = []; let cursor: string | undefined;
  do {
    const r = await nf(`/databases/${env(DB[kind])}/query`, { method: 'POST', body: JSON.stringify({ page_size: 100, start_cursor: cursor }) });
    for (const pg of r.results) {
      const data: Record<string, any> = {};
      for (const [k, p] of Object.entries<any>(pg.properties)) data[k.toLowerCase()] = val(p);
      normalize(data, pg.created_time);
      data.archived = !!pg.archived;
      if (data.published === false) continue; // 存在 Published 列且未勾选 → 不公开
      const title = val(Object.values<any>(pg.properties).find((p) => p.type === 'title')) || 'Untitled';
      out.push({ id: pg.id, kind, title, slug: data.slug || slugify(title) || pg.id.slice(0, 8), data, updated: pg.last_edited_time });
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** 读取页面的一层子块（自动翻页）。 */
async function fetchChildren(pageId: string): Promise<NotionBlock[]> {
  const out: NotionBlock[] = []; let cursor: string | undefined;
  do {
    const r = await nf(`/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** 展开带子块的容器（toggle / list / quote 的缩进内容），最多两层，避免无限请求。 */
async function withChildren(blocks: NotionBlock[], depth = 0): Promise<NotionBlock[]> {
  if (depth >= 2) return blocks;
  const out: NotionBlock[] = [];
  for (const b of blocks) {
    if (b.has_children) {
      const children = await fetchChildren(b.id!).catch(() => []);
      out.push({ ...b, children: await withChildren(children, depth + 1) });
    } else out.push(b);
  }
  return out;
}

/** 页面正文 → 安全 HTML（支持标题、列表、引用、代码、图片/视频/音频/附件、书签、待办、折叠）。 */
export async function fetchBody(pageId: string): Promise<string> {
  return blocksToHtml(await withChildren(await fetchChildren(pageId)));
}

/** 读取数据库的列定义，供 /admin 动态生成表单 */
export async function getSchema(kind: Kind) {
  const r = await nf(`/databases/${env(DB[kind])}`);
  return Object.values<any>(r.properties).map((p) => ({ name: p.name as string, type: p.type as string, options: (p[p.type]?.options ?? []).map((o: any) => o.name) }));
}

/**
 * 按 Notion 属性类型编码值。注意每种类型都必须包一层同名键，
 * 例如 select → { select: { name } }，写错时 Notion 会返回 400。
 */
const encode = (t: string, v: any): any => ({
  select: { select: { name: String(v) } },
  status: { status: { name: String(v) } },
  multi_select: { multi_select: String(v).split(',').map((x) => ({ name: x.trim() })).filter((x) => x.name) },
  number: { number: Number(v) },
  checkbox: { checkbox: v === true || v === 'true' || v === 'on' },
  url: { url: String(v) },
  email: { email: String(v) },
  phone_number: { phone_number: String(v) },
  date: { date: { start: String(v) } },
  rich_text: { rich_text: [{ text: { content: String(v).slice(0, 2000) } }] },
} as any)[t];

type Schema = Record<string, { type: string }>;

/** 把表单字段映射到数据库的实际列名，并按列类型编码。create 与 update 共用。 */
function buildProperties(props: Schema, f: Record<string, any>) {
  const names = Object.keys(props);
  const titleName = names.find((n) => props[n].type === 'title');
  const properties: Record<string, any> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'title' || k === 'body' || v == null || v === '') continue;
    const n = names.find((x) => x.toLowerCase() === k.toLowerCase())
      ?? names.find((x) => (ALIASES[k.toLowerCase()] ?? []).includes(x.toLowerCase()));
    if (!n) continue;                                   // 未匹配到列就跳过，不向 Notion 发送非法属性
    if (props[n].type === 'title') { properties[n] = { title: [{ text: { content: String(v).slice(0, 2000) } }] }; continue; }
    const e = encode(props[n].type, v);
    if (e) properties[n] = e;
  }
  if (f.title != null && f.title !== '' && titleName) {
    properties[titleName] = { title: [{ text: { content: String(f.title).slice(0, 2000) } }] };
  }
  return properties;
}

/** 新建记录：字段名按“列名/别名”匹配你的数据库，值按列的实际类型编码；body 写成页面正文（Markdown 子集）。 */
export async function createItem(kind: Kind, f: Record<string, any>) {
  const props = (await nf(`/databases/${env(DB[kind])}`)).properties as Schema;
  const properties = buildProperties(props, f);
  const children = markdownToBlocks(String(f.body ?? '')).slice(0, 100);
  return nf('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: env(DB[kind]) }, properties, children }) });
}

/** 更新已有页面：只发送表单里给的属性；body 存在时替换整页正文。 */
export async function updateItem(kind: Kind, pageId: string, f: Record<string, any>) {
  if (!isPageId(pageId)) throw new Error('invalid page id');
  const props = (await nf(`/databases/${env(DB[kind])}`)).properties as Schema;
  const properties = buildProperties(props, f);
  const page = Object.keys(properties).length
    ? await nf(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) })
    : await nf(`/pages/${pageId}`);
  if (typeof f.body === 'string') await replaceBody(pageId, f.body);
  return page;
}

/** 删除（归档）页面。Notion API 只能归档，回收站里仍可恢复。 */
export function archiveItem(pageId: string) {
  if (!isPageId(pageId)) throw new Error('invalid page id');
  return nf(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) });
}

/** 用新的 Markdown 正文替换整页：逐块归档旧内容，再分片追加新内容。 */
export async function replaceBody(pageId: string, source: string) {
  if (!isPageId(pageId)) throw new Error('invalid page id');
  const old = await fetchChildren(pageId);
  for (const chunk of chunksOf(old, 10)) {
    await Promise.all(chunk.map((b) => nf(`/blocks/${b.id}`, { method: 'DELETE' }).catch(() => null)));
  }
  for (const chunk of chunksOf(markdownToBlocks(source), 100)) {
    await nf(`/blocks/${pageId}/children`, { method: 'PATCH', body: JSON.stringify({ children: chunk }) });
  }
}

function chunksOf<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** 单条记录的摘要（不含正文），供 /api/items/<kind>/<slug> 使用。 */
export function itemSummary(i: Item) {
  return {
    id: i.id, kind: i.kind, title: i.title, slug: i.slug, updated: i.updated,
    year: i.data.year ?? null,
    summary: i.data.summary ?? null,
    cover: safeUrl(i.data.cover) ?? null,
    url: safeUrl(i.data.url) ?? null,
    data: i.data,
  };
}
