/** Small key/value store for sync bookkeeping (last sync, last error). */
import { connection } from './connection.ts';

export const metaRepository = {
  get(key: string): string | undefined {
    return (connection().prepare('SELECT v FROM meta WHERE k = ?').get(key) as { v: string } | undefined)?.v;
  },

  set(key: string, value: string) {
    connection()
      .prepare('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .run(key, value);
  },

  remove(key: string) {
    connection().prepare('DELETE FROM meta WHERE k = ?').run(key);
  },
};
