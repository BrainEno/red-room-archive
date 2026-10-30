/**
 * Local cache of the published Notion articles.
 *
 * Rows are replaced wholesale on every sync; the rendered body is cached
 * separately and kept only while the page's `last_edited_time` is unchanged.
 */
import { connection, transaction } from './connection.ts';
import { newestFirst } from '../../core/order.ts';
import type { TocEntry } from '../../shared/contracts.ts';

export interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  /** Notion Date property (calendar day or date-time with offset). */
  date: string;
  /** Notion page `created_time` — orders posts that share a date. */
  created: string;
  tags: string[];
  excerpt: string;
  /** Public URL (proxy path or external URL). */
  cover: string | null;
  rank: number;
  updated: string;
}

export interface ArticleBody {
  html: string;
  text: string;
  toc: TocEntry[];
  updated: string;
}

interface RawRow {
  id: string;
  slug: string;
  title: string;
  date: string;
  created: string;
  tags: string;
  excerpt: string;
  cover: string | null;
  rank: number;
  updated: string;
}

const COLUMNS = 'id, slug, title, date, created, tags, excerpt, cover, rank, updated';

const parseTags = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const decode = (row: RawRow): ArticleRow => ({ ...row, rank: Number(row.rank) || 0, tags: parseTags(row.tags) });

export type MediaKind = 'block' | 'cover';

export const articlesRepository = {
  /**
   * Newest first by Notion date-time (see core/order.ts). Sorted in JS, not SQL:
   * the dates mix calendar days and offsets, which only compare correctly as instants.
   */
  all(): ArticleRow[] {
    return (connection().prepare(`SELECT ${COLUMNS} FROM articles`).all() as RawRow[]).map(decode).sort(newestFirst);
  },

  bySlug(slug: string): ArticleRow | undefined {
    const row = connection().prepare(`SELECT ${COLUMNS} FROM articles WHERE slug = ?`).get(slug) as RawRow | undefined;
    return row && decode(row);
  },

  byId(id: string): ArticleRow | undefined {
    const row = connection().prepare(`SELECT ${COLUMNS} FROM articles WHERE id = ?`).get(id) as RawRow | undefined;
    return row && decode(row);
  },

  count(): number {
    return (connection().prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }).n;
  },

  countBodies(): number {
    return (connection().prepare('SELECT COUNT(*) AS n FROM articles WHERE body IS NOT NULL AND body_updated = updated').get() as { n: number }).n;
  },

  /**
   * Cached body, only when it was rendered from the current Notion revision
   * (`allowStale`: any previously rendered copy — the fallback when Notion is down).
   */
  body(id: string, options: { allowStale?: boolean; rendererVersion?: number } = {}): ArticleBody | undefined {
    const row = connection()
      .prepare('SELECT body, body_text, toc, body_updated, updated, body_renderer_version FROM articles WHERE id = ?')
      .get(id) as { body: string | null; body_text: string | null; toc: string | null; body_updated: string | null; updated: string; body_renderer_version: number } | undefined;
    if (!row || row.body == null) return undefined;
    if (!options.allowStale && (row.body_updated !== row.updated || (options.rendererVersion !== undefined && row.body_renderer_version !== options.rendererVersion))) return undefined;
    let toc: TocEntry[] = [];
    try {
      toc = JSON.parse(row.toc ?? '[]');
    } catch {
      /* ignore */
    }
    return { html: row.body, text: row.body_text ?? '', toc, updated: row.body_updated ?? '' };
  },

  saveBody(id: string, body: ArticleBody, rendererVersion = 0) {
    connection()
      .prepare('UPDATE articles SET body = ?, body_text = ?, toc = ?, body_updated = ?, body_renderer_version = ? WHERE id = ?')
      .run(body.html, body.text, JSON.stringify(body.toc), body.updated, rendererVersion, id);
  },

  /** Plain text of every cached body (search). */
  bodyTexts(): Map<string, string> {
    const rows = connection()
      .prepare('SELECT id, body_text FROM articles WHERE body_text IS NOT NULL AND body_updated = updated')
      .all() as { id: string; body_text: string }[];
    return new Map(rows.map((row) => [row.id, row.body_text]));
  },

  /**
   * Replace the article list with a fresh sync. Bodies survive for pages whose
   * `updated` did not change. Returns the media ids that are no longer
   * referenced (their cached files should be deleted).
   */
  firstPublicationDate(databaseId: string, pageId: string, today: string): string {
    const db = connection();
    db.prepare('INSERT OR IGNORE INTO notion_first_publication(database_id, page_id, date) VALUES (?, ?, ?)').run(databaseId, pageId, today);
    return (db.prepare('SELECT date FROM notion_first_publication WHERE database_id = ? AND page_id = ?').get(databaseId, pageId) as { date: string }).date;
  },

  replaceAll(rows: ArticleRow[], covers: { id: string; articleId: string }[], options: { dropBodies?: boolean } = {}): string[] {
    return transaction(() => {
      const db = connection();
      const before = new Map(
        (db.prepare('SELECT id, updated FROM articles').all() as { id: string; updated: string }[]).map((row) => [row.id, row.updated]),
      );
      const keep = new Set(rows.map((row) => row.id));
      const changed = new Set(rows.filter((row) => options.dropBodies || before.get(row.id) !== row.updated).map((row) => row.id));

      // Media to forget: everything of removed articles, plus block files of edited ones.
      const media = db.prepare('SELECT id, article_id, kind FROM notion_media').all() as { id: string; article_id: string; kind: MediaKind }[];
      const stale = media.filter((m) => !keep.has(m.article_id) || changed.has(m.article_id)).map((m) => m.id);
      const forget = db.prepare('DELETE FROM notion_media WHERE id = ?');
      for (const id of stale) forget.run(id);

      // Slugs are UNIQUE: clear first so two pages can swap slugs in one sync.
      db.prepare('DELETE FROM articles WHERE id NOT IN (SELECT value FROM json_each(?))').run(JSON.stringify([...keep]));
      db.prepare("UPDATE articles SET slug = '~' || id").run();

      const upsert = db.prepare(`
        INSERT INTO articles(${COLUMNS}) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title, date = excluded.date, created = excluded.created,
          tags = excluded.tags, excerpt = excluded.excerpt, cover = excluded.cover, rank = excluded.rank,
          updated = excluded.updated
      `);
      for (const row of rows) {
        upsert.run(row.id, row.slug, row.title, row.date, row.created, JSON.stringify(row.tags), row.excerpt, row.cover, row.rank, row.updated);
      }
      if (options.dropBodies) db.prepare('UPDATE articles SET body = NULL, body_text = NULL, toc = NULL, body_updated = NULL').run();

      const register = db.prepare("INSERT INTO notion_media(id, article_id, kind) VALUES(?, ?, 'cover') ON CONFLICT(id) DO UPDATE SET article_id = excluded.article_id, kind = 'cover'");
      for (const cover of covers) register.run(cover.id, cover.articleId);
      return stale;
    });
  },

  /** Record Notion-hosted files referenced by a rendered body. */
  registerMedia(articleId: string, ids: string[], kind: MediaKind = 'block') {
    if (!ids.length) return;
    transaction(() => {
      const statement = connection().prepare(
        'INSERT INTO notion_media(id, article_id, kind) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET article_id = excluded.article_id, kind = excluded.kind',
      );
      for (const id of ids) statement.run(id, articleId, kind);
    });
  },

  media(id: string): { id: string; articleId: string; kind: MediaKind } | undefined {
    const row = connection().prepare('SELECT id, article_id, kind FROM notion_media WHERE id = ?').get(id) as
      | { id: string; article_id: string; kind: MediaKind }
      | undefined;
    return row && { id: row.id, articleId: row.article_id, kind: row.kind };
  },

  allMediaIds(): string[] {
    return (connection().prepare('SELECT id FROM notion_media').all() as { id: string }[]).map((row) => row.id);
  },

  clear(): string[] {
    return transaction(() => {
      const ids = articlesRepository.allMediaIds();
      connection().exec('DELETE FROM notion_media; DELETE FROM articles;');
      return ids;
    });
  },
};
