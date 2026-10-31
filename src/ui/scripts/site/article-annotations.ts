import {
  ANNOTATION_LIMIT,
  NOTE_LIMIT,
  PASSAGE_LIMIT,
  annotationStorageKey,
  characterCount,
  isNearlyWholeArticle,
  parseAnnotations,
  watermarkedCopy,
  type ArticleAnnotation,
  type PassageAnchor,
} from '../../../shared/article-annotations.ts';

type TextPoint = { node: Text; start: number; end: number };
type SelectionInfo = PassageAnchor & { range: Range; contentLength: number };
type HighlightRegistry = { set: (name: string, value: unknown) => void; delete: (name: string) => void };
type HighlightWindow = Window & {
  Highlight?: new (...ranges: Range[]) => unknown;
  CSS?: { highlights?: HighlightRegistry };
};

const SAVED_HIGHLIGHT = 'rra-saved-passage';
const NOTE_HIGHLIGHT = 'rra-saved-passage-note';

function initialize(root: HTMLElement): void {
  const body = document.querySelector<HTMLElement>('.article-body');
  const articleTitle = document.querySelector<HTMLElement>('[data-article-title]');
  const tools = root.querySelector<HTMLElement>('[data-selection-tools]');
  const count = root.querySelector<HTMLElement>('[data-selection-count]');
  const highlightButton = root.querySelector<HTMLButtonElement>('[data-selection-highlight]');
  const noteButton = root.querySelector<HTMLButtonElement>('[data-selection-note]');
  const shareButton = root.querySelector<HTMLButtonElement>('[data-selection-share]');
  const shelf = root.querySelector<HTMLDetailsElement>('[data-annotation-shelf]');
  const shelfCount = root.querySelector<HTMLElement>('[data-annotation-count]');
  const list = root.querySelector<HTMLElement>('[data-annotation-list]');
  const noteDialog = root.querySelector<HTMLDialogElement>('[data-note-dialog]');
  const noteClose = root.querySelector<HTMLButtonElement>('[data-note-close]');
  const noteQuote = root.querySelector<HTMLElement>('[data-note-quote]');
  const noteInput = root.querySelector<HTMLTextAreaElement>('[data-note-input]');
  const noteCount = root.querySelector<HTMLElement>('[data-note-count]');
  const noteStatus = root.querySelector<HTMLElement>('[data-note-status]');
  const noteSave = root.querySelector<HTMLButtonElement>('[data-note-save]');
  const noteDelete = root.querySelector<HTMLButtonElement>('[data-note-delete]');
  const toast = root.querySelector<HTMLElement>('[data-article-toast]');
  if (!body || !articleTitle || !tools || !count || !highlightButton || !noteButton || !shareButton || !shelf || !shelfCount || !list || !noteDialog || !noteClose || !noteQuote || !noteInput || !noteCount || !noteStatus || !noteSave || !noteDelete || !toast || typeof noteDialog.showModal !== 'function') return;

  const passageLimit = Number(root.dataset.passageLimit) || PASSAGE_LIMIT;
  const noteLimit = Number(root.dataset.noteLimit) || NOTE_LIMIT;
  const storageKey = annotationStorageKey(root.dataset.slug || window.location.pathname);
  const points: TextPoint[] = [];
  let sourceText = '';
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest('annotation, script, style, .code-copy, [aria-hidden="true"]')) continue;
    const start = sourceText.length;
    sourceText += text.data;
    points.push({ node: text, start, end: sourceText.length });
  }
  const totalBodyCharacters = characterCount(sourceText.replace(/\s/gu, ''));
  const cleanUrl = () => {
    const url = new URL(window.location.href);
    url.hash = '';
    return url.href;
  };
  const watermark = (text: string, articleUrl = cleanUrl()): string => watermarkedCopy(text, {
    title: root.dataset.title || document.title,
    siteName: root.dataset.site || '',
    articleUrl,
    copyrightUrl: new URL(root.dataset.copyrightPath || '/copyright', window.location.origin).href,
    year: Number(root.dataset.year) || new Date().getFullYear(),
    locale: root.dataset.locale || root.lang || 'en',
  });

  let records: ArticleAnnotation[] = [];
  try { records = parseAnnotations(window.localStorage.getItem(storageKey)); } catch { /* Memory still works for this visit. */ }
  let current: SelectionInfo | null = null;
  let draft: { anchor: PassageAnchor; id?: string } | undefined;
  let modalOpen = false;
  let selectionFrame = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let deleteTimer: ReturnType<typeof setTimeout> | undefined;

  const showToast = (message: string) => {
    if (noteDialog.open) noteStatus.textContent = message;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
  };
  const persist = (): boolean => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(records));
      return true;
    } catch {
      showToast(root.dataset.storageError || '');
      return false;
    }
  };
  const selectionInfo = (range: Range): SelectionInfo | null => {
    if (range.collapsed) return null;
    let start = -1;
    let end = -1;
    let text = '';
    let contentLength = 0;
    for (const point of points) {
      if (!range.intersectsNode(point.node)) continue;
      const from = range.startContainer === point.node ? range.startOffset : 0;
      const to = range.endContainer === point.node ? range.endOffset : point.node.data.length;
      if (to <= from) continue;
      const piece = point.node.data.slice(from, to);
      if (start < 0) start = point.start + from;
      end = point.start + to;
      text += piece;
      contentLength += characterCount(piece.replace(/\s/gu, ''));
    }
    if (start < 0 || !text.trim()) return null;
    const leading = text.length - text.trimStart().length;
    const trimmed = text.trim();
    start += leading;
    end = start + trimmed.length;
    return {
      start,
      end,
      text: trimmed,
      prefix: sourceText.slice(Math.max(0, start - 48), start),
      suffix: sourceText.slice(end, end + 48),
      contentLength,
      range: range.cloneRange(),
    };
  };
  const rangeFor = (start: number, end: number): Range | undefined => {
    const first = points.find((point) => start >= point.start && start < point.end);
    const last = points.find((point) => end > point.start && end <= point.end);
    if (!first || !last) return undefined;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  };
  const locateRecord = (record: ArticleAnnotation): Range | undefined => {
    if (sourceText.slice(record.start, record.end) === record.text) return rangeFor(record.start, record.end);
    const candidates: number[] = [];
    let cursor = 0;
    while (cursor <= sourceText.length - record.text.length) {
      const index = sourceText.indexOf(record.text, cursor);
      if (index < 0) break;
      candidates.push(index);
      cursor = index + Math.max(1, record.text.length);
    }
    let best: { index: number; score: number; distance: number } | undefined;
    for (const index of candidates) {
      const score = (record.prefix && sourceText.slice(Math.max(0, index - record.prefix.length), index) === record.prefix ? 2 : 0)
        + (record.suffix && sourceText.slice(index + record.text.length, index + record.text.length + record.suffix.length) === record.suffix ? 2 : 0);
      const distance = Math.abs(index - record.start);
      if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { index, score, distance };
    }
    if (!best) return undefined;
    record.start = best.index;
    record.end = best.index + record.text.length;
    return rangeFor(record.start, record.end);
  };
  const exactRecord = (anchor: PassageAnchor): ArticleAnnotation | undefined => records.find((record) =>
    (record.start === anchor.start && record.end === anchor.end)
    || (record.text === anchor.text && record.prefix === anchor.prefix && record.suffix === anchor.suffix));
  const upsert = (anchor: PassageAnchor, note: string): ArticleAnnotation | undefined => {
    const existing = exactRecord(anchor);
    const now = Date.now();
    if (existing) {
      existing.note = note.trim().slice(0, noteLimit);
      existing.updatedAt = now;
      persist();
      renderAll();
      return existing;
    }
    if (records.length >= ANNOTATION_LIMIT) {
      showToast(root.dataset.annotationLimit || '');
      return undefined;
    }
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const record: ArticleAnnotation = { ...anchor, id, note: note.trim().slice(0, noteLimit), createdAt: now, updatedAt: now };
    records.push(record);
    persist();
    renderAll();
    return record;
  };

  const renderHighlights = () => {
    const highlightWindow = window as HighlightWindow;
    const registry = highlightWindow.CSS?.highlights;
    const Highlight = highlightWindow.Highlight;
    if (!registry || !Highlight) return;
    const plain: Range[] = [];
    const noted: Range[] = [];
    for (const record of records) {
      const range = locateRecord(record);
      if (range) (record.note ? noted : plain).push(range);
    }
    if (plain.length) registry.set(SAVED_HIGHLIGHT, new Highlight(...plain));
    else registry.delete(SAVED_HIGHLIGHT);
    if (noted.length) registry.set(NOTE_HIGHLIGHT, new Highlight(...noted));
    else registry.delete(NOTE_HIGHLIGHT);
  };
  const scrollToRecord = (record: ArticleAnnotation) => {
    const range = locateRecord(record);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * .38), behavior: reduced ? 'auto' : 'smooth' });
  };
  const shareRecord = (record: PassageAnchor & { note: string }) => {
    modalOpen = true;
    tools.hidden = true;
    document.dispatchEvent(new CustomEvent('rra:share-passage', { detail: { ...record } }));
  };
  const renderShelf = () => {
    shelf.hidden = records.length === 0;
    shelfCount.textContent = records.length ? `(${records.length})` : '';
    list.replaceChildren();
    for (const record of [...records].reverse()) {
      const item = document.createElement('article');
      item.className = 'annotation-item';
      const quoteButton = document.createElement('button');
      quoteButton.type = 'button';
      quoteButton.className = 'annotation-quote';
      quoteButton.textContent = record.text;
      quoteButton.addEventListener('click', () => scrollToRecord(record));
      item.append(quoteButton);
      if (record.note) {
        const comment = document.createElement('p');
        comment.className = 'annotation-comment';
        comment.textContent = record.note;
        item.append(comment);
      }
      const actions = document.createElement('div');
      actions.className = 'annotation-item-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = root.dataset.editLabel || '';
      edit.addEventListener('click', () => openNote(record, record));
      const share = document.createElement('button');
      share.type = 'button';
      share.textContent = root.dataset.shareLabel || '';
      share.addEventListener('click', () => shareRecord(record));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = root.dataset.deleteLabel || '';
      remove.addEventListener('click', () => {
        if (!remove.dataset.confirm) {
          remove.dataset.confirm = 'true';
          remove.textContent = root.dataset.confirmDeleteLabel || '';
          clearTimeout(deleteTimer);
          deleteTimer = setTimeout(() => { delete remove.dataset.confirm; remove.textContent = root.dataset.deleteLabel || ''; }, 3000);
          return;
        }
        records = records.filter((entry) => entry.id !== record.id);
        persist();
        renderAll();
        showToast(root.dataset.annotationDeleted || '');
      });
      actions.append(edit, share, remove);
      item.append(actions);
      list.append(item);
    }
  };
  function renderAll(): void {
    renderHighlights();
    renderShelf();
  }

  const hideTools = () => {
    tools.hidden = true;
    current = null;
  };
  const positionTools = () => {
    if (!current || tools.hidden) return;
    if (window.innerWidth <= 520) {
      tools.style.left = '';
      tools.style.top = '';
      return;
    }
    const rect = current.range.getBoundingClientRect();
    const width = tools.offsetWidth;
    const height = tools.offsetHeight;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const above = rect.top - height - 12;
    const top = above >= 12 ? above : Math.min(window.innerHeight - height - 12, rect.bottom + 12);
    tools.style.left = `${Math.round(left)}px`;
    tools.style.top = `${Math.round(Math.max(12, top))}px`;
  };
  const updateTools = () => {
    if (modalOpen) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) { hideTools(); return; }
    const range = selection.getRangeAt(0);
    const withinBody = body.contains(range.startContainer) && body.contains(range.endContainer);
    if (!withinBody) { hideTools(); return; }
    const info = selectionInfo(range);
    if (!info) { hideTools(); return; }
    current = info;
    const length = characterCount(info.text);
    const tooLong = length > passageLimit;
    count.textContent = tooLong
      ? root.dataset.selectionTooLong || ''
      : `${length} / ${passageLimit} ${root.dataset.countUnit || ''}`;
    tools.dataset.tooLong = tooLong ? 'true' : 'false';
    highlightButton.disabled = tooLong;
    noteButton.disabled = tooLong;
    shareButton.disabled = tooLong;
    tools.hidden = false;
    positionTools();
  };
  const scheduleTools = () => {
    cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(updateTools);
  };

  const openNote = (anchor: PassageAnchor, existing?: ArticleAnnotation): void => {
    draft = { anchor, id: existing?.id };
    modalOpen = true;
    tools.hidden = true;
    noteQuote.textContent = anchor.text;
    noteInput.value = existing?.note || '';
    noteCount.textContent = `${characterCount(noteInput.value)} / ${noteLimit} ${root.dataset.countUnit || ''}`;
    noteStatus.textContent = '';
    noteDelete.hidden = !existing;
    delete noteDelete.dataset.confirm;
    noteDelete.textContent = root.dataset.deleteLabel || '';
    noteDialog.showModal();
    noteInput.focus();
  };

  tools.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button')) event.preventDefault();
  });
  highlightButton.addEventListener('click', () => {
    if (!current || characterCount(current.text) > passageLimit) return;
    const existing = exactRecord(current);
    if (upsert(current, existing?.note || '')) showToast(root.dataset.highlightSaved || '');
    document.getSelection()?.removeAllRanges();
    hideTools();
  });
  noteButton.addEventListener('click', () => {
    if (!current || characterCount(current.text) > passageLimit) return;
    const existing = exactRecord(current);
    openNote(current, existing);
  });
  shareButton.addEventListener('click', () => {
    if (!current || characterCount(current.text) > passageLimit) return;
    const existing = exactRecord(current);
    shareRecord({ ...current, note: existing?.note || '' });
  });
  noteInput.addEventListener('input', () => {
    noteCount.textContent = `${characterCount(noteInput.value)} / ${noteLimit} ${root.dataset.countUnit || ''}`;
  });
  noteSave.addEventListener('click', () => {
    if (!draft) return;
    if (!upsert(draft.anchor, noteInput.value)) return;
    noteDialog.close();
    showToast(root.dataset.noteSaved || '');
  });
  noteDelete.addEventListener('click', () => {
    if (!draft?.id) return;
    if (!noteDelete.dataset.confirm) {
      noteDelete.dataset.confirm = 'true';
      noteDelete.textContent = root.dataset.confirmDeleteLabel || '';
      return;
    }
    records = records.filter((record) => record.id !== draft!.id);
    persist();
    renderAll();
    noteDialog.close();
    showToast(root.dataset.annotationDeleted || '');
  });
  noteClose.addEventListener('click', () => noteDialog.close());
  noteDialog.addEventListener('close', () => {
    modalOpen = false;
    draft = undefined;
    document.getSelection()?.removeAllRanges();
    hideTools();
  });
  document.addEventListener('rra:share-closed', () => {
    modalOpen = false;
    document.getSelection()?.removeAllRanges();
    hideTools();
  });
  document.addEventListener('rra:annotation-note', (event) => {
    const detail = (event as CustomEvent<PassageAnchor & { note: string }>).detail;
    if (!detail?.text || characterCount(detail.text) > passageLimit) return;
    upsert(detail, detail.note || '');
  });
  document.addEventListener('selectionchange', scheduleTools);
  window.addEventListener('resize', scheduleTools);
  window.addEventListener('scroll', scheduleTools, { passive: true, capture: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modalOpen && !tools.hidden) hideTools();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey) return;
    records = parseAnnotations(event.newValue);
    renderAll();
  });

  document.addEventListener('copy', (event) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const inBody = range.intersectsNode(body);
    if (!inBody && !range.intersectsNode(articleTitle)) return;
    const info = selectionInfo(range);
    if (inBody && info && isNearlyWholeArticle(info.contentLength, totalBodyCharacters)) {
      event.preventDefault();
      showToast(root.dataset.fullCopyBlocked || '');
      return;
    }
    const text = selection.toString();
    if (!text.trim() || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', watermark(text));
    showToast(root.dataset.copyWatermark || '');
  });

  renderAll();
}

for (const root of document.querySelectorAll<HTMLElement>('[data-article-annotations]')) initialize(root);
