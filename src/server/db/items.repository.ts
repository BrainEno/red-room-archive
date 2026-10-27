/**
 * Cached Notion entries.
 *
 * The cache is a local mirror of three Notion databases. Rows carry the mapped
 * properties as JSON plus the rendered body (filled lazily) so public reads
 * never wait on Notion.
 */
import { connection } from './connection.ts';
import type { Kind } from '../../shared/kinds.ts';

export interface ItemRow {
  id: string;
  kind: Kind;
  title: string;
  slug: string;
  data: Record<string, unknown>;
  updated: string;
}

interface RawRow extends Omit<ItemRow, 'data'> {
  data: string;
  body: string | null;
}

const toItem = (row: RawRow): ItemRow => {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { id: row.id, kind: row.kind, title: row.title, slug: row.slug, data, updated: row.updated };
};

export const itemsRepository = {
  byKind(kind: Kind): ItemRow[] {
    const rows = connection().prepare('SELECT * FROM items WHERE kind = ?').all(kind) as RawRow[];
    return rows.map(toItem);
  },

  bySlug(kind: Kind, slug: string): ItemRow | undefined {
    const row = connection().prepare('SELECT * FROM items WHERE kind = ? AND slug = ? LIMIT 1').get(kind, slug) as RawRow | undefined;
    return row ? toItem(row) : undefined;
  },

  byId(id: string): ItemRow | undefined {
    const row = connection().prepare('SELECT * FROM items WHERE id = ?').get(id) as RawRow | undefined;
    return row ? toItem(row) : undefined;
  },

  /** Insert or refresh one entry; drops the cached body when the page changed. */
  upsert(item: ItemRow) {
    connection()
      .prepare(
        `INSERT INTO items(id, kind, title, slug, data, body, updated) VALUES(?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           title = excluded.title,
           slug = excluded.slug,
           data = excluded.data,
           body = CASE WHEN items.updated = excluded.updated THEN items.body ELSE NULL END,
           updated = excluded.updated`,
      )
      .run(item.id, item.kind, item.title, item.slug, JSON.stringify(item.data), item.updated);
  },

  /**
   * Replace a whole kind with the freshly fetched snapshot and report how many
   * entries were inserted, updated and removed.
   */
  replaceKind(kind: Kind, items: ItemRow[]): { synced: number; removed: number } {
    const db = connection();
    const keep = new Set(items.map((item) => item.id));
    let removed = 0;
    db.transaction(() => {
      for (const item of items) itemsRepository.upsert(item);
      for (const row of db.prepare('SELECT id FROM items WHERE kind = ?').all(kind) as { id: string }[]) {
        if (keep.has(row.id)) continue;
        db.prepare('DELETE FROM items WHERE id = ?').run(row.id);
        removed++;
      }
    })();
    return { synced: items.length, removed };
  },

  body(id: string): string | null {
    const row = connection().prepare('SELECT body FROM items WHERE id = ?').get(id) as { body: string | null } | undefined;
    return row?.body ?? null;
  },

  setBody(id: string, html: string) {
    connection().prepare('UPDATE items SET body = ? WHERE id = ?').run(html, id);
  },

  dropBody(id: string): boolean {
    return connection().prepare('UPDATE items SET body = NULL WHERE id = ?').run(id).changes > 0;
  },

  remove(id: string): boolean {
    return connection().prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
  },

  counts(): Record<Kind, number> {
    const counts = { writing: 0, films: 0, music: 0 } as Record<Kind, number>;
    for (const row of connection().prepare('SELECT kind, COUNT(*) AS n FROM items GROUP BY kind').all() as { kind: Kind; n: number }[]) {
      if (row.kind in counts) counts[row.kind] = row.n;
    }
    return counts;
  },

  search(like: string, limit: number): ItemRow[] {
    const sql = `SELECT * FROM items
      WHERE title LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
      ORDER BY updated DESC LIMIT ?`;
    return (connection().prepare(sql).all(like, like, like, limit) as RawRow[]).map(toItem);
  },
};
