/**
 * SQLite connection + idempotent migrations.
 *
 * This is the only module that knows about `better-sqlite3`. Repositories take
 * the connection and expose typed queries; services never touch SQL.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

export type DatabaseConnection = Database.Database;

let instance: DatabaseConnection | undefined;

/** Lazily open the database, creating the tables on first use. */
export function connection(): DatabaseConnection {
  if (instance) return instance;

  const file = config.dbPath();
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  instance = db;
  return db;
}

/** Close the connection (tests, graceful shutdown). */
export function closeConnection() {
  instance?.close();
  instance = undefined;
}

/**
 * Schema versions are tracked in `PRAGMA user_version`, so a fresh database and
 * an old one converge through the same list. Every step must be idempotent
 * enough to run on a database created before this module existed.
 */
const MIGRATIONS: ((db: DatabaseConnection) => void)[] = [
  // 1 — base tables
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS items(
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        data TEXT NOT NULL,
        body TEXT,
        updated TEXT
      );
      CREATE INDEX IF NOT EXISTS items_kind ON items(kind, slug);

      CREATE TABLE IF NOT EXISTS posts(
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
    `);
  },
  // 2 — posts grew drafts, excerpts and an updated timestamp
  (db) => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(posts)').all() as { name: string }[]).map((c) => c.name),
    );
    const additions: Record<string, string> = {
      updated: 'TEXT',
      published: 'INTEGER NOT NULL DEFAULT 1',
      excerpt: 'TEXT',
    };
    for (const [name, ddl] of Object.entries(additions)) {
      if (!columns.has(name)) db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${ddl}`);
    }
    db.exec("UPDATE posts SET updated = COALESCE(updated, created) WHERE updated IS NULL");
    db.exec('CREATE INDEX IF NOT EXISTS posts_published ON posts(published, created DESC)');
  },
  // 3 — slug lookups are always scoped to a kind
  (db) => {
    db.exec('CREATE INDEX IF NOT EXISTS items_kind_slug ON items(kind, slug)');
  },
  // 4 — post history: the state *before* every edit, delete, restore or import
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS post_revisions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT,
        excerpt TEXT,
        published INTEGER NOT NULL DEFAULT 1,
        created TEXT,
        reason TEXT NOT NULL,
        saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS post_revisions_slug ON post_revisions(slug, id DESC);
    `);
  },
  // 5 — Notion-only articles. The legacy items/posts/post_revisions tables are
  //     left untouched (no destructive migration) but nothing reads them.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS articles(
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        excerpt TEXT NOT NULL DEFAULT '',
        cover TEXT,
        rank REAL NOT NULL DEFAULT 0,
        updated TEXT NOT NULL,
        body TEXT,
        body_text TEXT,
        toc TEXT,
        body_updated TEXT
      );
      CREATE INDEX IF NOT EXISTS articles_date ON articles(date DESC);

      CREATE TABLE IF NOT EXISTS notion_media(
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('block', 'cover'))
      );
      CREATE INDEX IF NOT EXISTS notion_media_article ON notion_media(article_id);
    `);
  },
  // 6 — Notion page creation time, the tie-breaker for posts sharing a date.
  //     Filled by the next sync (rows are rewritten on every sync).
  (db) => {
    const columns = new Set((db.prepare('PRAGMA table_info(articles)').all() as { name: string }[]).map((c) => c.name));
    if (!columns.has('created')) db.exec("ALTER TABLE articles ADD COLUMN created TEXT NOT NULL DEFAULT ''");
  },
  // 7 — the /more page edited in /admin (one JSON document). Not touched by
  //     Notion syncs or credential changes; absent row = built-in samples.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS more_page(
        id INTEGER PRIMARY KEY CHECK (id = 1),
        doc TEXT NOT NULL,
        updated TEXT NOT NULL
      );
    `);
  },
  // 8 — first observed publication dates for Notion pages with no Date.
  // Kept separately from the disposable article cache, including across unpublishing.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS notion_first_publication (
      database_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (database_id, page_id)
    )`);
  },
  // 9 — renderer changes can invalidate HTML without discarding searchable text.
  (db) => {
    const columns = new Set((db.prepare('PRAGMA table_info(articles)').all() as { name: string }[]).map((c) => c.name));
    if (!columns.has('body_renderer_version')) db.exec('ALTER TABLE articles ADD COLUMN body_renderer_version INTEGER NOT NULL DEFAULT 0');
  },
];

let depth = 0;

/**
 * Run `fn` atomically. Re-entrant: a service that already runs inside a
 * transaction can call another transactional helper
 * without opening a nested one.
 */
export function transaction<T>(fn: () => T): T {
  if (depth > 0) return fn();
  const run = connection().transaction(() => {
    depth += 1;
    try {
      return fn();
    } finally {
      depth -= 1;
    }
  });
  return run();
}

function migrate(db: DatabaseConnection) {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number })?.user_version ?? 0);
  MIGRATIONS.forEach((step, index) => {
    if (index < current) return;
    step(db);
    db.exec(`PRAGMA user_version = ${index + 1}`);
  });
}
