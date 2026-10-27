/**
 * Post history. Each row is a full copy of a post as it was *before* a change,
 * so the live `posts` row plus this table reconstruct every saved version.
 * Rows outlive their post: a deleted post keeps its history (the trash).
 */
import { connection } from './connection.ts';
import type { PostRow } from './posts.repository.ts';

export type RevisionReason = 'edit' | 'delete' | 'restore' | 'import';

export interface RevisionRow {
  id: number;
  slug: string;
  title: string;
  body: string;
  tags: string | null;
  excerpt: string | null;
  published: number;
  created: string | null;
  reason: RevisionReason;
  saved_at: string;
}

export interface DeletedRow extends RevisionRow {
  revisions: number;
}

export const revisionsRepository = {
  snapshot(row: PostRow, reason: RevisionReason): number {
    const result = connection()
      .prepare(
        `INSERT INTO post_revisions(slug, title, body, tags, excerpt, published, created, reason)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.slug, row.title, row.body, row.tags ?? '', row.excerpt ?? null, row.published, row.created ?? null, reason);
    return Number(result.lastInsertRowid);
  },

  /** Newest first. */
  list(slug: string): RevisionRow[] {
    return connection()
      .prepare('SELECT * FROM post_revisions WHERE slug = ? ORDER BY id DESC')
      .all(slug) as RevisionRow[];
  },

  byId(slug: string, id: number): RevisionRow | undefined {
    return connection().prepare('SELECT * FROM post_revisions WHERE slug = ? AND id = ?').get(slug, id) as
      | RevisionRow
      | undefined;
  },

  /** History follows a post when its slug is renamed. */
  rename(from: string, to: string) {
    connection().prepare('UPDATE post_revisions SET slug = ? WHERE slug = ?').run(to, from);
  },

  /** Keep only the newest `keep` revisions of one post. */
  prune(slug: string, keep: number) {
    connection()
      .prepare(
        `DELETE FROM post_revisions WHERE slug = ? AND id NOT IN (
           SELECT id FROM post_revisions WHERE slug = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(slug, slug, keep);
  },

  /** Posts that no longer exist but still have history, newest deletion first. */
  deleted(): DeletedRow[] {
    return connection()
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM post_revisions c WHERE c.slug = r.slug) AS revisions
           FROM post_revisions r
          WHERE r.id = (SELECT MAX(id) FROM post_revisions m WHERE m.slug = r.slug)
            AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.slug = r.slug)
          ORDER BY r.id DESC`,
      )
      .all() as DeletedRow[];
  },

  purge(slug: string): number {
    return connection().prepare('DELETE FROM post_revisions WHERE slug = ?').run(slug).changes;
  },

  count(): number {
    return (connection().prepare('SELECT COUNT(*) AS n FROM post_revisions').get() as { n: number }).n;
  },
};
