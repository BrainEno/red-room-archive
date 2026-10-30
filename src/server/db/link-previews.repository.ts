/** Cached bookmark previews (see services/link-preview.ts). */
import { connection } from './connection.ts';

export interface LinkPreviewRow {
  url: string;
  title: string;
  description: string;
  site: string;
  ok: number;
  fetched_at: number;
}

export const linkPreviewsRepository = {
  many(urls: string[]): LinkPreviewRow[] {
    if (!urls.length) return [];
    const statement = connection().prepare('SELECT * FROM link_previews WHERE url = ?');
    return urls.map((url) => statement.get(url) as LinkPreviewRow | undefined).filter((row): row is LinkPreviewRow => Boolean(row));
  },

  save(row: LinkPreviewRow) {
    connection()
      .prepare(
        `INSERT INTO link_previews(url, title, description, site, ok, fetched_at) VALUES(@url, @title, @description, @site, @ok, @fetched_at)
         ON CONFLICT(url) DO UPDATE SET title = excluded.title, description = excluded.description, site = excluded.site, ok = excluded.ok, fetched_at = excluded.fetched_at`,
      )
      .run(row);
  },

  /** A failed refresh keeps the last good preview; only the retry time moves. */
  touch(url: string, fetchedAt: number) {
    connection().prepare('UPDATE link_previews SET fetched_at = ? WHERE url = ?').run(fetchedAt, url);
  },

  clear() {
    connection().prepare('DELETE FROM link_previews').run();
  },
};
