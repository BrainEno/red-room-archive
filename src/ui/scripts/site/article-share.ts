import { drawShareCard, shareCardPng } from './share-card.ts';

type PreparedCard = { blob: Blob; file?: File };

function articleUrl(): string {
  const url = new URL(window.location.href);
  url.hash = '';
  return url.href;
}

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
  if (!open || !dialog || !close || !canvas || !status || !nativeShare || !download || !copy || typeof dialog.showModal !== 'function') return;

  root.removeAttribute('data-pending');
  let preparation: Promise<PreparedCard | null> | null = null;
  const filename = `${(root.dataset.slug || 'article').replace(/[^a-z0-9_-]+/gi, '-')}-share.png`;
  const prepare = (): Promise<PreparedCard | null> => {
    if (preparation) return preparation;
    status.textContent = root.dataset.preparing || '';
    download.disabled = true;
    nativeShare.hidden = true;
    preparation = (async (): Promise<PreparedCard> => {
      if (document.fonts?.ready) await document.fonts.ready;
      if (!drawShareCard(canvas, {
        title: root.dataset.title || document.title,
        excerpt: root.dataset.excerpt || '',
        date: root.dataset.date || '',
        siteName: root.dataset.site || '',
        tags: root.dataset.tags || '',
        hostname: window.location.hostname,
        locale: root.lang || document.documentElement.lang || 'en',
      })) throw new Error('Canvas is unavailable');
      const blob = await shareCardPng(canvas);
      let file: File | undefined;
      if (typeof File === 'function') file = new File([blob], filename, { type: 'image/png' });
      download.disabled = false;
      let canShareFile = false;
      try {
        canShareFile = Boolean(file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({
          files: [file], title: root.dataset.title || document.title, url: articleUrl(),
        }));
      } catch { /* Download and copy remain available. */ }
      nativeShare.hidden = !canShareFile;
      status.textContent = root.dataset.ready || '';
      return { blob, file };
    })().catch(() => {
      preparation = null;
      download.disabled = true;
      nativeShare.hidden = true;
      status.textContent = root.dataset.cardError || '';
      return null;
    });
    return preparation;
  };

  open.addEventListener('click', () => {
    dialog.showModal();
    void prepare();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => open.focus());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  download.addEventListener('click', async () => {
    const card = await prepare();
    if (!card) return;
    const url = URL.createObjectURL(card.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  nativeShare.addEventListener('click', async () => {
    const card = await prepare();
    if (!card?.file) return;
    try {
      await navigator.share({ files: [card.file], title: root.dataset.title || document.title, url: articleUrl() });
      status.textContent = root.dataset.shared || '';
    } catch (error) {
      status.textContent = error instanceof DOMException && error.name === 'AbortError' ? root.dataset.ready || '' : root.dataset.shareError || '';
    }
  });
  copy.addEventListener('click', async () => {
    status.textContent = await copyText(articleUrl(), dialog) ? root.dataset.copied || '' : root.dataset.copyError || '';
  });
}

for (const root of document.querySelectorAll<HTMLElement>('[data-article-share]')) initialize(root);
