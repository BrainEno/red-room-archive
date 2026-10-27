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
];

export function migrate(db: DatabaseConnection) {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number })?.user_version ?? 0);
  MIGRATIONS.forEach((step, index) => {
    if (index < current) return;
    step(db);
    db.exec(`PRAGMA user_version = ${index + 1}`);
  });
}
