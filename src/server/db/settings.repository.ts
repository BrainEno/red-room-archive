/** Admin-editable settings. Read from SQLite on each call so changes made by
 * another process sharing the database are immediately visible. */
import { connection } from './connection.ts';

export interface SettingRow {
  k: string;
  v: string;
}

export const settingsRepository = {
  all(): Record<string, string> {
    const rows = connection().prepare('SELECT k, v FROM settings').all() as SettingRow[];
    return Object.fromEntries(rows.map(({ k, v }) => [k, v]));
  },
  get(key: string): string | undefined {
    return (connection().prepare('SELECT v FROM settings WHERE k = ?').get(key) as { v: string } | undefined)?.v;
  },
  set(key: string, value: string) {
    connection().prepare('INSERT INTO settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, value);
  },
  remove(key: string) {
    connection().prepare('DELETE FROM settings WHERE k = ?').run(key);
  },
};
