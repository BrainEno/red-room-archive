/**
 * Markdown front matter — the small YAML subset that static-site generators
 * (Hugo, Jekyll, Astro, Obsidian …) write for posts:
 *
 *   ---
 *   title: "Dawn, again"
 *   date: 2026-10-27 08:00:00
 *   tags: [notes, light]        # or a block list:  tags:\n  - notes
 *   published: true
 *   ---
 *
 * Scalars are strings or booleans (dates and numbers stay strings, so nothing
 * is reinterpreted). Pure functions, no dependencies.
 */

export type FrontMatterValue = string | boolean | string[];
export type FrontMatter = Record<string, FrontMatterValue>;

const unquote = (raw: string): string => {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value.replace(/\s+#.*$/, ''); // trailing comment on a plain scalar
};

/** Split a flow sequence (`[a, "b, c", 'd']`) on top-level commas. */
const flowItems = (inner: string): string[] => {
  const items: string[] = [];
  let current = '';
  let quote = '';
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      items.push(current);
      current = '';
    } else current += char;
  }
  items.push(current);
  return items.map(unquote).filter(Boolean);
};

const scalar = (raw: string): FrontMatterValue => {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) return flowItems(value.slice(1, -1));
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^(false|no|off)$/i.test(value)) return false;
  return unquote(value);
};

export function parseFrontMatter(text: string): { data: FrontMatter; body: string } {
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);
  if (!match) return { data: {}, body: source };

  const data: FrontMatter = {};
  let listKey = '';
  for (const line of match[1]!.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? (listKey ? /^-\s*(.*)$/.exec(line) : null);
    if (item && listKey) {
      const list = data[listKey];
      const value = unquote(item[1]!);
      if (Array.isArray(list) && value) list.push(value);
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1]!.toLowerCase();
    if (pair[2]!.trim() === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = scalar(pair[2]!);
      listKey = '';
    }
  }
  // A key with no value and no list items is an empty string, not a list.
  for (const [key, value] of Object.entries(data)) if (Array.isArray(value) && !value.length && key !== 'tags') data[key] = '';
  return { data, body: source.slice(match[0].length).replace(/^\n/, '') };
}

/** Quote only when a plain scalar would be misread. */
const quote = (value: string): string =>
  value === '' || /^[\s'"[\]{}>|*&!%@`#,?:-]|[:#]\s|\s$|^(true|false|yes|no|on|off|null|~)$/i.test(value) || /\n/.test(value)
    ? JSON.stringify(value)
    : value;

/** Items of a flow list must also quote commas and brackets. */
const listItem = (value: string): string => (/[,[\]]/.test(value) ? JSON.stringify(value) : quote(value));

export function stringifyFrontMatter(data: Record<string, FrontMatterValue | null | undefined>, body: string): string {
  const lines = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: [${value.map(listItem).join(', ')}]`;
      if (typeof value === 'boolean') return `${key}: ${value}`;
      return `${key}: ${quote(String(value))}`;
    });
  // One blank line separates the header; parseFrontMatter removes exactly that
  // line again, so a body round-trips byte for byte.
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
