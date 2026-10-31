export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;
export const SHARE_CARD_TEXT_LIMIT = 200;

export interface ShareCardData {
  title: string;
  excerpt: string;
  date: string;
  siteName: string;
  tags: string;
  /** Canonical article address, without a text fragment or local note. */
  articleUrl: string;
  locale: string;
  /** Optional passage / reader note mode; the ordinary article card stays available. */
  quote?: string;
  note?: string;
  passageLabel?: string;
  noteLabel?: string;
  /** An already loaded, CORS-safe image. Drawing never fetches a remote resource. */
  cover?: CanvasImageSource;
  coverWidth?: number;
  coverHeight?: number;
}

type TextMeasurer = Pick<CanvasRenderingContext2D, 'measureText'>;
type CardTextContext = Pick<CanvasRenderingContext2D, 'measureText' | 'font'>;
type BlockKind = 'title' | 'quote' | 'body' | 'note' | 'meta' | 'url';

function segments(text: string, locale: string, granularity: 'word' | 'grapheme'): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(locale, { granularity }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

function allLines(context: TextMeasurer, value: string, maxWidth: number, locale: string): string[] {
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text) return [];
  const lines: string[] = [];
  let line = '';
  for (const token of segments(text, locale, 'word')) {
    if (!line && /^\s+$/u.test(token)) continue;
    if (context.measureText(line + token).width <= maxWidth) {
      line += token;
      continue;
    }
    if (line.trim()) lines.push(line.trim());
    line = token.trimStart();
    if (context.measureText(line).width <= maxWidth) continue;
    line = '';
    for (const character of segments(token.trimStart(), locale, 'grapheme')) {
      if (line && context.measureText(line + character).width > maxWidth) {
        lines.push(line.trim());
        line = '';
      }
      line += character;
    }
  }
  if (line.trim()) lines.push(line.trim());
  // Avoid a final orphaned punctuation mark or one-character CJK line. Move
  // whole word segments from the previous line instead of shrinking everything.
  if (lines.length > 1) {
    const last = lines[lines.length - 1]!;
    if (segments(last, locale, 'grapheme').length <= 2) {
      const previousTokens = segments(lines[lines.length - 2]!, locale, 'word');
      const moved: string[] = [];
      let movedLength = 0;
      while (previousTokens.length && movedLength < 10) {
        const token = previousTokens.pop()!;
        moved.unshift(token);
        movedLength += segments(token, locale, 'grapheme').length;
      }
      const previous = previousTokens.join('').trimEnd();
      const tail = `${moved.join('').trimStart()}${last}`;
      if (previous && moved.length && context.measureText(tail).width <= maxWidth) {
        lines[lines.length - 2] = previous;
        lines[lines.length - 1] = tail;
      }
    }
  }
  return lines;
}

/** Wrap by words where possible, and by graphemes for long CJK or unbroken runs. */
export function wrapCardText(
  context: TextMeasurer,
  value: string,
  maxWidth: number,
  maxLines: number,
  locale = 'en',
): string[] {
  if (maxLines < 1) return [];
  const lines = allLines(context, value, maxWidth, locale);
  const result = lines.slice(0, maxLines);
  if (lines.length > maxLines && result.length) {
    let last = result[result.length - 1];
    while (last && context.measureText(`${last}…`).width > maxWidth) last = segments(last, locale, 'grapheme').slice(0, -1).join('');
    result[result.length - 1] = `${last.trimEnd()}…`;
  }
  return result;
}

function oneLine(context: TextMeasurer, text: string, width: number, locale: string): string {
  return wrapCardText(context, text, width, 1, locale)[0] || '';
}

function cardFont(kind: BlockKind, size: number): string {
  if (kind === 'title' || kind === 'quote') return `700 ${size}px "Noto Serif TC", "Songti TC", "PMingLiU", "Times New Roman", serif`;
  if (kind === 'meta' || kind === 'url') return `${size}px "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
  return `${size}px "Noto Serif TC", "Songti TC", "PMingLiU", "Times New Roman", serif`;
}

interface CardBlock {
  text: string;
  kind: BlockKind;
  startSize: number;
  minimumSize: number;
  lineHeight: number;
  gapAfter?: number;
  label?: string;
  indent?: number;
  rawLength?: number;
  truncateAfter?: number;
}

interface CardLayout extends CardBlock {
  lines: string[];
  size: number;
  lineHeightPixels: number;
  height: number;
}

const lengthOf = (value: string): number => Array.from(value).length;

function layoutAt(
  context: CardTextContext,
  blocks: CardBlock[],
  sizes: number[],
  width: number,
  locale: string,
): { layouts: CardLayout[]; height: number } {
  let height = 0;
  const layouts = blocks.map((block, index) => {
    const size = sizes[index]!;
    context.font = cardFont(block.kind, size);
    const lines = allLines(context, block.text, width - (block.indent || 0), locale);
    const lineHeightPixels = Math.max(12, Math.round(size * block.lineHeight));
    const blockHeight = (block.label ? 25 : 0) + lines.length * lineHeightPixels + (index < blocks.length - 1 ? block.gapAfter || 0 : 0);
    height += blockHeight;
    return { ...block, lines, size, lineHeightPixels, height: blockHeight };
  });
  return { layouts, height };
}

/**
 * Fit complete text before considering an ellipsis. Reader excerpts/passages up
 * to 200 characters are never cut; notes use their existing 280-character
 * allowance. Only an over-limit block can lose lines in the final fallback.
 */
function fitBlocks(
  context: CardTextContext,
  blocks: CardBlock[],
  width: number,
  availableHeight: number,
  locale: string,
): CardLayout[] {
  const normalMinimum = Math.max(...blocks.map((block) => block.minimumSize));
  const canTruncate = blocks.some((block) => (block.rawLength ?? lengthOf(block.text)) > (block.truncateAfter ?? SHARE_CARD_TEXT_LIMIT));
  const floor = canTruncate ? normalMinimum : 10;
  for (let reduction = 0; reduction <= 100; reduction += 2) {
    const sizes = blocks.map((block) => Math.max(canTruncate ? block.minimumSize : 10, block.startSize - reduction));
    const result = layoutAt(context, blocks, sizes, width, locale);
    if (result.height <= availableHeight) return result.layouts;
    if (sizes.every((size, index) => size <= (canTruncate ? blocks[index]!.minimumSize : floor))) break;
  }

  const sizes = blocks.map((block) => canTruncate ? block.minimumSize : 10);
  const result = layoutAt(context, blocks, sizes, width, locale);
  let remainingHeight = result.height;
  for (let index = result.layouts.length - 1; index >= 0 && remainingHeight > availableHeight; index--) {
    const layout = result.layouts[index]!;
    const rawLength = layout.rawLength ?? lengthOf(layout.text);
    if (rawLength <= (layout.truncateAfter ?? SHARE_CARD_TEXT_LIMIT)) continue;
    while (layout.lines.length > 1 && remainingHeight > availableHeight) {
      context.font = cardFont(layout.kind, layout.size);
      const nextLines = wrapCardText(context, layout.text, width - (layout.indent || 0), layout.lines.length - 1, locale);
      const nextHeight = layout.height - layout.lineHeightPixels;
      layout.lines = nextLines;
      remainingHeight -= layout.height - nextHeight;
      layout.height = nextHeight;
    }
  }
  return result.layouts;
}

function drawBlocks(
  context: CanvasRenderingContext2D,
  layouts: CardLayout[],
  x: number,
  y: number,
): void {
  let cursor = y;
  for (const layout of layouts) {
    const indent = layout.indent || 0;
    if (layout.kind === 'note') {
      context.fillStyle = 'rgba(244,237,227,0.035)';
      context.fillRect(x - 12, cursor - 12, 1068, layout.height + 18);
      context.fillStyle = '#ff2b3d';
      context.fillRect(x - 12, cursor - 12, 3, layout.height + 18);
    }
    if (layout.label) {
      context.font = '16px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
      context.fillStyle = '#e7a395';
      context.fillText(layout.label, x + indent, cursor);
      cursor += 25;
    }
    context.font = cardFont(layout.kind, layout.size);
    context.fillStyle = layout.kind === 'body' || layout.kind === 'note' ? 'rgba(244,237,227,0.76)' : layout.kind === 'meta' || layout.kind === 'url' ? 'rgba(244,237,227,0.62)' : '#f4ede3';
    for (const line of layout.lines) {
      context.fillText(line, x + indent, cursor);
      cursor += layout.lineHeightPixels;
    }
    cursor += layout.gapAfter || 0;
  }
}

function drawCover(context: CanvasRenderingContext2D, data: ShareCardData): void {
  const naturalWidth = data.coverWidth || 0;
  const naturalHeight = data.coverHeight || 0;
  if (!data.cover || naturalWidth <= 0 || naturalHeight <= 0) return;
  const scale = Math.max(SHARE_CARD_WIDTH / naturalWidth, SHARE_CARD_HEIGHT / naturalHeight);
  const sourceWidth = SHARE_CARD_WIDTH / scale;
  const sourceHeight = SHARE_CARD_HEIGHT / scale;
  const sourceX = (naturalWidth - sourceWidth) / 2;
  const sourceY = (naturalHeight - sourceHeight) / 2;
  context.save();
  context.drawImage(data.cover, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  context.fillStyle = 'rgba(10,5,6,0.68)';
  context.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  const shade = context.createLinearGradient(0, 0, SHARE_CARD_WIDTH, 0);
  shade.addColorStop(0, 'rgba(10,5,6,0.68)');
  shade.addColorStop(0.62, 'rgba(10,5,6,0.22)');
  shade.addColorStop(1, 'rgba(10,5,6,0.08)');
  context.fillStyle = shade;
  context.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  context.restore();
}

/** A self-contained editorial card with a live-preview counterpart in the dialog. */
export function drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): boolean {
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillStyle = '#0a0506';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const hasCover = Boolean(data.cover && (data.coverWidth || 0) > 0 && (data.coverHeight || 0) > 0);
  if (hasCover) drawCover(context, data);
  const glow = context.createRadialGradient(72, 140, 0, 72, 140, 560);
  glow.addColorStop(0, 'rgba(255,43,61,0.14)');
  glow.addColorStop(1, 'rgba(255,43,61,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(244,237,227,0.22)';
  context.lineWidth = 1;
  context.strokeRect(36.5, 36.5, 1127, 557);

  const x = 72;
  const width = 1056;
  context.font = '800 27px "Archivo Variable", "Red Room Display SC", sans-serif';
  context.fillStyle = '#f4ede3';
  context.fillText(oneLine(context, data.siteName, 720, data.locale), x, 62);
  if (data.date) {
    context.font = '20px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
    context.fillStyle = 'rgba(244,237,227,0.62)';
    context.textAlign = 'right';
    context.fillText(oneLine(context, data.date, 280, data.locale), 1128, 66);
    context.textAlign = 'left';
  }
  context.font = '17px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
  context.fillStyle = '#e7a395';
  const overline = data.quote ? data.passageLabel || (data.locale.startsWith('zh') ? '选段' : 'SELECTED PASSAGE') : data.tags;
  if (overline) context.fillText(oneLine(context, overline, width, data.locale), x, 112);
  context.fillStyle = '#ff2b3d';
  context.fillRect(x, 140, 34, 3);

  const blocks: CardBlock[] = data.quote
    ? [
        { text: data.title || data.siteName, kind: 'meta', startSize: 22, minimumSize: 16, lineHeight: 1.3, gapAfter: 16, truncateAfter: Number.POSITIVE_INFINITY },
        { text: `“${data.quote}”`, kind: 'quote', startSize: 42, minimumSize: 18, lineHeight: 1.22, gapAfter: data.note ? 22 : 0, rawLength: lengthOf(data.quote) },
        ...(data.note ? [{ text: data.note, kind: 'note' as const, startSize: 24, minimumSize: 15, lineHeight: 1.38, label: data.noteLabel || (data.locale.startsWith('zh') ? '笔记' : 'NOTE'), indent: 18, truncateAfter: Number.POSITIVE_INFINITY }] : []),
      ]
    : [
        { text: data.title || data.siteName, kind: 'title', startSize: 64, minimumSize: 28, lineHeight: 1.1, gapAfter: data.excerpt ? 26 : 0 },
        ...(data.excerpt ? [{ text: data.excerpt, kind: 'body' as const, startSize: 28, minimumSize: 16, lineHeight: 1.42 }] : []),
      ];
  const content = fitBlocks(context, blocks, width, 344, data.locale);
  drawBlocks(context, content, x, 160);

  context.fillStyle = 'rgba(244,237,227,0.18)';
  context.fillRect(x, 528, width, 1);
  context.fillStyle = '#ff2b3d';
  context.fillRect(x, 528, 30, 3);
  if (data.articleUrl) {
    const urlBlock: CardBlock = { text: data.articleUrl, kind: 'url', startSize: 18, minimumSize: 14, lineHeight: 1.35, truncateAfter: Number.POSITIVE_INFINITY };
    const url = fitBlocks(context, [urlBlock], width, 60, data.locale);
    drawBlocks(context, url, x, 548);
  }
  return true;
}

export function shareCardPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
  });
}
