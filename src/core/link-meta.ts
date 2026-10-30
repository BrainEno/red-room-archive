/**
 * Read a page's own title / description / site name from the start of its
 * HTML (Open Graph, Twitter and plain <meta>/<title> tags). Pure: the server
 * fetches (services/link-preview.ts), this only parses. Output is plain text;
 * the renderer escapes it.
 */
import type { LinkPreview } from './blocks.ts';

const MAX_TITLE = 160;
const MAX_DESCRIPTION = 240;
const MAX_SITE = 60;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', copy: '©', reg: '®', trade: '™' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** Collapse whitespace, drop control characters, clip at a word boundary. */
export function tidy(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = decodeEntities(text).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

const attributes = (tag: string): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    found[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return found;
};

/** Title, description and site name from a page's HTML, or null when it names no title. */
export function parseLinkPreview(html: string): LinkPreview | null {
  // Metadata lives in <head>; never scan a whole large document.
  const head = html.slice(0, 200_000).split(/<body[\s>]/i)[0]!;
  const meta = new Map<string, string>();
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  const pick = (...keys: string[]) => keys.map((key) => meta.get(key) ?? '').find((value) => value.trim()) ?? '';

  const title = tidy(pick('og:title', 'twitter:title') || titleTag, MAX_TITLE);
  if (!title) return null;
  return {
    title,
    description: tidy(pick('og:description', 'twitter:description', 'description'), MAX_DESCRIPTION),
    site: tidy(pick('og:site_name', 'application-name'), MAX_SITE),
  };
}

/** `charset` from a Content-Type header or the document's own <meta>. */
export function htmlCharset(contentType: string, head: string): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}
