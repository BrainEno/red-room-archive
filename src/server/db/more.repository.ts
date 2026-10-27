/**
 * The /more page document (a single row of JSON). Validation lives in
 * core/more.ts; this module only stores and returns the text.
 */
import { connection } from './connection.ts';

export interface MoreRow {
  doc: string;
  updated: string;
}

export const moreRepository = {
  get(): MoreRow | undefined {
    return connection().prepare('SELECT doc, updated FROM more_page WHERE id = 1').get() as MoreRow | undefined;
  },

  save(doc: string, updated: string) {
    connection()
      .prepare('INSERT INTO more_page(id, doc, updated) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated = excluded.updated')
      .run(doc, updated);
  },

  clear() {
    connection().prepare('DELETE FROM more_page WHERE id = 1').run();
  },
};
