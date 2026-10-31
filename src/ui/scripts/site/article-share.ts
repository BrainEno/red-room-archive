import { drawShareCard, shareCardPng } from './share-card.ts';
import { watermarkedCopy } from '../../../shared/article-annotations.ts';

type PreparedCard = { blob: Blob; file?: File };
type PassageDetail = {
  text: string;
  note: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
};

async function copyText(text: string, container: HTMLElement): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* Use the selection fallback below. */ }
  }
  const field = document.createElement('textarea');
  field.className = 'share-copy-fallback';
  field.value = text;
  field.readOnly = true;
  const previousFocus = document.activeElement as HTMLElement | null;
  container.append(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* The status tells the reader what to do next. */ }
  field.remove();
  previousFocus?.focus();
  return copied;
}

function initialize(root: HTMLElement): void {
  const open = root.querySelector<HTMLButtonElement>('[data-share-open]');
  const dialog = root.querySelector<HTMLDialogElement>('[data-share-dialog]');
  const close = root.querySelector<HTMLButtonElement>('[data-share-close]');
  const canvas = root.querySelector<HTMLCanvasElement>('[data-share-canvas]');
  const status = root.querySelector<HTMLElement>('[data-share-status]');
  const nativeShare = root.querySelector<HTMLButtonElement>('[data-share-native]');
  const download = root.querySelector<HTMLButtonElement>('[data-share-download]');
  const copy = root.querySelector<HTMLButtonElement>('[data-share-copy]');
  const passage = root.querySelector<HTMLElement>('[data-share-passage]');
  const quote = root.querySelector<HTMLElement>('[data-share-quote]');
  const note = root.querySelector<HTMLTextAreaElement>('[data-share-note]');
  const clear = root.querySelector<HTMLButtonElement>('[data-share-clear]');
  const copyPassage = root.querySelector<HTMLButtonElement>('[data-share-copy-passage]');
  const coverOption = root.querySelector<HTMLInputElement>('[data-share-cover]');
  if (!open || !dialog || !close || !canvas || !status || !nativeShare || !download || !copy || !passage || !quote || !note || !clear || !copyPassage || typeof dialog.showModal !== 'function') return;

  root.removeAttribute('data-pending');
  let selection: PassageDetail | null = null;
  let preparation: Promise<PreparedCard | null> | null = null;
  let coverPreparation: Promise<HTMLImageElement> | null = null;
  let revision = 0;
  let returnFocus: HTMLElement | null = open;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let noteDirty = false;
  const filename = () => `${(root.dataset.slug || 'article').replace(/[^a-z0-9_-]+/gi, '-')}${selection ? '-passage' : ''}-share.png`;
  const shareUrl = (): string => {
    const url = new URL(window.location.href);
    url.hash = '';
    if (!selection) return url.href;
    const text = selection.text.replace(/\s+/gu, ' ').trim();
    return `${url.href}#:~:text=${encodeURIComponent(text)}`;
  };
  const watermark = (text: string): string => watermarkedCopy(text, {
    title: root.dataset.title || document.title,
    siteName: root.dataset.site || '',
    articleUrl: shareUrl(),
    copyrightUrl: new URL(root.dataset.copyrightPath || '/copyright', window.location.origin).href,
    year: Number(root.dataset.year) || new Date().getFullYear(),
    locale: root.dataset.locale || root.lang || 'en',
  });
  const invalidate = () => {
    revision++;
    preparation = null;
    download.disabled = true;
    nativeShare.hidden = true;
  };
  const persistNote = () => {
    if (!noteDirty || !selection) return;
    noteDirty = false;
    document.dispatchEvent(new CustomEvent('rra:annotation-note', {
      detail: { ...selection, note: note.value.trim() },
    }));
  };
  const setPassage = (detail: PassageDetail | null) => {
    if (noteDirty) persistNote();
    clearTimeout(noteTimer);
    selection = detail;
    passage.hidden = !detail;
    copyPassage.hidden = !detail;
    quote.textContent = detail?.text || '';
    note.value = detail?.note || '';
    noteDirty = false;
    invalidate();
  };
  const loadCover = (): Promise<HTMLImageElement> => {
    if (coverPreparation) return coverPreparation;
    coverPreparation = new Promise((resolve, reject) => {
      const source = root.dataset.cover;
      if (!source) { reject(new Error('No cover')); return; }
      const image = new Image();
      const url = new URL(source, window.location.href);
      if (url.origin !== window.location.origin) image.crossOrigin = 'anonymous';
      const timeout = window.setTimeout(() => reject(new Error('Cover timed out')), 10_000);
      image.onload = () => { clearTimeout(timeout); resolve(image); };
      image.onerror = () => { clearTimeout(timeout); reject(new Error('Cover unavailable')); };
      image.src = url.href;
    });
    return coverPreparation;
  };
  const prepare = (): Promise<PreparedCard | null> => {
    if (preparation) return preparation;
    const run = revision;
    status.textContent = root.dataset.preparing || '';
    download.disabled = true;
    nativeShare.hidden = true;
    preparation = (async (): Promise<PreparedCard | null> => {
      if (document.fonts?.ready) await document.fonts.ready;
      let cover: HTMLImageElement | undefined;
      let coverFailed = false;
      if (coverOption?.checked) {
        try { cover = await loadCover(); }
        catch { coverFailed = true; }
      }
      if (run !== revision) return null;
      if (!drawShareCard(canvas, {
        title: root.dataset.title || document.title,
        excerpt: root.dataset.excerpt || '',
        date: root.dataset.date || '',
        siteName: root.dataset.site || '',
        tags: root.dataset.tags || '',
        hostname: window.location.hostname,
        locale: root.lang || document.documentElement.lang || 'en',
        quote: selection?.text,
        note: selection ? note.value.trim() : undefined,
        passageLabel: root.dataset.passageLabel,
        noteLabel: root.dataset.noteLabel,
        cover,
        coverWidth: cover?.naturalWidth,
        coverHeight: cover?.naturalHeight,
      })) throw new Error('Canvas is unavailable');
      const blob = await shareCardPng(canvas);
      if (run !== revision) return null;
      let file: File | undefined;
      if (typeof File === 'function') file = new File([blob], filename(), { type: 'image/png' });
      download.disabled = false;
      let canShareFile = false;
      try {
        canShareFile = Boolean(file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({
          files: [file], title: root.dataset.title || document.title, url: shareUrl(),
        }));
      } catch { /* Download and copy remain available. */ }
      nativeShare.hidden = !canShareFile;
      status.textContent = coverFailed ? root.dataset.coverError || '' : root.dataset.ready || '';
      return { blob, file };
    })().catch(() => {
      if (run === revision) {
        preparation = null;
        download.disabled = true;
        nativeShare.hidden = true;
        status.textContent = root.dataset.cardError || '';
      }
      return null;
    });
    return preparation;
  };
  const show = () => {
    if (!dialog.open) dialog.showModal();
    void prepare();
  };

  open.addEventListener('click', () => {
    returnFocus = open;
    setPassage(null);
    show();
  });
  document.addEventListener('rra:share-passage', (event) => {
    const detail = (event as CustomEvent<PassageDetail>).detail;
    if (!detail?.text || !Number.isInteger(detail.start) || !Number.isInteger(detail.end)) return;
    returnFocus = null;
    setPassage(detail);
    show();
  });
  clear.addEventListener('click', () => { setPassage(null); void prepare(); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    persistNote();
    document.dispatchEvent(new CustomEvent('rra:share-closed'));
    returnFocus?.focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  note.addEventListener('input', () => {
    if (!selection) return;
    noteDirty = true;
    invalidate();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { persistNote(); if (dialog.open) void prepare(); }, 180);
  });
  coverOption?.addEventListener('change', () => { invalidate(); void prepare(); });
  download.addEventListener('click', async () => {
    persistNote();
    const card = await prepare();
    if (!card) return;
    const url = URL.createObjectURL(card.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename();
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  nativeShare.addEventListener('click', async () => {
    persistNote();
    const card = await prepare();
    if (!card?.file) return;
    try {
      await navigator.share({ files: [card.file], title: root.dataset.title || document.title, url: shareUrl() });
      status.textContent = root.dataset.shared || '';
    } catch (error) {
      status.textContent = error instanceof DOMException && error.name === 'AbortError' ? root.dataset.ready || '' : root.dataset.shareError || '';
    }
  });
  copy.addEventListener('click', async () => {
    status.textContent = await copyText(shareUrl(), dialog) ? root.dataset.copied || '' : root.dataset.copyError || '';
  });
  copyPassage.addEventListener('click', async () => {
    if (!selection) return;
    persistNote();
    const comment = note.value.trim();
    const text = `${selection.text}${comment ? `\n\n${root.dataset.noteLabel || 'Note'}: ${comment}` : ''}`;
    status.textContent = await copyText(watermark(text), dialog) ? root.dataset.passageCopied || '' : root.dataset.copyError || '';
  });
}

for (const root of document.querySelectorAll<HTMLElement>('[data-article-share]')) initialize(root);
