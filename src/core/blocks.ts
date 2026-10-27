// Notion 正文块 ⇄ HTML / Markdown 的纯函数集合。
// 不依赖网络，方便单元测试；所有文本与 URL 都经过 safety.ts 处理。
import { esc, safeUrl } from './safety.ts';
import type { RichTextItem } from './rich-text.ts';

export interface NotionBlock {
  id?: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: any;
}

/** 富文本 → HTML（保留加粗/斜体/删除线/下划线/代码/链接/行内公式）。 */
export function richTextHtml(items: RichTextItem[] = []): string {
  return (items ?? []).map((t) => {
    const raw = t?.plain_text ?? t?.text?.content ?? '';
    let html = esc(raw);
    if (t?.type === 'equation' || t?.equation) html = `<code>${html}</code>`;
    const a = t?.annotations ?? {};
    if (a.code) html = `<code>${html}</code>`;
    if (a.bold) html = `<strong>${html}</strong>`;
    if (a.italic) html = `<em>${html}</em>`;
    if (a.underline) html = `<u>${html}</u>`;
    if (a.strikethrough) html = `<s>${html}</s>`;
    const href = safeUrl(t?.href ?? t?.text?.link?.url ?? null);
    if (href) {
      const target = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      html = `<a href="${esc(href)}"${target}>${html}</a>`;
    }
    return html;
  }).join('');
}

const typeOf = (block: NotionBlock) => block?.type ?? '';
const payload = (block: NotionBlock): any => block?.[typeOf(block)] ?? {};
const isList = (t: string) => t === 'bulleted_list_item' || t === 'numbered_list_item';

const imgSrc = (d: any): string | null => safeUrl(d?.type === 'external' ? d?.external?.url : d?.file?.url);

function mediaHtml(type: string, d: any): string {
  const src = imgSrc(d);
  if (!src) return '';
  const caption = richTextHtml(d?.caption ?? []);
  const fig = (inner: string) => `<figure>${inner}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  const label = src.split('/').pop()?.split('?')[0] ?? 'file';
  switch (type) {
    case 'image': return fig(`<img src="${esc(src)}" alt="${esc(caption || label)}" loading="lazy" decoding="async">`);
    case 'video': return fig(`<video controls preload="metadata" src="${esc(src)}"></video>`);
    case 'audio': return fig(`<audio controls preload="metadata" src="${esc(src)}"></audio>`);
    case 'pdf': return fig(`<p><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(caption || label)} (PDF)</a></p>`);
    case 'file': return fig(`<p><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(caption || label)}</a></p>`);
    default: return '';
  }
}

function renderBlock(block: NotionBlock, depth: number, children: NotionBlock[] = []): string {
  const type = typeOf(block);
  const d = payload(block);
  const text = richTextHtml(d?.rich_text ?? []);
  const nested = depth < 2 && children.length
    ? `<div class="children">${blocksToHtml(children, depth + 1)}</div>`
    : '';
  switch (type) {
    case 'paragraph': return text ? `<p>${text}</p>` : '';
    case 'heading_1': return `<h2>${text}</h2>`;
    case 'heading_2': return `<h3>${text}</h3>`;
    case 'heading_3': return `<h4>${text}</h4>`;
    case 'quote': return `<blockquote>${text}${nested}</blockquote>`;
    case 'callout': return `<aside class="callout"><p>${text}</p>${nested}</aside>`;
    case 'divider': return '<hr>';
    case 'code': {
      const lang = String(d?.language ?? '').replace(/[^\w+#-]/g, '');
      const code = esc((d?.rich_text ?? []).map((t: RichTextItem) => t.plain_text ?? '').join(''));
      return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${code}</code></pre>`;
    }
    case 'to_do': return `<p class="todo"><span aria-hidden="true">${d?.checked ? '☑' : '☐'}</span> ${text}</p>`;
    case 'toggle': return `<details><summary>${text}</summary>${nested}</details>`;
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'pdf':
      return mediaHtml(type, d);
    case 'bookmark':
    case 'embed':
    case 'link_preview': {
      const href = safeUrl(d?.url);
      if (!href) return '';
      const caption = richTextHtml(d?.caption ?? []);
      return `<p class="embed"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(caption || href)}</a></p>`;
    }
    case 'equation': return `<p class="equation"><code>${esc(d?.expression ?? '')}</code></p>`;
    case 'table_row':
    case 'table':
      return '';
    case 'synced_block':
    case 'column_list':
    case 'column':
      return nested;
    case 'child_page': return `<p class="child-page">${esc(d?.title ?? '')}</p>`;
    default:
      // 未知块类型：保留可读文本，而不是整段丢失
      return text ? `<p>${text}</p>` : '';
  }
}

/**
 * 把 Notion blocks 渲染成 HTML。连续的列表项会被合并进同一个 <ul>/<ol>，
 * 最多递归两层子块（toggle / list 的缩进内容）。
 */
export function blocksToHtml(blocks: NotionBlock[], depth = 0): string {
  let html = '';
  let buffer: NotionBlock[] = [];
  let bufferType = '';
  const flush = () => {
    if (!buffer.length) return;
    const tag = bufferType === 'numbered_list_item' ? 'ol' : 'ul';
    html += `<${tag}>${buffer.map((b) => {
      const d = payload(b);
      const text = richTextHtml(d?.rich_text ?? []);
      const nested = depth < 2 && b.children?.length
        ? `<div class="children">${blocksToHtml(b.children, depth + 1)}</div>` : '';
      return `<li>${text}${nested}</li>`;
    }).join('')}</${tag}>`;
    buffer = [];
    bufferType = '';
  };

  for (const block of blocks ?? []) {
    const type = typeOf(block);
    if (isList(type)) {
      if (bufferType && bufferType !== type) flush();
      bufferType = type;
      buffer.push(block);
      continue;
    }
    flush();
    html += renderBlock(block, depth, block.children ?? []);
  }
  flush();
  return html;
}

/** Notion rich_text 单个 item 的内容上限是 2000 字符，超出要分片。 */
export function richChunks(text: string, size = 1900) {
  const s = String(text ?? '');
  if (!s) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

const rich = (text: string) => richChunks(text).map((content) => ({ type: 'text', text: { content } }));

/** 生成一个段/标题/引用的 block 对象。 */
const textBlock = (type: string, text: string) => ({ object: 'block', type, [type]: { rich_text: rich(text) } });

/**
 * 简化 Markdown → Notion blocks：标题、引用、项目符号、编号列表、代码块、分隔线、
 * 以及按空行分段的普通文本。用于把后台表单里的正文写入 Notion 页面。
 */
export function markdownToBlocks(source: string, maxBlocks = 500): any[] {
  const blocks: any[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  let codeLang = '';

  const flushPara = () => {
    const text = para.join('\n').trim();
    para = [];
    if (text) blocks.push(textBlock('paragraph', text));
  };

  for (const raw of String(source ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const fence = /^```\s*([\w+#-]*)\s*$/.exec(line.trim());
    if (fence) {
      if (code) {
        blocks.push({ object: 'block', type: 'code', code: { rich_text: rich(code.join('\n')), language: codeLang || 'plain text' } });
        code = null; codeLang = '';
      } else { flushPara(); code = []; codeLang = fence[1] ?? ''; }
      continue;
    }
    if (code) { code.push(raw); continue; }
    if (!line.trim()) { flushPara(); continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push(textBlock(`heading_${heading[1].length}`, heading[2].trim()));
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { flushPara(); blocks.push(textBlock('quote', quote[1])); continue; }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) { flushPara(); blocks.push(textBlock('bulleted_list_item', bullet[1])); continue; }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) { flushPara(); blocks.push(textBlock('numbered_list_item', numbered[1])); continue; }
    para.push(line);
  }
  if (code) blocks.push({ object: 'block', type: 'code', code: { rich_text: rich(code.join('\n')), language: codeLang || 'plain text' } });
  flushPara();
  return blocks.slice(0, maxBlocks);
}
