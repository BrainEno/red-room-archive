/**
 * Editor state for /admin → More. Pure functions (no DOM), unit-tested.
 * The server re-validates everything on save (core/more.ts).
 */
import type { LocalizedText, MoreChannelDoc, MoreDocument, MorePublicationDoc } from '../../../shared/contracts.ts';

const emptyText = (): LocalizedText => ({ en: '', 'zh-CN': '' });

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

export const blankPublication = (): MorePublicationDoc => ({
  id: newId('pub'),
  title: emptyText(),
  subtitle: emptyText(),
  year: String(new Date().getFullYear()),
  format: emptyText(),
  pages: null,
  edition: emptyText(),
  size: emptyText(),
  cover: '',
  excerpt: emptyText(),
  excerptSource: emptyText(),
  link: '',
  linkLabel: emptyText(),
});

export const blankChannel = (): MoreChannelDoc => ({
  id: newId('ch'),
  name: emptyText(),
  handle: '',
  href: '',
  qr: '',
  note: emptyText(),
});

/** A deep copy, so edits never leak into the last-saved snapshot. */
export const cloneDocument = (doc: MoreDocument): MoreDocument => JSON.parse(JSON.stringify(doc));

/** Set `publications.0.title.en`-style paths (the same paths the server reports in validation errors). */
export function setPath(doc: MoreDocument, path: string, value: unknown): void {
  const keys = path.split('.');
  let target: unknown = doc;
  for (const key of keys.slice(0, -1)) {
    if (target === null || typeof target !== 'object') throw new Error(`bad path ${path}`);
    target = (target as Record<string, unknown>)[key];
  }
  const last = keys[keys.length - 1];
  if (target === null || typeof target !== 'object' || !(last in (target as object))) throw new Error(`bad path ${path}`);
  (target as Record<string, unknown>)[last] = value;
}

export function getPath(doc: MoreDocument, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), doc);
}

/** Move `list[index]` by `delta` places (clamped). Returns the new index. */
export function move<T>(list: T[], index: number, delta: number): number {
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  if (to === index || index < 0 || index >= list.length) return index;
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item);
  return to;
}

/** Accept a JSON export (`{ document }`) or a bare document. */
export function documentFromImport(json: unknown): unknown {
  if (json && typeof json === 'object' && 'document' in json) return (json as { document: unknown }).document;
  return json;
}

/** “Zine No. 01 / 自印本 01” for the collapsed card header. */
export const bilingualLabel = (text: LocalizedText, fallback: string) => {
  const parts = [text.en.trim(), text['zh-CN'].trim()].filter(Boolean);
  return [...new Set(parts)].join(' / ') || fallback;
};
