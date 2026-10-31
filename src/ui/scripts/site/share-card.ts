export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

export interface ShareCardData {
  title: string;
  excerpt: string;
  date: string;
  siteName: string;
  tags: string;
  hostname: string;
  locale: string;
  /** Optional passage / reader note mode; the ordinary article card stays unchanged. */
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

function segments(text: string, locale: string, granularity: 'word' | 'grapheme'): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(locale, { granularity }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/** Wrap by words where possible, and by Unicode code points for long CJK or unbroken runs. */
export function wrapCardText(
  context: TextMeasurer,
  value: string,
  maxWidth: number,
  maxLines: number,
  locale = 'en',
): string[] {
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text || maxLines < 1) return [];
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

function titleFont(size: number): string {
  return `700 ${size}px "Noto Serif TC", "Songti TC", "PMingLiU", "Times New Roman", serif`;
}

function fittedLines(context: CanvasRenderingContext2D, value: string, width: number, maxLines: number, locale: string, start: number, minimum: number): { lines: string[]; size: number } {
  let size = start;
  let lines: string[] = [];
  while (size >= minimum) {
    context.font = titleFont(size);
    lines = wrapCardText(context, value, width, maxLines, locale);
    if (!lines.at(-1)?.endsWith('…') || size === minimum) break;
    size -= 4;
  }
  return { lines, size };
}

function drawCover(context: CanvasRenderingContext2D, data: ShareCardData): void {
  const naturalWidth = data.coverWidth || 0;
  const naturalHeight = data.coverHeight || 0;
  if (!data.cover || naturalWidth <= 0 || naturalHeight <= 0) return;
  const x = 840; const y = 0; const width = 360; const height = SHARE_CARD_HEIGHT;
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (naturalWidth - sourceWidth) / 2;
  const sourceY = (naturalHeight - sourceHeight) / 2;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(data.cover, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  const shade = context.createLinearGradient(x, 0, x + 150, 0);
  shade.addColorStop(0, '#0a0506');
  shade.addColorStop(1, 'rgba(10,5,6,0)');
  context.fillStyle = shade;
  context.fillRect(x, y, 150, height);
  context.restore();
  context.strokeStyle = 'rgba(244,237,227,0.18)';
  context.beginPath();
  context.moveTo(840, 42);
  context.lineTo(840, 588);
  context.stroke();
}

/** A self-contained drawing: local fonts and an optional already loaded, CORS-safe cover. */
export function drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): boolean {
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#0a0506';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const glow = context.createRadialGradient(80, 160, 0, 80, 160, 520);
  glow.addColorStop(0, 'rgba(255,43,61,0.13)');
  glow.addColorStop(1, 'rgba(255,43,61,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const hasCover = Boolean(data.cover && (data.coverWidth || 0) > 0 && (data.coverHeight || 0) > 0);
  if (hasCover) drawCover(context, data);
  context.strokeStyle = 'rgba(244,237,227,0.18)';
  context.lineWidth = 2;
  context.strokeRect(41, 41, 1118, 548);

  const contentWidth = hasCover ? 680 : 1000;
  const contentRight = hasCover ? 760 : 1120;
  context.font = '800 30px "Archivo Variable", "Red Room Display SC", sans-serif';
  context.fillStyle = '#f4ede3';
  context.fillText(oneLine(context, data.siteName, hasCover ? 400 : 760, data.locale), 80, 105);
  if (data.date) {
    context.font = '24px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
    context.fillStyle = 'rgba(244,237,227,0.58)';
    context.textAlign = 'right';
    context.fillText(oneLine(context, data.date, 260, data.locale), contentRight, 103);
    context.textAlign = 'left';
  }

  context.save();
  context.fillStyle = '#ff2b3d';
  context.shadowColor = 'rgba(255,43,61,0.7)';
  context.shadowBlur = 24;
  context.fillRect(78, 143, 5, 42);
  context.restore();

  if (data.quote) {
    context.font = '18px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
    context.fillStyle = '#e7a395';
    context.fillText(oneLine(context, data.passageLabel || (data.locale.startsWith('zh') ? '选段' : 'SELECTED PASSAGE'), contentWidth - 24, data.locale), 100, 168);
    context.font = '24px "Archivo Variable", "Red Room Display SC", sans-serif';
    context.fillStyle = 'rgba(244,237,227,0.62)';
    context.fillText(oneLine(context, data.title || data.siteName, contentWidth, data.locale), 80, 215);

    const quoteSize = data.note ? (hasCover ? 34 : 40) : (hasCover ? 36 : 44);
    const quote = fittedLines(context, `“${data.quote}”`, contentWidth, data.note ? 4 : 5, data.locale, quoteSize, 26);
    const lineHeight = Math.round(quote.size * 1.22);
    context.font = titleFont(quote.size);
    context.fillStyle = '#f4ede3';
    quote.lines.forEach((line, index) => context.fillText(line, 80, 272 + index * lineHeight));

    if (data.note && quote.lines.length) {
      const quoteBottom = 272 + (quote.lines.length - 1) * lineHeight;
      const labelY = quoteBottom + 38;
      context.font = '16px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
      context.fillStyle = '#e7a395';
      context.fillText(oneLine(context, data.noteLabel || (data.locale.startsWith('zh') ? '笔记' : 'NOTE'), contentWidth, data.locale), 80, labelY);
      context.font = `${hasCover ? 22 : 24}px "Noto Serif TC", "Songti TC", "PMingLiU", "Times New Roman", serif`;
      context.fillStyle = 'rgba(244,237,227,0.72)';
      const notes = wrapCardText(context, data.note, contentWidth, 2, data.locale);
      notes.forEach((line, index) => context.fillText(line, 80, labelY + 36 + index * 32));
    }
  } else {
    const title = fittedLines(context, data.title || data.siteName, contentWidth, 4, data.locale, hasCover ? 56 : 76, hasCover ? 36 : 48);
    context.font = titleFont(title.size);
    context.fillStyle = '#f4ede3';
    const titleLineHeight = Math.round(title.size * 1.1);
    title.lines.forEach((line, index) => context.fillText(line, 80, 240 + index * titleLineHeight));

    const excerptLines = title.lines.length >= 4 ? 0 : title.lines.length === 3 ? 1 : 2;
    if (data.excerpt && excerptLines) {
      const titleBottom = 240 + (title.lines.length - 1) * titleLineHeight;
      context.font = `${hasCover ? 24 : 28}px "Noto Serif TC", "Songti TC", "PMingLiU", "Times New Roman", serif`;
      context.fillStyle = 'rgba(244,237,227,0.64)';
      const lines = wrapCardText(context, data.excerpt, contentWidth, excerptLines, data.locale);
      lines.forEach((line, index) => context.fillText(line, 80, titleBottom + 70 + index * 40));
    }
  }

  context.strokeStyle = 'rgba(244,237,227,0.18)';
  context.beginPath();
  context.moveTo(80, 535);
  context.lineTo(contentRight, 535);
  context.stroke();
  context.fillStyle = '#ff2b3d';
  context.fillRect(80, 571, 24, 3);
  context.font = '22px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
  context.fillStyle = 'rgba(244,237,227,0.58)';
  if (data.tags) context.fillText(oneLine(context, data.tags, hasCover ? 360 : 560, data.locale), 122, 580);
  context.textAlign = 'right';
  context.fillText(oneLine(context, data.hostname, hasCover ? 250 : 360, data.locale), contentRight, 580);
  context.textAlign = 'left';
  return true;
}

export function shareCardPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
  });
}
