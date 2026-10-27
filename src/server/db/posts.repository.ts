/**
 * Journal posts. These live only in SQLite — never in Notion.
 */
import { connection } from './connection.ts';

export interface PostRow {
  slug: string;
  title: string;
  body: string;
  tags: string | null;
  created: string;
  updated: string | null;
  published: number;
  excerpt: string | null;
}

export interface PostWrite {
  title?: string;
  body?: string;
  tags?: string | string[];
  slug?: string;
  published?: boolean | string | number;
  created?: string;
  excerpt?: string;
}

export interface PostQuery {
  includeDrafts?: boolean;
  limit?: number;
  offset?: number;
  tag?: string;
}

/** WHERE clause for visibility + optional tag (tags are stored comma-joined). */
const filter = (includeDrafts: boolean, tag?: string): { where: string; args: unknown[] } => {
  const clauses = [includeDrafts ? '1 = 1' : 'published = 1'];
  const args: unknown[] = [];
  if (tag) {
    clauses.push("(',' || COALESCE(tags, '') || ',') LIKE ?");
    args.push(`%,${tag},%`);
  }
  return { where: clauses.join(' AND '), args };
};

export const postsRepository = {
  list({ includeDrafts = false, limit = 50, offset = 0, tag }: PostQuery = {}): PostRow[] {
    const { where, args } = filter(includeDrafts, tag);
    const sql = `SELECT * FROM posts WHERE ${where}
      ORDER BY created DESC, updated DESC LIMIT ? OFFSET ?`;
    return connection().prepare(sql).all(...args, limit, offset) as PostRow[];
  },

  count(includeDrafts = false, tag?: string): number {
    const { where, args } = filter(includeDrafts, tag);
    const row = connection().prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${where}`).get(...args) as { n: number };
    return row.n;
  },

  bySlug(slug: string): PostRow | undefined {
    return connection().prepare('SELECT * FROM posts WHERE slug = ?').get(String(slug)) as PostRow | undefined;
  },

  exists(slug: string): boolean {
    return !!connection().prepare('SELECT 1 FROM posts WHERE slug = ?').get(slug);
  },

  insert(row: Required<Pick<PostRow, 'slug' | 'title' | 'body' | 'published'>> & Partial<PostRow>) {
    connection()
      .prepare(
        `INSERT INTO posts(slug, title, body, tags, created, updated, published, excerpt)
         VALUES(?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`,
      )
      .run(
        row.slug,
        row.title,
        row.body,
        row.tags ?? '',
        row.created ?? null,
        row.created ?? null,
        row.published,
        row.excerpt ?? null,
      );
  },

  update(current: string, next: PostRow) {
    connection()
      .prepare(
        `UPDATE posts SET slug = ?, title = ?, body = ?, tags = ?, published = ?, excerpt = ?,
           created = COALESCE(?, created), updated = CURRENT_TIMESTAMP WHERE slug = ?`,
      )
      .run(next.slug, next.title, next.body, next.tags, next.published, next.excerpt, next.created, current);
  },

  remove(slug: string): boolean {
    return connection().prepare('DELETE FROM posts WHERE slug = ?').run(String(slug)).changes > 0;
  },

  /**
   * Published neighbours, for prev/next links on an article.
   * Ordering is (created, slug) so equal timestamps still produce one
   * unambiguous neighbour in each direction.
   */
  neighbours(slug: string): { previous?: PostRow; next?: PostRow } {
    const current = connection().prepare('SELECT created, slug FROM posts WHERE slug = ?').get(slug) as
      | { created: string; slug: string }
      | undefined;
    if (!current) return {};
    const previous = connection()
      .prepare(
        `SELECT * FROM posts WHERE published = 1
           AND (created < ? OR (created = ? AND slug < ?))
         ORDER BY created DESC, slug DESC LIMIT 1`,
      )
      .get(current.created, current.created, current.slug) as PostRow | undefined;
    const next = connection()
      .prepare(
        `SELECT * FROM posts WHERE published = 1
           AND (created > ? OR (created = ? AND slug > ?))
         ORDER BY created ASC, slug ASC LIMIT 1`,
      )
      .get(current.created, current.created, current.slug) as PostRow | undefined;
    return { previous, next };
  },

  tags(): { tag: string; count: number }[] {
    const rows = connection().prepare('SELECT tags FROM posts WHERE published = 1').all() as { tags: string | null }[];
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of String(row.tags ?? '').split(',')) {
        const clean = tag.trim();
        if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  },

  search(like: string, limit: number): PostRow[] {
    return connection()
      .prepare(
        `SELECT * FROM posts WHERE published = 1
           AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
         ORDER BY created DESC LIMIT ?`,
      )
      .all(like, like, like, limit) as PostRow[];
  },
};
