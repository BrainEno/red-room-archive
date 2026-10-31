/** SQLite pageview counters (migration 12). Only daily aggregates are stored. */
import {
  ANALYTICS_RETENTION_DAYS, OTHER_SOURCE, emptyAnalyticsDay, shiftUtcDay,
  type AnalyticsDay, type Pageview,
} from '../../core/analytics.ts';
import type { AnalyticsStore } from '../analytics/store.ts';
import { connection, transaction } from './connection.ts';
import { settingsRepository } from './settings.repository.ts';

interface CountRow { day: string; metric: 'total' | 'path' | 'locale' | 'referrer'; key: string; views: number }
const MAX_PATHS_PER_DAY = 200;
const MAX_REFERRERS_PER_DAY = 100;

export const sqliteAnalyticsStore: AnalyticsStore = {
  kind: 'sqlite',
  async isEnabled() { return settingsRepository.get('analytics_enabled') !== '0'; },
  async setEnabled(enabled) { settingsRepository.set('analytics_enabled', enabled ? '1' : '0'); },
  async record(date, view) {
    return transaction(() => {
      if (settingsRepository.get('analytics_enabled') === '0') return false;
      const db = connection();
      db.prepare('DELETE FROM analytics_daily WHERE day < ? OR day > ?').run(shiftUtcDay(date, -(ANALYTICS_RETENTION_DAYS - 1)), date);
      const add = db.prepare(`INSERT INTO analytics_daily(day, metric, key, views) VALUES (?, ?, ?, 1)
        ON CONFLICT(day, metric, key) DO UPDATE SET views = views + 1`);
      add.run(date, 'total', '');
      let path = view.path;
      if (!db.prepare("SELECT 1 FROM analytics_daily WHERE day = ? AND metric = 'path' AND key = ?").get(date, path) &&
        (db.prepare("SELECT COUNT(*) AS n FROM analytics_daily WHERE day = ? AND metric = 'path'").get(date) as { n: number }).n >= MAX_PATHS_PER_DAY) path = OTHER_SOURCE;
      add.run(date, 'path', path);
      add.run(date, 'locale', view.locale);
      let referrer = view.referrer;
      if (!db.prepare("SELECT 1 FROM analytics_daily WHERE day = ? AND metric = 'referrer' AND key = ?").get(date, referrer) &&
        (db.prepare("SELECT COUNT(*) AS n FROM analytics_daily WHERE day = ? AND metric = 'referrer'").get(date) as { n: number }).n >= MAX_REFERRERS_PER_DAY) referrer = OTHER_SOURCE;
      add.run(date, 'referrer', referrer);
      return true;
    });
  },
  async read(from, to) {
    const rows = connection().prepare('SELECT day, metric, key, views FROM analytics_daily WHERE day >= ? AND day <= ? ORDER BY day, metric, key').all(from, to) as CountRow[];
    const days = new Map<string, AnalyticsDay>();
    for (const row of rows) {
      const day = days.get(row.day) ?? emptyAnalyticsDay(row.day);
      days.set(row.day, day);
      if (row.metric === 'total') day.total += row.views;
      else if (row.metric === 'path') day.paths[row.key] = row.views;
      else if (row.metric === 'locale') day.locales[row.key] = row.views;
      else day.referrers[row.key] = row.views;
    }
    return [...days.values()];
  },
  async clear() { connection().prepare('DELETE FROM analytics_daily').run(); },
};
