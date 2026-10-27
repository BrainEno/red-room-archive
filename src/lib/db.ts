// SQLite：Notion 内容缓存（items）+ 自有博客文章（posts）+ 站点设置。
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { env, esc, fetchBody, fetchKind, KINDS, notionReady, raw, setResolver, type Item, type Kind } from './notion.ts';
import { demo, site } from '../data/site.ts';
import { HttpError } from './http.ts';
import { postSlug, cleanSlug } from './slug.ts';

export { KINDS };
const TTL = Number(env('SYNC_TTL_SECONDS') ?? 300) * 1000;
let _db: Database.Database | undefined;
const inflight = new Map<string, Promise<void>>();
const settings: Record<string, string> = {};

export function db() {
  if (_db) return _db;
  mkdirSync('data', { recursive: true });
  _db = new Database(env('DB_PATH') ?? 'data/archive.db');
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, kind TEXT, title TEXT, slug TEXT, data TEXT, body TEXT, updated TEXT);
    CREATE INDEX IF NOT EXISTS items_kind ON items(kind, slug);
    CREATE TABLE IF NOT EXISTS posts(slug TEXT PRIMARY KEY, title TEXT, body TEXT, tags TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);`);
  migratePosts(_db);
  for (const r of _db.prepare('SELECT k,v FROM settings').all() as any[]) settings[r.k] = r.v;
  setResolver((k) => settings[k] ?? raw(k));
  return _db;
}

/** 旧库升级：给 posts 补上 updated / published / excerpt 三列。 */
function migratePosts(d: Database.Database) {
  const cols = new Set((d.prepare('PRAGMA table_info(posts)').all() as any[]).map((c) => c.name));
  const add: Record<string, string> = { updated: 'TEXT', published: 'INTEGER NOT NULL DEFAULT 1', excerpt: 'TEXT' };
  for (const [name, ddl] of Object.entries(add)) if (!cols.has(name)) d.exec(`ALTER TABLE posts ADD COLUMN ${name} ${ddl}`);
  d.exec("UPDATE posts SET updated=COALESCE(updated,created) WHERE updated IS NULL");
  d.exec('CREATE INDEX IF NOT EXISTS posts_published ON posts(published, created DESC)');
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

const metaSet = (k: string, v: string) => db().prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
const metaGet = (k: string) => (db().prepare('SELECT v FROM meta WHERE k=?').get(k) as any)?.v as string | undefined;

export async function syncKind(k: Kind) {
  if (!on(k)) return 0;
  const items = await fetchKind(k), d = db(), keep = new Set(items.map((i) => i.id));
  d.transaction(() => {
    items.forEach(upsert);
    for (const h of d.prepare('SELECT id FROM items WHERE kind=?').all(k) as { id: string }[]) if (!keep.has(h.id)) d.prepare('DELETE FROM items WHERE id=?').run(h.id);
  })();
  return items.length;
}

/** 同步一个或多个分类；同一批分类同时只跑一次，错误记录在 meta 里供后台查看。 */
export function syncAll(kinds: Kind[] = KINDS) {
  const key = kinds.join(',');
  const running = inflight.get(key);
  if (running) return running;
  const task = (async () => {
    try {
      for (const k of kinds) await syncKind(k);
      metaSet('synced', String(Date.now()));
      metaSet('sync_error', '');
    } catch (e) {
      metaSet('sync_error', String(e).slice(0, 500));
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, task);
  return task;
}

const demoItems = (k: Kind): Item[] => (demo[k] as any[]).map((d, i) => ({ id: `demo-${k}-${i}`, kind: k, title: d.title, slug: String(i), data: d, updated: '' }));

export async function getItems(k: Kind): Promise<Item[]> {
  if (!on()) return demoItems(k);
  const d = db();
  const last = Number(metaGet('synced') ?? 0);
  if (!last) await syncAll().catch(console.error);                       // 首次：等待同步完成
  else if (Date.now() - last > TTL) syncAll().catch(console.error);      // 之后：过期则后台刷新
  return (d.prepare('SELECT * FROM items WHERE kind=?').all(k) as any[]).map(row)
    .sort((a, b) => (b.data.year ?? 0) - (a.data.year ?? 0) || String(b.updated).localeCompare(String(a.updated)));
}
export async function getItem(k: Kind, slug: string) { return (await getItems(k)).find((i) => i.slug === slug); }
export const getItemById = (id: string) => {
  const r = db().prepare('SELECT * FROM items WHERE id=?').get(id) as any;
  return r ? row(r) : undefined;
};
/** Notion 页面归档/删除后，把本地缓存一并清掉。 */
export const forgetItem = (id: string) => db().prepare('DELETE FROM items WHERE id=?').run(id).changes > 0;
/** 手动丢弃缓存的正文，下次阅读时重新从 Notion 拉取。 */
export const invalidateBody = (id: string) => db().prepare('UPDATE items SET body=NULL WHERE id=?').run(id).changes > 0;

export async function getBody(i: Item, refresh = false): Promise<string> {
  if (!on()) return `<p>${esc(i.data.summary ?? '')}</p>`;
  if (!refresh) {
    const r = db().prepare('SELECT body FROM items WHERE id=?').get(i.id) as any;
    if (r?.body) return r.body;
  }
  const body = await fetchBody(i.id);
  db().prepare('UPDATE items SET body=? WHERE id=?').run(body, i.id);
  return body;
}

// ── 博客文章（只存在 SQLite，不经过 Notion）
export interface PostInput {
  title?: string; body?: string; tags?: string | string[]; slug?: string;
  published?: boolean | string | number; created?: string; excerpt?: string;
}
export interface PostRow {
  slug: string; title: string; body?: string; tags: string | null;
  created: string; updated: string | null; published: number; excerpt: string | null;
}

const publishedOf = (v: PostInput['published'], fallback = true) =>
  v === undefined || v === null || v === '' ? (fallback ? 1 : 0) : (v === true || v === 1 || v === 'true' || v === 'on' || v === '1' ? 1 : 0);

const normTags = (t: PostInput['tags']): string => {
  const list = Array.isArray(t) ? t : String(t ?? '').split(',');
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20).join(',');
};

const postSummary = (p: any) => ({
  slug: p.slug, title: p.title, tags: p.tags ? String(p.tags).split(',').filter(Boolean) : [],
  created: p.created, updated: p.updated ?? p.created, published: !!p.published,
  excerpt: p.excerpt || String(p.body ?? '').replace(/\s+/g, ' ').slice(0, 200),
});

export function listPosts(opts: { includeDrafts?: boolean; limit?: number; offset?: number; tag?: string } = {}): ReturnType<typeof postSummary>[] {
  const { includeDrafts = false, limit = 100, offset = 0, tag } = opts;
  const where = [includeDrafts ? '1=1' : 'published=1'];
  const args: unknown[] = [];
  if (tag) { where.push("(',' || tags || ',') LIKE ?"); args.push(`%,${tag},%`); }
  const sql = `SELECT * FROM posts WHERE ${where.join(' AND ')} ORDER BY created DESC, updated DESC LIMIT ? OFFSET ?`;
  return (db().prepare(sql).all(...args, limit, offset) as PostRow[]).map(postSummary);
}

export const countPosts = (includeDrafts = false) =>
  (db().prepare(`SELECT COUNT(*) n FROM posts ${includeDrafts ? '' : 'WHERE published=1'}`).get() as any).n as number;

export function getPost(slug: string, opts: { includeDrafts?: boolean } = {}): (PostRow & { tagsList: string[] }) | undefined {
  const p = db().prepare('SELECT * FROM posts WHERE slug=?').get(String(slug)) as PostRow | undefined;
  if (!p || (!p.published && !opts.includeDrafts)) return undefined;
  return { ...p, tagsList: p.tags ? p.tags.split(',').filter(Boolean) : [] };
}

/** 新建：slug 冲突返回 409（旧行为是静默覆盖，容易丢稿）。 */
export function createPost(p: PostInput): { slug: string; created: boolean } {
  const title = String(p.title ?? '').trim();
  if (!title) throw new HttpError(400, 'title is required');
  if (!String(p.body ?? '').trim()) throw new HttpError(400, 'body is required');
  const slug = postSlug(title, p.slug);
  const exists = db().prepare('SELECT 1 FROM posts WHERE slug=?').get(slug);
  if (exists) throw new HttpError(409, 'slug already exists', { slug });
  db().prepare('INSERT INTO posts(slug,title,body,tags,created,updated,published,excerpt) VALUES(?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),COALESCE(?,CURRENT_TIMESTAMP),?,?)')
    .run(slug, title, String(p.body), normTags(p.tags), p.created ?? null, p.created ?? null, publishedOf(p.published), p.excerpt ?? null);
  return { slug, created: true };
}

/** 更新：字段可选，slug 可改（需不冲突）。 */
export function updatePost(current: string, p: PostInput): { slug: string } {
  const old = db().prepare('SELECT * FROM posts WHERE slug=?').get(current) as PostRow | undefined;
  if (!old) throw new HttpError(404, 'post not found');
  const next = p.slug && cleanSlug(p.slug) && cleanSlug(p.slug) !== current ? cleanSlug(p.slug) : current;
  if (next !== current && db().prepare('SELECT 1 FROM posts WHERE slug=?').get(next)) throw new HttpError(409, 'slug already exists', { slug: next });
  if (p.title !== undefined && !String(p.title).trim()) throw new HttpError(400, 'title cannot be empty');
  if (p.body !== undefined && !String(p.body).trim()) throw new HttpError(400, 'body cannot be empty');
  db().prepare(`UPDATE posts SET slug=?, title=?, body=?, tags=?, published=?, excerpt=?, created=COALESCE(?,created), updated=CURRENT_TIMESTAMP WHERE slug=?`)
    .run(next, p.title !== undefined ? String(p.title).trim() : old.title,
      p.body !== undefined ? String(p.body) : old.body,
      p.tags !== undefined ? normTags(p.tags) : old.tags,
      p.published !== undefined ? publishedOf(p.published) : old.published,
      p.excerpt !== undefined ? p.excerpt || null : old.excerpt,
      p.created || null, current);
  return { slug: next };
}

export const deletePost = (slug: string) => db().prepare('DELETE FROM posts WHERE slug=?').run(String(slug)).changes > 0;

// ── 搜索：文章（标题/正文）+ Notion 缓存条目（标题/摘要/已缓存正文）
export function search(query: string, limit = 20) {
  const q = String(query ?? '').trim().slice(0, 120);
  if (!q) return { query: '', posts: [], items: [] };
  const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const posts = (db().prepare(`SELECT * FROM posts WHERE published=1 AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
    ORDER BY created DESC LIMIT ?`).all(like, like, like, limit) as PostRow[])
    .map((p) => ({ ...postSummary(p), href: `/journal/${encodeURIComponent(p.slug)}` }));
  const items = (db().prepare(`SELECT * FROM items WHERE title LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
    ORDER BY updated DESC LIMIT ?`).all(like, like, like, limit) as any[]).map((r) => {
    const i = row(r);
    return { id: i.id, kind: i.kind, title: i.title, slug: i.slug, year: i.data.year ?? null,
      summary: i.data.summary ?? null, href: i.kind === 'writing' ? `/writing/${encodeURIComponent(i.slug)}` : '/#music' };
  });
  return { query: q, posts, items };
}

// ── 站点信息 / 后台设置 / 状态
export const SETTING_KEYS = ['site_name', 'site_email', 'site_about', 'site_intro', 'NOTION_TOKEN', 'NOTION_DB_WRITING', 'NOTION_DB_FILMS', 'NOTION_DB_MUSIC'];
export async function getSite() {
  db();
  return {
    name: settings.site_name || site.name,
    email: settings.site_email || site.email,
    about: settings.site_about || site.about,
    intro: settings.site_intro || '',
  };
}
export function publicSettings() {
  db();
  const def: Record<string, string> = { site_name: site.name, site_email: site.email, site_about: site.about, site_intro: '' };
  const values = Object.fromEntries(SETTING_KEYS.map((k) => [k, k === 'NOTION_TOKEN' ? (env(k) ? '••••' + env(k)!.slice(-4) : '') : settings[k] ?? env(k) ?? def[k] ?? '']));
  return { ...values, hasToken: !!env('NOTION_TOKEN') };
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
  const synced = Number(metaGet('synced') ?? 0);
  return {
    notion: notionReady(), counts,
    dbs: { writing: notionReady('writing'), films: notionReady('films'), music: notionReady('music') },
    synced,
    syncing: inflight.size > 0,
    syncError: metaGet('sync_error') || null,
    posts: countPosts(false),
    drafts: countPosts(true) - countPosts(false),
  };
}
