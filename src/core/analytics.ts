/**
 * Privacy-preserving first-party pageview aggregation.
 *
 * There are deliberately no visitor ids, IP addresses, user agents, query
 * strings or event timestamps here. A pageview becomes four counters on a UTC
 * day: total, public path, interface language and referrer host. The same
 * aggregate shape is used by SQLite and the static Netlify Blobs backend.
 */
import type { AnalyticsDayCount, AnalyticsSummaryResponse, AnalyticsStorage } from '../shared/contracts.ts';

export const ANALYTICS_RETENTION_DAYS = 90;
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export const DIRECT_SOURCE = '(direct)';
export const INTERNAL_SOURCE = '(internal)';
export const OTHER_SOURCE = '(other)';

export interface Pageview {
  path: string;
  locale: 'en' | 'zh-CN';
  referrer: string;
}

export interface AnalyticsDay {
  date: string;
  total: number;
  paths: Record<string, number>;
  locales: Record<string, number>;
  referrers: Record<string, number>;
}

export const emptyAnalyticsDay = (date: string): AnalyticsDay => ({ date, total: 0, paths: {}, locales: {}, referrers: {} });

export const utcDay = (date: Date | number = new Date()): string => new Date(date).toISOString().slice(0, 10);

export function shiftUtcDay(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDay(date);
}

export function analyticsRange(value: unknown, fallback = 30): number {
  if (value === null || value === undefined || value === '') return fallback;
  const days = Number(value);
  return (ANALYTICS_RANGES as readonly number[]).includes(days) ? days : 0;
}

const FIXED_PATHS = new Set(['/', '/articles', '/topics', '/archive', '/more', '/copyright', '/subscribe', '/search']);
const PAGE = /^[1-9]\d{0,5}$/;

/** Return a canonical public pathname, or null for private/files/invalid URLs. */
export function analyticsPath(value: unknown): { path: string; locale: Pageview['locale'] } | null {
  if (typeof value !== 'string' || !value.length || value.length > 240 || !value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\\?#\u0000-\u001f\u007f]/.test(value)) return null;
  let pathname: string;
  let decoded: string;
  try {
    // URL parsers resolve percent-encoded dot segments before exposing pathname.
    // Inspect the raw value first so `/articles/%2E%2E` cannot become `/`.
    const rawDecoded = decodeURIComponent(value);
    if (/[\\?#\u0000-\u001f\u007f]/.test(rawDecoded) || rawDecoded.split('/').some((part) => part === '.' || part === '..')) return null;
    const url = new URL(value, 'https://analytics.invalid');
    if (url.origin !== 'https://analytics.invalid' || url.search || url.hash || url.username || url.password) return null;
    pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    decoded = decodeURIComponent(pathname);
  } catch { return null; }
  if (/[\\?#\u0000-\u001f\u007f]/.test(decoded) || decoded.includes('//') || decoded.split('/').some((part) => part === '.' || part === '..')) return null;
  const chinese = decoded === '/zh-CN' || decoded.startsWith('/zh-CN/');
  const neutral = chinese ? decoded.slice('/zh-CN'.length) || '/' : decoded;
  const parts = neutral.split('/').filter(Boolean);
  let allowed = FIXED_PATHS.has(neutral);
  if (!allowed && parts[0] === 'articles') {
    allowed = parts.length === 2 || (parts.length === 3 && parts[1] === 'page' && PAGE.test(parts[2]!));
  }
  if (!allowed && parts[0] === 'topics') {
    allowed = parts.length === 2 || (parts.length === 4 && parts[2] === 'page' && PAGE.test(parts[3]!));
  }
  if (!allowed || parts.some((part) => !part.length || part.length > 160)) return null;
  // Preserve the browser's canonical percent-encoding, but normalise the locale prefix/trailing slash in the same way.
  const canonicalPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return { path: canonicalPath, locale: chinese ? 'zh-CN' : 'en' };
}

/** Only a host name crosses the wire. Full referrer URLs are never accepted. */
export function analyticsReferrer(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return DIRECT_SOURCE;
  if (typeof value !== 'string' || value.length > 200) return null;
  const source = value.trim().toLowerCase().replace(/\.$/, '');
  if (source === INTERNAL_SOURCE) return source;
  if (source === DIRECT_SOURCE || source === OTHER_SOURCE) return source;
  if (!/^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.test(source)) return null;
  if (source.includes('..') || source.split('.').some((part) => part.startsWith('-') || part.endsWith('-'))) return null;
  return source;
}

export function pageviewFrom(body: Record<string, unknown>): Pageview | null {
  const path = analyticsPath(body.path);
  const referrer = analyticsReferrer(body.referrer);
  return path && referrer ? { ...path, referrer } : null;
}

const counts = (values: Record<string, number>): AnalyticsDayCount[] =>
  Object.entries(values).map(([key, views]) => ({ key, views })).sort((a, b) => b.views - a.views || a.key.localeCompare(b.key));

export function analyticsSummary(input: {
  days: AnalyticsDay[];
  rangeDays: number;
  today: string;
  enabled: boolean;
  storage: AnalyticsStorage;
}): AnalyticsSummaryResponse {
  const { rangeDays, today, enabled, storage } = input;
  const from = shiftUtcDay(today, -(rangeDays - 1));
  const byDate = new Map(input.days.filter((day) => day.date >= from && day.date <= today).map((day) => [day.date, day]));
  const daily = Array.from({ length: rangeDays }, (_, index) => {
    const date = shiftUtcDay(from, index);
    return { date, views: Math.max(0, Number(byDate.get(date)?.total ?? 0)) };
  });
  const pages = new Map<string, number>();
  const referrers = new Map<string, number>();
  const locales = new Map<string, number>();
  const add = (target: Map<string, number>, values: Record<string, number>) => {
    for (const [key, value] of Object.entries(values)) target.set(key, (target.get(key) ?? 0) + Math.max(0, Number(value) || 0));
  };
  for (const date of daily) {
    const day = byDate.get(date.date);
    if (!day) continue;
    add(pages, day.paths); add(referrers, day.referrers); add(locales, day.locales);
  }
  return {
    enabled, storage, retentionDays: ANALYTICS_RETENTION_DAYS,
    range: { days: rangeDays, from, to: today },
    totals: { pageviews: daily.reduce((sum, day) => sum + day.views, 0), today: byDate.get(today)?.total ?? 0 },
    daily,
    pages: counts(Object.fromEntries(pages)).slice(0, 20),
    referrers: counts(Object.fromEntries(referrers)).slice(0, 20),
    locales: counts(Object.fromEntries(locales)),
  };
}

/** Spreadsheet-safe CSV; even a hostile key cannot become a formula. */
export function analyticsCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function analyticsCsv(days: AnalyticsDay[]): string {
  const rows: unknown[][] = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([day.date, 'total', '', day.total]);
    for (const [metric, values] of [['path', day.paths], ['locale', day.locales], ['referrer', day.referrers]] as const) {
      for (const [key, views] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) rows.push([day.date, metric, key, views]);
    }
  }
  return [['date', 'metric', 'key', 'pageviews'], ...rows].map((row) => row.map(analyticsCsvCell).join(',')).join('\r\n') + '\r\n';
}
