/**
 * Article ordering — one comparator for the home page, the index, prev/next,
 * the API, RSS and the sitemap.
 *
 * Notion's Date property is either a calendar day (`2026-10-28`) or a moment
 * with an offset (`2026-10-28T21:30:00.000+08:00`). Comparing those strings
 * would mis-order mixed formats and time zones, so they are compared as instants.
 * A calendar day counts as 00:00 UTC (what `Date.parse` does), so two posts
 * on the same day are ordered by their times when they have one, and by the
 * Notion page's creation time otherwise.
 */

/** Epoch ms of an ISO date/date-time; unparseable or empty → 0 (sorts last). */
export const instant = (value: string | null | undefined): number => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isNaN(ms) ? 0 : ms;
};

export interface Orderable {
  date: string;
  /** Notion `created_time` — tie-breaker for posts sharing a date. */
  created?: string;
  title: string;
}

/** Newest first: Notion date-time, then page creation time, then title. */
export const newestFirst = (a: Orderable, b: Orderable): number =>
  instant(b.date) - instant(a.date) ||
  instant(b.created) - instant(a.created) ||
  a.title.localeCompare(b.title);
