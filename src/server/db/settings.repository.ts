/**
 * Admin-editable settings (site copy + Notion credentials).
 *
 * Values stored here take precedence over environment variables; deleting a
 * key falls back to `.env` again.
 */
import { connection } from './connection.ts';

export interface SettingRow {
  k: string;
  v: string;
}

let cache: Map<string, string> | null = null;

const load = (): Map<string, string> => {
  if (cache) return cache;
  cache = new Map(
    (connection().prepare('SELECT k, v FROM settings').all() as SettingRow[]).map((row) => [row.k, row.v]),
  );
  return cache;
};

/** Drop the in-process cache (after writes, and in tests). */
export const invalidateSettingsCache = () => {
  cache = null;
};

export const settingsRepository = {
  all(): Record<string, string> {
    return Object.fromEntries(load());
  },

  get(key: string): string | undefined {
    return load().get(key);
  },

  set(key: string, value: string) {
    connection()
      .prepare('INSERT INTO settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .run(key, value);
    load().set(key, value);
  },

  remove(key: string) {
    connection().prepare('DELETE FROM settings WHERE k = ?').run(key);
    load().delete(key);
  },
};
