export const SPEECH_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'SUMMARY', 'ASIDE', 'DIV']);
export const SPEECH_SKIP = 'nav.toc, .bookmark-url, .code-copy, annotation, script, style, iframe, audio, video, input, [aria-hidden="true"]';

type Point = { node: Text; offset: number };
type MappedText = { text: string; points: Array<Point | undefined> };
type WordBounds = { start: number; end: number; word: boolean };
type HighlightRegistry = { set: (name: string, value: unknown) => void; delete: (name: string) => void };
type HighlightWindow = Window & {
  Highlight?: new (...ranges: Range[]) => unknown;
  CSS?: { highlights?: HighlightRegistry };
};

export interface ReadingFollow {
  showPassage: (index: number, offset: number, scroll: boolean) => void;
  showWord: (index: number, offset: number, charLength?: number) => void;
  clear: () => void;
}

function replaceMapped(input: MappedText, pattern: RegExp, replacement: string): MappedText {
  let text = '';
  const points: Array<Point | undefined> = [];
  let cursor = 0;
  for (const match of input.text.matchAll(pattern)) {
    const index = match.index;
    text += input.text.slice(cursor, index);
    points.push(...input.points.slice(cursor, index));
    text += replacement;
    points.push(...Array.from({ length: replacement.length }, () => replacement === '\n' ? undefined : input.points[index]));
    cursor = index + match[0].length;
  }
  text += input.text.slice(cursor);
  points.push(...input.points.slice(cursor));
  return { text, points };
}

function normalizeMapped(raw: string, points: Array<Point | undefined>): MappedText {
  let mapped = replaceMapped({ text: raw, points }, /[ \t]+/g, ' ');
  mapped = replaceMapped(mapped, / *\n */g, '\n');
  mapped = replaceMapped(mapped, /\n{2,}/g, '\n');
  const start = mapped.text.length - mapped.text.trimStart().length;
  const remaining = mapped.text.slice(start);
  const end = remaining.trimEnd().length;
  return { text: remaining.slice(0, end), points: mapped.points.slice(start, start + end) };
}

function mappedBody(root: Element): MappedText {
  let raw = '';
  const points: Array<Point | undefined> = [];
  const append = (value: string, node?: Text) => {
    raw += value;
    if (node) for (let offset = 0; offset < value.length; offset++) points.push({ node, offset });
    else points.push(...Array.from({ length: value.length }, () => undefined));
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) { append((node as Text).data, node as Text); return; }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(SPEECH_SKIP)) return;
    const block = SPEECH_BLOCKS.has(element.tagName);
    if (block || element.tagName === 'BR') append('\n');
    for (const child of Array.from(element.childNodes)) walk(child);
    if (block) append('\n');
  };
  walk(root);
  return normalizeMapped(raw, points);
}

function mappedTitle(root: Element): MappedText {
  let raw = '';
  const points: Array<Point | undefined> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    raw += text.data;
    for (let offset = 0; offset < text.data.length; offset++) points.push({ node: text, offset });
  }
  return normalizeMapped(raw, points);
}

function wordSegments(source: string, locale: string): WordBounds[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(locale, { granularity: 'word' }).segment(source), (part) => ({
      start: part.index, end: part.index + part.segment.length, word: Boolean(part.isWordLike),
    }));
  }
  return Array.from(source.matchAll(/[\p{L}\p{N}'’-]+/gu), (match) => ({
    start: match.index, end: match.index + match[0].length, word: true,
  }));
}

/** DOM Range tracking: no wrappers, duplicated article text or layout changes. */
export function createReadingFollow(options: {
  title: Element;
  body: Element;
  chunks: string[];
  sourceText: string;
  locale: string;
  enabled: () => boolean;
}): ReadingFollow {
  let mapped: MappedText | undefined;
  let starts: number[] = [];
  let failed = false;
  let activeBlock: Element | undefined;
  let sawWord = false;
  let segmentedIndex = -1;
  let segments: WordBounds[] = [];
  const highlightName = 'read-aloud-current';
  const highlightWindow = () => window as HighlightWindow;
  const registry = () => highlightWindow().CSS?.highlights;

  const clear = () => {
    activeBlock?.classList.remove('read-aloud-current-block');
    activeBlock = undefined;
    registry()?.delete(highlightName);
  };
  const ensureMap = (): boolean => {
    if (mapped) return true;
    if (failed || typeof document.createTreeWalker !== 'function') return false;
    const title = mappedTitle(options.title);
    const body = mappedBody(options.body);
    const parts = [title, body].filter((part) => part.text);
    const text = parts.map((part) => part.text).join('\n');
    if (text !== options.sourceText) { failed = true; return false; }
    const points: Array<Point | undefined> = [];
    parts.forEach((part, index) => {
      if (index) points.push(undefined);
      points.push(...part.points);
    });
    mapped = { text, points };
    let cursor = 0;
    starts = options.chunks.map((chunk) => {
      const start = text.indexOf(chunk, cursor);
      if (start >= 0) cursor = start + chunk.length;
      return start;
    });
    return true;
  };
  const point = (index: number, offset: number): Point | undefined => {
    if (!mapped) return undefined;
    const start = starts[index] ?? -1;
    if (start < 0) return undefined;
    const position = start + Math.max(0, Math.min(options.chunks[index]!.length - 1, offset));
    return mapped.points[position];
  };
  const range = (index: number, offset: number, end: number): Range | undefined => {
    const first = point(index, offset);
    const last = point(index, Math.max(offset, end - 1));
    if (!first || !last) return undefined;
    const result = document.createRange();
    result.setStart(first.node, first.offset);
    result.setEnd(last.node, last.offset + 1);
    return result;
  };
  const blockFor = (index: number, offset: number): Element | undefined => {
    const element = point(index, offset)?.node.parentElement;
    return element?.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td, th') || element || undefined;
  };
  const markBlock = (index: number, offset: number): Element | undefined => {
    const block = blockFor(index, offset);
    if (!block) return undefined;
    if (activeBlock !== block) {
      activeBlock?.classList.remove('read-aloud-current-block');
      activeBlock = block;
      block.classList.add('read-aloud-current-block');
    }
    return block;
  };
  const scrollTo = (index: number, offset: number, block: Element) => {
    const rect = (range(index, offset, offset + 1)?.getBoundingClientRect() || block.getBoundingClientRect());
    const top = 88;
    const bottom = window.innerHeight - 72;
    if (rect.top >= top && rect.bottom <= bottom) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * .38), behavior: reduced ? 'auto' : 'smooth' });
  };
  const showPassage = (index: number, offset: number, scroll: boolean) => {
    if (!options.enabled() || index < 0 || index >= options.chunks.length) return;
    clear();
    if (!ensureMap()) return;
    const block = blockFor(index, offset);
    // Once boundaries have proved available, do not flash a whole underlined
    // paragraph between passages. Engines without boundaries keep this fallback.
    if (!sawWord || !highlightWindow().Highlight || !registry()) markBlock(index, offset);
    if (block && scroll) scrollTo(index, offset, block);
  };
  const showWord = (index: number, offset: number, charLength = 0) => {
    if (!options.enabled() || index < 0 || index >= options.chunks.length) return;
    const source = options.chunks[index]!;
    if (offset < 0 || offset >= source.length || !ensureMap()) return;
    if (segmentedIndex !== index) { segmentedIndex = index; segments = wordSegments(source, options.locale); }
    const segment = segments.find((part) => part.word && offset >= part.start && offset < part.end)
      || segments.find((part) => part.word && part.start >= offset);
    const start = charLength > 0 ? offset : segment?.start ?? offset;
    const end = charLength > 0 ? Math.min(source.length, offset + charLength) : segment?.end ?? Math.min(source.length, offset + 1);
    const current = range(index, start, end);
    const Highlight = highlightWindow().Highlight;
    const highlights = registry();
    if (current && Highlight && highlights) {
      sawWord = true;
      activeBlock?.classList.remove('read-aloud-current-block');
      activeBlock = undefined;
      highlights.set(highlightName, new Highlight(current));
    } else {
      registry()?.delete(highlightName);
      markBlock(index, offset);
    }
  };
  return { showPassage, showWord, clear };
}
