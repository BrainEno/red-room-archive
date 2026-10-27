/**
 * Small, dependency-free text helpers shared by server rendering and the UI.
 */

/** Strip the most common Markdown syntax so text can be used in summaries. */
export function markdownToText(source: string): string {
  return String(source ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[>#+\-\d.)*\s]+/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough reading time in minutes (200 words/minute, never below one). */
export function readingMinutes(source: string): number {
  const words = markdownToText(source).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-03-04 12:00:00` → `04 Mar 2026` (locale-independent, stable in SSR). */
export function formatDate(value: unknown): string {
  const text = String(value ?? '');
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[3]} ${MONTHS[Number(iso[2]) - 1]} ${iso[1]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

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
