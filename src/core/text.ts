/**
 * Small, dependency-free text helpers shared by server rendering and the UI.
 */

/**
 * Rough reading time in minutes, never below one. Latin text is counted in
 * words (~220/min), CJK text in characters (~400/min) — Chinese has no spaces,
 * so a word count alone would call a 3000-character essay a one-minute read.
 */
export function readingMinutes(text: string): number {
  const source = String(text ?? '');
  const cjk = (source.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length;
  const words = source.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

/** First `max` characters of `text` on a word boundary, with an ellipsis. */
export function truncate(text: string, max = 160): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:，。；：、]+$/u, '')}…`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface DateParts {
  year: number;
  month: number;
  day: number;
  /** `HH:MM` when the value carries a time (Notion date-time), else null. */
  time: string | null;
}

/**
 * Calendar parts *as written*: `2026-10-28T23:30:00.000+08:00` is the 28th at
 * 23:30 — the author's wall clock — not the 28th 15:30 UTC. Values without an
 * ISO prefix fall back to the UTC reading of `Date`.
 */
export function dateParts(value: unknown): DateParts | null {
  const text = String(value ?? '');
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3], time: iso[4] ? `${iso[4]}:${iso[5]}` : null };
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), time: null };
}

/**
 * Locale-aware, deterministic date label (no Intl, so SSR output never
 * depends on the server's ICU data or time zone):
 *   en    → `04 Mar 2026`   (with time: `04 Mar 2026, 21:30`)
 *   zh-CN → `2026年3月4日`  (with time: `2026年3月4日 21:30`)
 */
export function formatDate(value: unknown, locale: string = 'en', options: { time?: boolean } = {}): string {
  const parts = dateParts(value);
  if (!parts) return String(value ?? '').slice(0, 10);
  const { year, month, day, time } = parts;
  const clock = options.time && time ? time : '';
  if (locale.toLowerCase().startsWith('zh')) return `${year}年${month}月${day}日${clock ? ` ${clock}` : ''}`;
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}${clock ? `, ${clock}` : ''}`;
}

/** Machine-readable value for `<time datetime>`: the full date-time when there is one. */
export const isoDatetime = (value: unknown): string => {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ? text : text.slice(0, 10);
};

/** Escape a string for safe interpolation into HTML by hand. */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

/** `1234567` → `1.2 MB` */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
