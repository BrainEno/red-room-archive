/**
 * Notion blocks → sanitised HTML.
 *
 * Pure and synchronous: the caller fetches the block tree (children already
 * attached as `block.children`) and supplies a small context for the two
 * things that depend on the site — where Notion-hosted files are served from
 * and which Notion pages are published articles. Everything that ends up in
 * HTML goes through `esc` / `safeUrl`, because public pages use `set:html`.
 */
import { esc, safeUrl } from './safety.ts';
import { highlightCode } from './highlight.ts';
import { renderMath } from './math.ts';
import { classifyMedia } from './media.ts';
import { slugify } from './slug.ts';
import { plainText, type RichTextItem } from './rich-text.ts';
import type { TocEntry } from '../shared/contracts.ts';

export interface NotionBlock {
  id?: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: any;
}

export interface LinkedPage {
  href: string;
  title: string;
}

/** What a bookmark's page says about itself (fetched by the server, see services/link-preview.ts). */
export interface LinkPreview {
  title: string;
  description: string;
  site: string;
}

export interface RenderContext {
  /**
   * URL for a Notion-hosted file (`{ type: 'file' }`), whose signed URL
   * expires. `owner` is the block id. Return null to drop the media.
   */
  fileUrl?: (owner: string) => string | null;
  /** A published article for a Notion page id, or null (link is dropped). */
  page?: (pageId: string) => LinkedPage | null;
  /** Title/description of a bookmarked URL, when known (never fetched during rendering). */
  bookmark?: (url: string) => LinkPreview | null;
}

export interface RenderResult {
  html: string;
  toc: TocEntry[];
  /** Plain text (search index, reading time). */
  text: string;
  /** Block ids whose Notion-hosted files were referenced through `fileUrl`. */
  files: string[];
}

const NOTION_ID = /^[0-9a-f]{32}$/i;
const compactId = (id: string) => id.replace(/-/g, '').toLowerCase();

/** `"red_background"` → `" nc-red_background"`; default / unknown → `""`. */
const colorClass = (color: unknown) =>
  typeof color === 'string' && color !== 'default' && /^[a-z]+(_background)?$/.test(color) ? ` nc-${color}` : '';

const classAttr = (base: string, color?: unknown) => {
  const value = `${base}${colorClass(color)}`.trim();
  return value ? ` class="${value}"` : '';
};

const external = (href: string) => (/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '');

const hostLabel = (href: string) => {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
};

class Renderer {
  private readonly ctx: RenderContext;
  private readonly ids = new Map<NotionBlock, string>();
  private readonly usedIds = new Set<string>();
  readonly toc: TocEntry[] = [];
  readonly text: string[] = [];
  readonly files = new Set<string>();

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
  }

  /* ── pass 1: heading anchors + table of contents ───────────────────── */

  collectHeadings(blocks: NotionBlock[]) {
    for (const block of blocks ?? []) {
      const level = /^heading_([123])$/.exec(block?.type ?? '')?.[1];
      if (level) {
        const text = plainText(block[block.type]?.rich_text).trim();
        const base = slugify(text) || 'section';
        let id = base;
        for (let n = 2; this.usedIds.has(id); n++) id = `${base}-${n}`;
        this.usedIds.add(id);
        this.ids.set(block, id);
        if (text) this.toc.push({ id, text, level: Number(level) as 1 | 2 | 3 });
      }
      if (block?.children?.length) this.collectHeadings(block.children);
    }
  }

  /* ── rich text ─────────────────────────────────────────────────────── */

  /** Resolve a Notion-internal link (`/0123…` or a notion.so URL) to an article. */
  private internalHref(href: string): string | null | undefined {
    const relative = /^\/([0-9a-f]{32})(?:[?#].*)?$/i.exec(href)?.[1];
    const notion = /^https?:\/\/(?:www\.)?notion\.(?:so|site)\/.*?([0-9a-f]{32})(?:[?#].*)?$/i.exec(href)?.[1];
    const id = relative ?? notion;
    if (!id) return undefined; // not a Notion link
    const page = this.ctx.page?.(id);
    if (page) return page.href;
    return relative ? null : href; // unpublished workspace page → drop relative links, keep public notion.so ones
  }

  rich(items: RichTextItem[] | undefined | null, collect = true): string {
    const list = items ?? [];
    if (collect) this.text.push(plainText(list));
    return list
      .map((item) => {
        const raw = item?.plain_text ?? item?.text?.content ?? '';
        let html = esc(raw);
        let href: string | null = item?.href ?? item?.text?.link?.url ?? null;

        if (item?.type === 'equation') {
          html = renderMath(item.equation?.expression ?? raw);
        } else if (item?.type === 'mention') {
          const mention = item.mention ?? {};
          if (mention.type === 'page' && mention.page?.id) {
            const page = this.ctx.page?.(compactId(mention.page.id));
            href = page?.href ?? null;
            html = `<span class="mention">${esc(raw || page?.title || '')}</span>`;
          } else if (mention.type === 'date') {
            html = `<time datetime="${esc(mention.date?.start ?? '')}">${html}</time>`;
            href = null;
          } else if (mention.type === 'link_preview' || mention.type === 'link_mention') {
            href = mention.link_preview?.url ?? mention.link_mention?.href ?? href;
          } else {
            href = null; // users, databases, templates: text only
          }
        }

        const a = item?.annotations ?? {};
        if (a.code) html = `<code>${html}</code>`;
        if (a.bold) html = `<strong>${html}</strong>`;
        if (a.italic) html = `<em>${html}</em>`;
        if (a.underline) html = `<u>${html}</u>`;
        if (a.strikethrough) html = `<s>${html}</s>`;
        if (colorClass(a.color)) html = `<span class="${colorClass(a.color).trim()}">${html}</span>`;

        if (href && item?.type !== 'mention') {
          const internal = this.internalHref(href);
          if (internal !== undefined) href = internal;
        }
        const safe = safeUrl(href);
        if (safe) html = `<a href="${esc(safe)}"${external(safe)}>${html}</a>`;
        return html;
      })
      .join('');
  }

  /* ── media ─────────────────────────────────────────────────────────── */

  /** Source URL for a file object (`{ type, file, external }`) owned by `owner`. */
  private source(owner: string | undefined, data: any): string | null {
    if (data?.type === 'external') return safeUrl(data.external?.url);
    if (data?.type === 'file' && owner) {
      const url = this.ctx.fileUrl ? this.ctx.fileUrl(owner) : safeUrl(data.file?.url);
      if (url) this.files.add(owner);
      return url;
    }
    return null;
  }

  private figure(inner: string, caption: string, className = '') {
    return `<figure${className ? ` class="${className}"` : ''}>${inner}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  }

  private iframe(src: string, title: string, className = 'embed') {
    return `<div class="${className}"><iframe src="${esc(src)}" title="${esc(title)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }

  private bookmark(url: unknown, caption: string) {
    const href = safeUrl(url);
    if (!href) return '';
    const preview = this.ctx.bookmark?.(href) ?? null;
    if (!preview?.title) {
      return `<a class="bookmark" href="${esc(href)}"${external(href)}><span class="bookmark-title">${caption || esc(hostLabel(href))}</span><span class="bookmark-url">${esc(href)}</span></a>`;
    }
    // With a preview the page's own title leads; the author's caption (if any) follows as a figcaption.
    const card = `<a class="bookmark has-preview" href="${esc(href)}"${external(href)}><span class="bookmark-title">${esc(preview.title)}</span>${
      preview.description ? `<span class="bookmark-desc">${esc(preview.description)}</span>` : ''
    }<span class="bookmark-url">${esc(preview.site || hostLabel(href))}</span></a>`;
    return caption ? `<figure class="bookmark-figure">${card}<figcaption>${caption}</figcaption></figure>` : card;
  }

  private media(block: NotionBlock): string {
    const type = block.type;
    const d = block[type] ?? {};
    const caption = this.rich(d.caption);
    const externalUrl = d.type === 'external' ? d.external?.url : null;

    if (type === 'video' && externalUrl) {
      const media = classifyMedia(externalUrl);
      if (media.kind === 'embed') return this.figure(this.iframe(media.src, plainText(d.caption) || 'Video'), caption, 'media');
      if (media.kind === 'link') return this.bookmark(media.href, caption);
    }

    const src = this.source(block.id, d);
    if (!src) return '';
    const name = d.name || src.split('/').pop()?.split('?')[0] || 'file';
    switch (type) {
      case 'image':
        return this.figure(`<img src="${esc(src)}" alt="${esc(plainText(d.caption) || '')}" loading="lazy" decoding="async">`, caption, 'media');
      case 'video':
        return this.figure(`<video controls preload="metadata" playsinline src="${esc(src)}"></video>`, caption, 'media');
      case 'audio':
        return this.figure(`<audio controls preload="metadata" src="${esc(src)}"></audio>`, caption, 'media');
      case 'pdf':
        return this.figure(`<a class="file" href="${esc(src)}"${external(src)}>${esc(name)} <small>PDF</small></a>`, caption);
      default:
        return this.figure(`<a class="file" href="${esc(src)}"${external(src)} download>${esc(name)}</a>`, caption);
    }
  }

  /* ── blocks ────────────────────────────────────────────────────────── */

  blocks(blocks: NotionBlock[] = []): string {
    let html = '';
    for (let i = 0; i < blocks.length; i++) {
      const type = blocks[i]?.type;
      const list = type === 'bulleted_list_item' ? 'ul' : type === 'numbered_list_item' ? 'ol' : type === 'to_do' ? 'ul class="todo"' : '';
      if (!list) {
        html += this.block(blocks[i]);
        continue;
      }
      let items = '';
      while (i < blocks.length && blocks[i]?.type === type) items += this.listItem(blocks[i++]);
      i--;
      html += `<${list}>${items}</${list.split(' ')[0]}>`;
    }
    return html;
  }

  private children(block: NotionBlock, wrap = ''): string {
    if (!block.children?.length) return '';
    const inner = this.blocks(block.children);
    return wrap ? `<div class="${wrap}">${inner}</div>` : inner;
  }

  private listItem(block: NotionBlock): string {
    const d = block[block.type] ?? {};
    const text = this.rich(d.rich_text);
    if (block.type === 'to_do') {
      return `<li${classAttr(d.checked ? 'done' : '', d.color)}><label><input type="checkbox" disabled${d.checked ? ' checked' : ''}> <span>${text}</span></label>${this.children(block)}</li>`;
    }
    return `<li${classAttr('', d.color)}>${text}${this.children(block)}</li>`;
  }

  private tocHtml(color: unknown): string {
    if (!this.toc.length) return '';
    const items = this.toc
      .map((entry) => `<li class="toc-l${entry.level}"><a href="#${esc(entry.id)}">${esc(entry.text)}</a></li>`)
      .join('');
    return `<nav${classAttr('toc', color)} aria-label="Contents"><ol>${items}</ol></nav>`;
  }

  private table(block: NotionBlock): string {
    const d = block.table ?? {};
    const rows = (block.children ?? []).filter((row) => row.type === 'table_row');
    if (!rows.length) return '';
    const renderRow = (row: NotionBlock, header: boolean) => {
      const cells = (row.table_row?.cells ?? []) as RichTextItem[][];
      return `<tr>${cells
        .map((cell, index) => {
          const content = this.rich(cell);
          if (header) return `<th scope="col">${content}</th>`;
          if (d.has_row_header && index === 0) return `<th scope="row">${content}</th>`;
          return `<td>${content}</td>`;
        })
        .join('')}</tr>`;
    };
    const [first, ...rest] = rows;
    const head = d.has_column_header ? `<thead>${renderRow(first!, true)}</thead>` : '';
    const body = (d.has_column_header ? rest : rows).map((row) => renderRow(row, false)).join('');
    return `<div class="table-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
  }

  private block(block: NotionBlock): string {
    if (!block?.type) return '';
    const type = block.type;
    const d = block[type] ?? {};

    switch (type) {
      case 'paragraph': {
        const text = this.rich(d.rich_text);
        const nested = this.children(block, 'indent');
        // Notion uses an empty paragraph block as intentional vertical space.
        return text || nested ? `${text ? `<p${classAttr('', d.color)}>${text}</p>` : ''}${nested}`
          : '<p class="notion-blank-line" aria-hidden="true"><br></p>';
      }
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        const tag = `h${Number(type.slice(-1)) + 1}`;
        const id = this.ids.get(block);
        const heading = `<${tag}${id ? ` id="${esc(id)}"` : ''}${classAttr('', d.color)}>${this.rich(d.rich_text)}</${tag}>`;
        if (d.is_toggleable) return `<details class="toggle toggle-heading"><summary>${heading}</summary>${this.children(block)}</details>`;
        return heading;
      }
      case 'quote':
        return `<blockquote${classAttr('', d.color)}><p>${this.rich(d.rich_text)}</p>${this.children(block)}</blockquote>`;
      case 'callout': {
        const icon = d.icon?.type === 'emoji'
          ? `<span class="callout-icon" aria-hidden="true">${esc(d.icon.emoji)}</span>`
          : d.icon?.type === 'external' && safeUrl(d.icon.external?.url)
            ? `<img class="callout-icon" src="${esc(safeUrl(d.icon.external.url))}" alt="" loading="lazy">`
            : '';
        return `<aside${classAttr('callout', d.color)}>${icon}<div class="callout-body"><p>${this.rich(d.rich_text)}</p>${this.children(block)}</div></aside>`;
      }
      case 'toggle':
        return `<details${classAttr('toggle', d.color)}><summary>${this.rich(d.rich_text)}</summary>${this.children(block)}</details>`;
      case 'divider':
        return '<hr>';
      case 'code': {
        const language = String(d.language ?? '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w+#-]/g, '');
        const code = plainText(d.rich_text);
        this.text.push(code);
        const caption = this.rich(d.caption);
        const label = language && language !== 'plain-text' ? ` data-lang="${esc(language)}"` : '';
        return `<figure class="code"><pre${label}><code${language ? ` class="language-${esc(language)} hljs"` : ''}>${highlightCode(code, language)}</code></pre>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
      }
      case 'equation': {
        const math = renderMath(d.expression ?? '', true);
        if (math) this.text.push(String(d.expression ?? ''));
        return math ? `<div class="equation">${math}</div>` : '';
      }
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf':
        return this.media(block);
      case 'embed': {
        const caption = this.rich(d.caption);
        const media = classifyMedia(d.url);
        if (media.kind === 'embed') return this.figure(this.iframe(media.src, plainText(d.caption) || media.provider), caption, 'media');
        if (media.kind === 'video') return this.figure(`<video controls preload="metadata" playsinline src="${esc(media.src)}"></video>`, caption, 'media');
        if (media.kind === 'audio') return this.figure(`<audio controls preload="metadata" src="${esc(media.src)}"></audio>`, caption, 'media');
        return this.bookmark(d.url, caption);
      }
      case 'bookmark':
      case 'link_preview':
        return this.bookmark(d.url, this.rich(d.caption));
      case 'table':
        return this.table(block);
      case 'column_list':
        return `<div class="columns">${(block.children ?? []).map((column) => `<div class="column">${this.blocks(column.children ?? [])}</div>`).join('')}</div>`;
      case 'column':
        return `<div class="column">${this.children(block)}</div>`;
      case 'synced_block':
        return this.children(block);
      case 'table_of_contents':
        return this.tocHtml(d.color);
      case 'link_to_page':
      case 'child_page': {
        const id = type === 'child_page' ? block.id : d.page_id;
        const page = id ? this.ctx.page?.(compactId(id)) : null;
        if (!page) return ''; // never link to pages that are not published articles
        return `<p class="page-link"><a href="${esc(page.href)}">${esc(type === 'child_page' ? d.title || page.title : page.title)}</a></p>`;
      }
      // Bulleted/numbered/to-do items that reach here were not grouped (shouldn't happen).
      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'to_do':
        return `<ul>${this.listItem(block)}</ul>`;
      default:
        // child_database, breadcrumb, template, unsupported …: nothing public to show.
        return '';
    }
  }
}

/**
 * Every URL the renderer would show as a bookmark card (bookmark and
 * link_preview blocks, embeds that are not playable media), so the caller
 * can look up previews before rendering.
 */
export function bookmarkUrls(blocks: NotionBlock[] = []): string[] {
  const found = new Set<string>();
  const walk = (list: NotionBlock[]) => {
    for (const block of list ?? []) {
      const d = block?.[block?.type] ?? {};
      if (block?.type === 'bookmark' || block?.type === 'link_preview' || (block?.type === 'embed' && classifyMedia(d.url).kind === 'link')) {
        const href = safeUrl(d.url);
        if (href && /^https?:/i.test(href)) found.add(href);
      }
      if (block?.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  return [...found];
}

/** Render a block tree. Headings get stable anchors; `table_of_contents` blocks list them. */
export function renderBlocks(blocks: NotionBlock[] = [], ctx: RenderContext = {}): RenderResult {
  const renderer = new Renderer(ctx);
  renderer.collectHeadings(blocks);
  const html = renderer.blocks(blocks);
  return {
    html,
    toc: renderer.toc,
    text: renderer.text.filter(Boolean).join('\n').replace(/[ \t]+/g, ' ').trim(),
    files: [...renderer.files],
  };
}

export { NOTION_ID, compactId };
