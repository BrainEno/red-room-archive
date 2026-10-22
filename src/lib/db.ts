// SQLite：Notion 内容缓存（items）+ 自有博客文章（posts）。
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { env, esc, fetchBody, fetchKind, notionReady, raw, setResolver, slugify, type Item, type Kind } from './notion';
import { demo, site } from '../data/site';

const KINDS: Kind[] = ['writing', 'films', 'music'];
const TTL = Number(env('SYNC_TTL_SECONDS') ?? 300) * 1000;
let _db: Database.Database | undefined;
let syncing: Promise<void> | null = null;
const settings: Record<string, string> = {};

export function db() {
  if (_db) return _db;
  mkdirSync('data', { recursive: true });
  _db = new Database(env('DB_PATH') ?? 'data/archive.db');
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, kind TEXT, title TEXT, slug TEXT, data TEXT, body TEXT, updated TEXT);
    CREATE INDEX IF NOT EXISTS items_kind ON items(kind, slug);
    CREATE TABLE IF NOT EXISTS posts(slug TEXT PRIMARY KEY, title TEXT, body TEXT, tags TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);`);
  for (const r of _db.prepare('SELECT k,v FROM settings').all() as any[]) settings[r.k] = r.v;
  setResolver((k) => settings[k] ?? raw(k));
  return _db;
}
const on = (k?: Kind) => { db(); return notionReady(k); };   // 先确保设置已载入，再判断 Notion 是否已配置
const row = (r: any): Item => ({ ...r, data: JSON.parse(r.data) });

function upsert(i: Item) {
  // Notion 页面被编辑（updated 变化）时，清空已缓存正文，下次阅读时重新拉取
  db().prepare(`INSERT INTO items(id,kind,title,slug,data,body,updated) VALUES(?,?,?,?,?,NULL,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,slug=excluded.slug,data=excluded.data,
    body=CASE WHEN items.updated=excluded.updated THEN items.body ELSE NULL END, updated=excluded.updated`)
    .run(i.id, i.kind, i.title, i.slug, JSON.stringify(i.data), i.updated);
}
export async function syncKind(k: Kind) {
  if (!on(k)) return;
  const items = await fetchKind(k), d = db(), keep = new Set(items.map((i) => i.id));
  d.transaction(() => {
    items.forEach(upsert);
    for (const h of d.prepare('SELECT id FROM items WHERE kind=?').all(k) as { id: string }[]) if (!keep.has(h.id)) d.prepare('DELETE FROM items WHERE id=?').run(h.id);
  })();
}
export function syncAll() {
  return (syncing ??= (async () => {
    try {
      for (const k of KINDS) await syncKind(k);
      db().prepare("INSERT INTO meta VALUES('synced',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(Date.now()));
    } finally { syncing = null; }
  })());
}

const demoItems = (k: Kind): Item[] => (demo[k] as any[]).map((d, i) => ({ id: `demo-${k}-${i}`, kind: k, title: d.title, slug: String(i), data: d, updated: '' }));

export async function getItems(k: Kind): Promise<Item[]> {
  if (!on()) return demoItems(k);
  const d = db();
  const last = Number((d.prepare("SELECT v FROM meta WHERE k='synced'").get() as any)?.v ?? 0);
  if (!last) await syncAll().catch(console.error);                       // 首次：等待同步完成
  else if (Date.now() - last > TTL) syncAll().catch(console.error);      // 之后：过期则后台刷新
  return (d.prepare('SELECT * FROM items WHERE kind=?').all(k) as any[]).map(row)
    .sort((a, b) => (b.data.year ?? 0) - (a.data.year ?? 0) || b.updated.localeCompare(a.updated));
}
export async function getItem(k: Kind, slug: string) { return (await getItems(k)).find((i) => i.slug === slug); }
export async function getBody(i: Item): Promise<string> {
  if (!on()) return `<p>${esc(i.data.summary ?? '')}</p>`;
  const r = db().prepare('SELECT body FROM items WHERE id=?').get(i.id) as any;
  if (r?.body) return r.body;
  const body = await fetchBody(i.id);
  db().prepare('UPDATE items SET body=? WHERE id=?').run(body, i.id);
  return body;
}

// 博客文章（只存在 SQLite，不经过 Notion）
export const listPosts = () => db().prepare('SELECT slug,title,tags,created FROM posts ORDER BY created DESC').all();
export function addPost(p: { title: string; body: string; tags?: string[]; slug?: string }) {
  const slug = p.slug || slugify(p.title);
  db().prepare(`INSERT INTO posts(slug,title,body,tags) VALUES(?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,body=excluded.body,tags=excluded.tags`)
    .run(slug, p.title, p.body, (p.tags ?? []).join(','));
  return slug;
}

export const getPost = (slug: string) => db().prepare('SELECT * FROM posts WHERE slug=?').get(slug) as any;

// ── 站点信息 / 后台设置 / 状态
export const SETTING_KEYS = ['site_name', 'site_email', 'site_about', 'NOTION_TOKEN', 'NOTION_DB_WRITING', 'NOTION_DB_FILMS', 'NOTION_DB_MUSIC'];
export async function getSite() {
  db();
  return { name: settings.site_name || site.name, email: settings.site_email || site.email, about: settings.site_about || site.about };
}
export function publicSettings() {
  db();
  const def: Record<string, string> = { site_name: site.name, site_email: site.email, site_about: site.about };
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, k === 'NOTION_TOKEN' ? (env(k) ? '••••' + env(k)!.slice(-4) : '') : settings[k] ?? env(k) ?? def[k] ?? '']));
}
export function setSettings(v: Record<string, string>) {
  const d = db(); let notionChanged = false;
  for (const k of SETTING_KEYS) {
    if (!(k in v)) continue;
    const val = String(v[k] ?? '').trim();
    if (k === 'NOTION_TOKEN' && (!val || val.startsWith('••••'))) continue;   // 空值/掩码 = 不修改
    if (val) { d.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, val); settings[k] = val; }
    else { d.prepare('DELETE FROM settings WHERE k=?').run(k); delete settings[k]; }
    if (k.startsWith('NOTION')) notionChanged = true;
  }
  if (notionChanged) d.prepare("DELETE FROM meta WHERE k='synced'").run();   // 配置变了：下次访问重新同步
}
export function status() {
  const d = db(), counts: Record<string, number> = {};
  for (const r of d.prepare('SELECT kind, COUNT(*) n FROM items GROUP BY kind').all() as any[]) counts[r.kind] = r.n;
  return { notion: notionReady(), counts, dbs: { writing: notionReady('writing'), films: notionReady('films'), music: notionReady('music') },
    synced: Number((d.prepare("SELECT v FROM meta WHERE k='synced'").get() as any)?.v ?? 0) };
}
