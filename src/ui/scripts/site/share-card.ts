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

/** A self-contained, same-origin drawing: no cover fetch, remote font service or tainted canvas. */
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
  context.strokeStyle = 'rgba(244,237,227,0.18)';
  context.lineWidth = 2;
  context.strokeRect(41, 41, 1118, 548);

  context.font = '800 30px "Archivo Variable", "Red Room Display SC", sans-serif';
  context.fillStyle = '#f4ede3';
  context.fillText(oneLine(context, data.siteName, 760, data.locale), 80, 105);
  if (data.date) {
    context.font = '24px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
    context.fillStyle = 'rgba(244,237,227,0.58)';
    context.textAlign = 'right';
    context.fillText(data.date, 1120, 103);
    context.textAlign = 'left';
  }

  context.save();
  context.fillStyle = '#ff2b3d';
  context.shadowColor = 'rgba(255,43,61,0.7)';
  context.shadowBlur = 24;
  context.fillRect(78, 143, 5, 42);
  context.restore();

  let titleSize = 76;
  let titleLines: string[] = [];
  while (titleSize >= 48) {
    context.font = titleFont(titleSize);
    titleLines = wrapCardText(context, data.title || data.siteName, 1000, 4, data.locale);
    if (titleLines.length < 4 || !titleLines[3]?.endsWith('…') || titleSize === 48) break;
    titleSize -= 8;
  }
  context.fillStyle = '#f4ede3';
  const titleLineHeight = Math.round(titleSize * 1.1);
  titleLines.forEach((line, index) => context.fillText(line, 80, 240 + index * titleLineHeight));

  const excerptLines = titleLines.length >= 4 ? 0 : titleLines.length === 3 ? 1 : 2;
  if (data.excerpt && excerptLines) {
    const titleBottom = 240 + (titleLines.length - 1) * titleLineHeight;
    context.font = '28px "Noto Serif TC", "Songti TC", "PMingLiU", "Times New Roman", serif';
    context.fillStyle = 'rgba(244,237,227,0.64)';
    const lines = wrapCardText(context, data.excerpt, 1000, excerptLines, data.locale);
    lines.forEach((line, index) => context.fillText(line, 80, titleBottom + 70 + index * 40));
  }

  context.strokeStyle = 'rgba(244,237,227,0.18)';
  context.beginPath();
  context.moveTo(80, 535);
  context.lineTo(1120, 535);
  context.stroke();
  context.fillStyle = '#ff2b3d';
  context.fillRect(80, 571, 24, 3);
  context.font = '22px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
  context.fillStyle = 'rgba(244,237,227,0.58)';
  if (data.tags) context.fillText(oneLine(context, data.tags, 560, data.locale), 122, 580);
  context.textAlign = 'right';
  context.fillText(oneLine(context, data.hostname, 360, data.locale), 1120, 580);
  context.textAlign = 'left';
  return true;
}

export function shareCardPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
  });
}
