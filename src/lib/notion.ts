// 直接调用 Notion REST API（固定 2022-06-28 版本），不依赖 SDK。
export const raw = (k: string): string | undefined => (import.meta.env as any)[k] ?? process.env[k];
let resolve = raw;   // db.ts 初始化后改为：后台设置优先，其次环境变量
export const setResolver = (f: (k: string) => string | undefined) => { resolve = f; };
export const env = (k: string): string | undefined => resolve(k);
export type Kind = 'writing' | 'films' | 'music';
export interface Item { id: string; kind: Kind; title: string; slug: string; data: Record<string, any>; updated: string; body?: string | null }
const DB: Record<Kind, string> = { writing: 'NOTION_DB_WRITING', films: 'NOTION_DB_FILMS', music: 'NOTION_DB_MUSIC' };
export const notionReady = (k?: Kind) => !!env('NOTION_TOKEN') && (k ? !!env(DB[k]) : Object.values(DB).some((n) => !!env(n)));
export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

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

async function nf(path: string, init: RequestInit = {}) {
  const r = await fetch('https://api.notion.com/v1' + path, {
    ...init, headers: { Authorization: `Bearer ${env('NOTION_TOKEN')}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`Notion ${r.status}: ${await r.text()}`);
  return r.json();
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
      if (data.published === false) continue; // 存在 Published 列且未勾选 → 不公开
      const title = val(Object.values<any>(pg.properties).find((p) => p.type === 'title')) || 'Untitled';
      out.push({ id: pg.id, kind, title, slug: data.slug || slugify(title) || pg.id.slice(0, 8), data, updated: pg.last_edited_time });
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** 页面正文 → 简单 HTML（段落内的软换行由 CSS pre-wrap 保留，适合诗歌）。 */
export async function fetchBody(pageId: string): Promise<string> {
  let html = '', cursor: string | undefined;
  do {
    const r = await nf(`/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of r.results) {
      const s = esc(txt(b[b.type]?.rich_text));
      html += /^heading_/.test(b.type) ? `<h3>${s}</h3>` : b.type === 'quote' ? `<blockquote>${s}</blockquote>`
        : /list_item$/.test(b.type) ? `<p>– ${s}</p>` : b.type === 'divider' ? '<hr>' : b.type === 'paragraph' ? `<p>${s || '&nbsp;'}</p>` : '';
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return html;
}

/** 读取数据库的列定义，供 /admin 动态生成表单 */
export async function getSchema(kind: Kind) {
  const r = await nf(`/databases/${env(DB[kind])}`);
  return Object.values<any>(r.properties).map((p) => ({ name: p.name as string, type: p.type as string, options: (p[p.type]?.options ?? []).map((o: any) => o.name) }));
}

const encode = (t: string, v: any): any => ({
  select: { name: String(v) }, status: { name: String(v) },
  multi_select: { multi_select: String(v).split(',').map((x) => ({ name: x.trim() })).filter((x) => x.name) },
  number: { number: Number(v) }, checkbox: { checkbox: v === true || v === 'true' || v === 'on' }, url: { url: String(v) },
  date: { date: { start: String(v) } }, rich_text: { rich_text: [{ text: { content: String(v).slice(0, 2000) } }] },
} as any)[t];

/** 新建记录：字段名按“列名/别名”匹配你的数据库，值按列的实际类型编码；body 写成页面正文（空行分段）。 */
export async function createItem(kind: Kind, f: Record<string, any>) {
  const props = (await nf(`/databases/${env(DB[kind])}`)).properties as Record<string, { type: string }>;
  const names = Object.keys(props);
  const titleName = names.find((n) => props[n].type === 'title')!;
  const properties: any = { [titleName]: { title: [{ text: { content: String(f.title ?? 'Untitled') } }] } };
  for (const [k, v] of Object.entries(f)) {
    if (k === 'title' || k === 'body' || v == null || v === '') continue;
    const n = names.find((x) => x.toLowerCase() === k) ?? names.find((x) => (ALIASES[k] ?? []).includes(x.toLowerCase()));
    const e = n && encode(props[n].type, v);
    if (e) properties[n!] = e;
  }
  const children = String(f.body ?? '').split(/\n{2,}/).filter(Boolean).slice(0, 100).map((p) => ({
    object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p.slice(0, 2000) } }] } }));
  return nf('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: env(DB[kind]) }, properties, children }) });
}
