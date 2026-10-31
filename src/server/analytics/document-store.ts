/**
 * Analytics on a small JSON document with optimistic ETag writes.
 * Used by Netlify Blobs and the in-memory test backend. The document is
 * bounded to 90 UTC days and per-day cardinality caps, so anonymous traffic
 * cannot grow it without limit.
 */
import {
  ANALYTICS_RETENTION_DAYS, OTHER_SOURCE, emptyAnalyticsDay, shiftUtcDay,
  type AnalyticsDay, type Pageview,
} from '../../core/analytics.ts';
import { unavailable } from '../../core/errors.ts';
import type { AnalyticsStorage } from '../../shared/contracts.ts';
import type { DocumentBackend } from '../newsletter/document-store.ts';
import type { AnalyticsStore } from './store.ts';

interface AnalyticsDocument {
  format: 'red-room-pageview-aggregates';
  version: 1;
  enabled: boolean;
  days: Record<string, AnalyticsDay>;
}

const MAX_ATTEMPTS = 6;
const MAX_PATHS_PER_DAY = 200;
const MAX_REFERRERS_PER_DAY = 100;
const emptyDocument = (): AnalyticsDocument => ({ format: 'red-room-pageview-aggregates', version: 1, enabled: true, days: {} });

function parseDocument(text: string): AnalyticsDocument {
  const doc = JSON.parse(text) as AnalyticsDocument;
  if (doc?.format !== 'red-room-pageview-aggregates' || doc.version !== 1 || typeof doc.enabled !== 'boolean' || !doc.days || Array.isArray(doc.days)) {
    throw new Error('unrecognised analytics document');
  }
  for (const [date, day] of Object.entries(doc.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || day?.date !== date || !Number.isFinite(day.total) ||
      ![day.paths, day.locales, day.referrers].every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
      throw new Error('invalid analytics aggregate');
    }
  }
  return doc;
}

function copyDay(day: AnalyticsDay): AnalyticsDay {
  return { date: day.date, total: day.total, paths: { ...day.paths }, locales: { ...day.locales }, referrers: { ...day.referrers } };
}

export function createAnalyticsDocumentStore(backend: DocumentBackend, kind: AnalyticsStorage = 'netlify-blobs'): AnalyticsStore {
  const load = async () => {
    const current = await backend.load();
    return { current, doc: current ? parseDocument(current.text) : emptyDocument() };
  };
  const mutate = async <T>(fn: (doc: AnalyticsDocument) => { result: T; dirty: boolean }): Promise<T> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { current, doc } = await load();
      const { result, dirty } = fn(doc);
      if (!dirty) return result;
      if (await backend.save(JSON.stringify(doc), current?.etag ?? null)) return result;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1) + Math.random() * 25));
    }
    throw unavailable('the analytics store is busy, please try again');
  };
  return {
    kind,
    async isEnabled() { return (await load()).doc.enabled; },
    async setEnabled(enabled) {
      await mutate((doc) => {
        const dirty = doc.enabled !== enabled;
        doc.enabled = enabled;
        return { result: undefined, dirty };
      });
    },
    async record(date, view) {
      return mutate((doc) => {
        if (!doc.enabled) return { result: false, dirty: false };
        const keepFrom = shiftUtcDay(date, -(ANALYTICS_RETENTION_DAYS - 1));
        for (const old of Object.keys(doc.days)) if (old < keepFrom || old > date) delete doc.days[old];
        const day = doc.days[date] ??= emptyAnalyticsDay(date);
        day.total += 1;
        let path = view.path;
        if (!(path in day.paths) && Object.keys(day.paths).length >= MAX_PATHS_PER_DAY) path = OTHER_SOURCE;
        day.paths[path] = (day.paths[path] ?? 0) + 1;
        day.locales[view.locale] = (day.locales[view.locale] ?? 0) + 1;
        let referrer = view.referrer;
        if (!(referrer in day.referrers) && Object.keys(day.referrers).length >= MAX_REFERRERS_PER_DAY) referrer = OTHER_SOURCE;
        day.referrers[referrer] = (day.referrers[referrer] ?? 0) + 1;
        return { result: true, dirty: true };
      });
    },
    async read(from, to) {
      const { doc } = await load();
      return Object.values(doc.days).filter((day) => day.date >= from && day.date <= to).sort((a, b) => a.date.localeCompare(b.date)).map(copyDay);
    },
    async clear() {
      await mutate((doc) => {
        const dirty = Object.keys(doc.days).length > 0;
        doc.days = {};
        return { result: undefined, dirty };
      });
    },
  };
}
