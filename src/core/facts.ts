/**
 * Homepage facts (“Based in: Taipei”) as admin-editable text.
 *
 * Stored as one fact per line, `Label: value`; the first `:` or full-width `：`
 * splits label from value, so values may contain colons (times, URLs).
 *
 * - empty text → the built-in facts (content/site.ts)
 * - `-`        → hide the facts row
 *
 * Pure: shared by the settings service (validation, rendering) and tests.
 */

export interface Fact {
  key: string;
  value: string;
}

export const MAX_FACTS = 6;
export const MAX_FACT_LABEL = 40;
export const MAX_FACT_VALUE = 200;
/** Text that hides the row instead of falling back to the defaults. */
export const HIDE_FACTS = '-';

const SEPARATOR = /[:：]/;

const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** Strict check used before saving; returns an error message or null. */
export function factsError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === HIDE_FACTS) return null;
  const rows = lines(trimmed);
  if (rows.length > MAX_FACTS) return `at most ${MAX_FACTS} facts (one per line)`;
  for (const [index, row] of rows.entries()) {
    const at = row.search(SEPARATOR);
    const key = at < 0 ? '' : row.slice(0, at).trim();
    const value = at < 0 ? '' : row.slice(at + 1).trim();
    if (!key || !value) return `line ${index + 1} must look like “Label: value”`;
    if (key.length > MAX_FACT_LABEL) return `line ${index + 1}: label is longer than ${MAX_FACT_LABEL} characters`;
    if (value.length > MAX_FACT_VALUE) return `line ${index + 1}: value is longer than ${MAX_FACT_VALUE} characters`;
  }
  return null;
}

/**
 * Lenient parse for rendering: never throws, so a hand-edited database row
 * cannot take the homepage down. Malformed lines are skipped, extras dropped.
 */
export function parseFacts(text: string | undefined | null, defaults: readonly Fact[]): Fact[] {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return defaults.map((fact) => ({ ...fact }));
  if (trimmed === HIDE_FACTS) return [];
  const facts: Fact[] = [];
  for (const row of lines(trimmed)) {
    const at = row.search(SEPARATOR);
    if (at < 0) continue;
    const key = row.slice(0, at).trim().slice(0, MAX_FACT_LABEL);
    const value = row.slice(at + 1).trim().slice(0, MAX_FACT_VALUE);
    if (key && value) facts.push({ key, value });
    if (facts.length === MAX_FACTS) break;
  }
  return facts;
}

/** The editable text for a list of facts (inverse of parseFacts). */
export const formatFacts = (facts: readonly Fact[], separator = ': '): string =>
  facts.length ? facts.map((fact) => `${fact.key}${separator}${fact.value}`).join('\n') : HIDE_FACTS;
