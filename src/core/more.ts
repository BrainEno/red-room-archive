/**
 * The /more page document: validation and per-language view. Pure functions.
 *
 * The admin edits one bilingual document (shared/contracts.ts → MoreDocument).
 * `normalizeMoreDocument` is the single gate every write goes through: it
 * accepts loose JSON (a hand-edited export, an older shape, a plain string
 * where both languages are the same), trims and bounds every field, rejects
 * unsafe URLs and fills in ids — so what reaches SQLite and the page is
 * always well-formed.
 */
import { badRequest } from './errors.ts';
import type {
  LocalizedText,
  MoreChannel,
  MoreChannelDoc,
  MoreDocument,
  MorePublication,
  MorePublicationDoc,
  MoreResponse,
} from '../shared/contracts.ts';

type Locale = MoreResponse['locale'];

/** Hard limits; generous for real use, small enough to keep one request bounded. */
export const MORE_LIMITS = {
  publications: 60,
  channels: 30,
  intro: 2000,
  title: 200,
  short: 300,
  year: 20,
  excerpt: 20000,
  handle: 200,
  url: 2000,
  pages: 100000,
} as const;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Trim, normalise newlines, drop control characters; reject over-long text. */
function cleanText(value: unknown, max: number, field: string, multiline = false): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw badRequest(`${field} must be text`, { field });
  let text = String(value).replace(/\r\n?/g, '\n').replace(CONTROL, '');
  if (!multiline) text = text.replace(/\s*\n\s*/g, ' ');
  text = text.trim();
  if (text.length > max) throw badRequest(`${field} is too long (max ${max} characters)`, { field, max });
  return text;
}

/** `{ en, 'zh-CN' }`, or a plain string meaning “the same in both languages”. */
function cleanLocalized(value: unknown, max: number, field: string, multiline = false): LocalizedText {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    return {
      en: cleanText(source.en, max, `${field}.en`, multiline),
      'zh-CN': cleanText(source['zh-CN'] ?? source.zh, max, `${field}.zh-CN`, multiline),
    };
  }
  if (Array.isArray(value)) {
    // Excerpts written as paragraph arrays (the content file's shape).
    const parts = value.map((part, index) => cleanLocalized(part, max, `${field}.${index}`, multiline));
    return {
      en: cleanText(parts.map((p) => p.en).filter(Boolean).join('\n\n'), max, `${field}.en`, true),
      'zh-CN': cleanText(parts.map((p) => p['zh-CN']).filter(Boolean).join('\n\n'), max, `${field}.zh-CN`, true),
    };
  }
  const text = cleanText(value, max, field, multiline);
  return { en: text, 'zh-CN': text };
}

const hasScheme = (url: string) => /^[a-z][a-z\d+.-]*:/i.test(url);

/**
 * Image URLs (covers, QR codes): a site path (`/uploads/…`, `/more/…`) or https.
 * No `//host` (protocol-relative), no `javascript:`/`data:`, no backslashes or spaces.
 */
export function isImageUrl(url: string): boolean {
  if (!url) return true;
  if (/[\s\\<>"']/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  return /^https:\/\/[^/]/i.test(url);
}

/** Outgoing links: http(s) or mailto only (a site path is fine too). */
export function isLinkUrl(url: string): boolean {
  if (!url) return true;
  if (/[\s\\<>"']/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  if (!hasScheme(url)) return false;
  return /^(https?:\/\/[^/]|mailto:[^/])/i.test(url);
}

function cleanUrl(value: unknown, field: string, check: (url: string) => boolean): string {
  const url = cleanText(value, MORE_LIMITS.url, field);
  if (!check(url)) throw badRequest(`${field} is not an allowed URL`, { field, value: url.slice(0, 120) });
  return url;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

function cleanId(value: unknown, prefix: string, seen: Set<string>): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  let id = /^[\w-]{1,40}$/.test(raw) ? raw : newId(prefix);
  while (seen.has(id)) id = newId(prefix);
  seen.add(id);
  return id;
}

function cleanPages(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const pages = Number(value);
  if (!Number.isInteger(pages) || pages < 0 || pages > MORE_LIMITS.pages) throw badRequest(`${field} must be a whole number`, { field });
  return pages || null;
}

const asList = (value: unknown, field: string, max: number): Record<string, unknown>[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be a list`, { field });
  if (value.length > max) throw badRequest(`too many ${field} (max ${max})`, { field, max });
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw badRequest(`${field}.${index} must be an object`, { field: `${field}.${index}` });
    return item as Record<string, unknown>;
  });
};

/** Validate and normalise anything that claims to be a MoreDocument. Throws `bad_request` with the offending field. */
export function normalizeMoreDocument(input: unknown): MoreDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('the document must be an object');
  const source = input as Record<string, unknown>;
  const ids = new Set<string>();
  const L = MORE_LIMITS;

  const publications = asList(source.publications, 'publications', L.publications).map((item, i): MorePublicationDoc => {
    const at = (key: string) => `publications.${i}.${key}`;
    const link = item.link;
    const linkObject = link && typeof link === 'object' ? (link as Record<string, unknown>) : null;
    return {
      id: cleanId(item.id, 'pub', ids),
      title: cleanLocalized(item.title, L.title, at('title')),
      subtitle: cleanLocalized(item.subtitle, L.short, at('subtitle')),
      year: cleanText(item.year, L.year, at('year')),
      format: cleanLocalized(item.format, L.short, at('format')),
      pages: cleanPages(item.pages, at('pages')),
      edition: cleanLocalized(item.edition, L.short, at('edition')),
      size: cleanLocalized(item.size, L.short, at('size')),
      cover: cleanUrl(item.cover, at('cover'), isImageUrl),
      excerpt: cleanLocalized(item.excerpt, L.excerpt, at('excerpt'), true),
      excerptSource: cleanLocalized(item.excerptSource, L.short, at('excerptSource')),
      // `link` is a URL string; the content file's `{ href, label }` shape is accepted too.
      link: cleanUrl(linkObject ? linkObject.href : link, at('link'), isLinkUrl),
      linkLabel: cleanLocalized(item.linkLabel ?? linkObject?.label, L.title, at('linkLabel')),
    };
  });

  const channels = asList(source.channels, 'channels', L.channels).map((item, i): MoreChannelDoc => {
    const at = (key: string) => `channels.${i}.${key}`;
    return {
      id: cleanId(item.id, 'ch', ids),
      name: cleanLocalized(item.name, L.title, at('name')),
      handle: cleanText(item.handle, L.handle, at('handle')),
      href: cleanUrl(item.href, at('href'), isLinkUrl),
      qr: cleanUrl(item.qr, at('qr'), isImageUrl),
      note: cleanLocalized(item.note, L.short, at('note')),
    };
  });

  return { intro: cleanLocalized(source.intro, L.intro, 'intro', true), publications, channels };
}

/** One language, falling back to the other when this side is empty (a Chinese title still shows on the English page). */
export const pickText = (text: LocalizedText, locale: Locale): string => {
  const other: Locale = locale === 'en' ? 'zh-CN' : 'en';
  return text[locale].trim() || text[other].trim();
};

const optional = (value: string) => value || undefined;

/** Paragraphs are separated by a blank line. */
export const paragraphs = (text: string): string[] =>
  text
    .split(/\n[ \t]*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * The page in one language. `placeholderQr`: channels without a code show an
 * empty frame (used for the built-in samples, so the layout can be previewed);
 * saved content without a code shows the account as text only.
 */
export function localizeMore(doc: MoreDocument, locale: Locale, options: { placeholderQr?: boolean } = {}): MoreResponse {
  const pick = (text: LocalizedText) => pickText(text, locale);
  return {
    locale,
    intro: pick(doc.intro),
    publications: doc.publications.map(
      (p): MorePublication => ({
        id: p.id,
        title: pick(p.title),
        subtitle: optional(pick(p.subtitle)),
        year: p.year,
        format: optional(pick(p.format)),
        pages: p.pages ?? undefined,
        edition: optional(pick(p.edition)),
        size: optional(pick(p.size)),
        cover: optional(p.cover),
        excerpt: paragraphs(pick(p.excerpt)),
        excerptSource: optional(pick(p.excerptSource)),
        link: p.link ? { href: p.link, label: optional(pick(p.linkLabel)) } : undefined,
      }),
    ),
    channels: doc.channels.map(
      (c): MoreChannel => ({
        id: c.id,
        name: pick(c.name),
        handle: c.handle,
        href: optional(c.href),
        qr: c.qr ? c.qr : options.placeholderQr ? '' : undefined,
        note: optional(pick(c.note)),
      }),
    ),
  };
}

const uploadName = (url: string): string | undefined => {
  const raw = /^\/uploads\/([^/?#]+)$/.exec(url)?.[1];
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** Point every image that used `/uploads/<from>` at `toUrl`. Returns null when nothing referenced it. */
export function replaceUpload(doc: MoreDocument, from: string, toUrl: string): MoreDocument | null {
  let changed = false;
  const swap = (url: string) => {
    if (uploadName(url) !== from) return url;
    changed = true;
    return toUrl;
  };
  const next: MoreDocument = {
    ...doc,
    publications: doc.publications.map((p) => ({ ...p, cover: swap(p.cover) })),
    channels: doc.channels.map((c) => ({ ...c, qr: swap(c.qr) })),
  };
  return changed ? next : null;
}

/** Upload names referenced by the document (`/uploads/<name>`), so the Files tab can warn before deleting them. */
export function referencedUploads(doc: MoreDocument): string[] {
  const names = [...doc.publications.map((p) => p.cover), ...doc.channels.map((c) => c.qr)]
    .map(uploadName)
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}
