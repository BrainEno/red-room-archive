/**
 * More panel — edit the /more page: intro, publications (cover, specs,
 * excerpt, order link) and contact channels (QR codes). English and Chinese
 * fields sit side by side; an empty side falls back to the other language on
 * the page. Nothing is published until Save.
 */
import { isImageUrl, isLinkUrl } from '../../../../core/more.ts';
import type { LocalizedText, MoreDocument, MoreDocumentResponse } from '../../../../shared/contracts.ts';
import { MORE_PATH } from '../../../../shared/routes.ts';
import { ApiError, type ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, pickFile, timeLabel, toast } from '../dom.ts';
import {
  bilingualLabel,
  blankChannel,
  blankPublication,
  cloneDocument,
  documentFromImport,
  getPath,
  move,
  setPath,
} from '../more-model.ts';

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

type ListKey = 'publications' | 'channels';

export function morePanel(root: HTMLElement, api: ApiClient, hooks: { onFilesChanged?: () => void } = {}) {
  let meta: Omit<MoreDocumentResponse, 'document'> = { custom: false, updated: null };
  let doc: MoreDocument = { intro: { en: '', 'zh-CN': '' }, publications: [], channels: [] };
  let saved = '';
  /** Card ids whose <details> are open (survives re-render). */
  const open = new Set<string>();

  const dirty = () => JSON.stringify(doc) !== saved;

  const load = (response: MoreDocumentResponse) => {
    doc = cloneDocument(response.document);
    saved = JSON.stringify(doc);
    meta = { custom: response.custom, updated: response.updated };
    render();
  };

  /* ── Field builders ─────────────────────────────────────────────── */

  const pair = (label: string, path: string, value: LocalizedText, opts: { rows?: number; hint?: string; zhPlaceholder?: string } = {}) => {
    const input = (lang: 'en' | 'zh-CN') => {
      const p = `${path}.${lang}`;
      const attrs = `data-path="${p}" lang="${lang}" aria-label="${esc(`${label} — ${lang === 'en' ? 'English' : '中文'}`)}"`;
      const placeholder = lang === 'zh-CN' && opts.zhPlaceholder ? ` placeholder="${esc(opts.zhPlaceholder)}"` : '';
      return opts.rows
        ? `<textarea ${attrs} rows="${opts.rows}"${placeholder}>${esc(value[lang])}</textarea>`
        : `<input ${attrs} value="${esc(value[lang])}"${placeholder}>`;
    };
    return `<div class="me-pair"><span class="me-label">${esc(label)}${opts.hint ? ` <small>${esc(opts.hint)}</small>` : ''}</span>${input('en')}${input('zh-CN')}</div>`;
  };

  const single = (label: string, path: string, value: string | number | null, opts: { type?: string; placeholder?: string; check?: 'link' | 'image' } = {}) =>
    `<label class="me-single">${esc(label)}<input data-path="${path}"${opts.type ? ` type="${opts.type}" min="0" step="1"` : ''}${
      opts.check ? ` data-check="${opts.check}" spellcheck="false"` : ''
    } value="${esc(value ?? '')}" placeholder="${esc(opts.placeholder ?? '')}"></label>`;

  const image = (label: string, path: string, url: string, kind: 'cover' | 'qr') => `
    <div class="me-image ${kind}">
      <div class="me-thumb" data-thumb="${path}">${thumb(url, label)}</div>
      <div class="me-image-ctl">
        <label class="me-single">${esc(label)} URL<input data-path="${path}" data-check="image" spellcheck="false" value="${esc(url)}" placeholder="/uploads/…  or  https://…"></label>
        <div class="row2 tight">
          <button type="button" data-act="upload" data-target="${path}">Upload image…</button>
          <button type="button" class="ghost" data-act="clear" data-target="${path}">Remove</button>
        </div>
      </div>
    </div>`;

  const thumb = (url: string, label: string) =>
    url && isImageUrl(url) ? `<img src="${esc(url)}" alt="${esc(label)}">` : `<span>${label === 'QR code' ? 'No QR' : 'Typographic cover'}</span>`;

  const controls = (list: ListKey, index: number, length: number) => `
    <span class="me-ctl">
      <button type="button" data-act="up" data-list="${list}" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button type="button" data-act="down" data-list="${list}" data-index="${index}" ${index === length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button type="button" data-act="remove" data-list="${list}" data-index="${index}" aria-label="Remove">×</button>
    </span>`;

  const pad = (i: number) => String(i + 1).padStart(2, '0');

  const publicationCard = (index: number) => {
    const p = doc.publications[index];
    const at = (key: string) => `publications.${index}.${key}`;
    return `
      <details class="me-card" data-id="${esc(p.id)}" ${open.has(p.id) ? 'open' : ''}>
        <summary>
          <span class="me-num">${pad(index)}</span>
          <span class="me-mini">${p.cover && isImageUrl(p.cover) ? `<img src="${esc(p.cover)}" alt="">` : ''}</span>
          <span class="me-title">${esc(bilingualLabel(p.title, 'Untitled'))}<small>${esc(p.year)}</small></span>
          ${controls('publications', index, doc.publications.length)}
        </summary>
        <div class="me-body">
          ${image('Cover', at('cover'), p.cover, 'cover')}
          <div class="me-head"><span></span><span>EN</span><span>中文</span></div>
          ${pair('Title', at('title'), p.title)}
          ${pair('Subtitle', at('subtitle'), p.subtitle)}
          <div class="me-singles">
            ${single('Year', at('year'), p.year, { placeholder: '2026' })}
            ${single('Pages', at('pages'), p.pages, { type: 'number', placeholder: '48' })}
          </div>
          ${pair('Printing', at('format'), p.format, { zhPlaceholder: 'Risograph 双色印刷' })}
          ${pair('Edition', at('edition'), p.edition, { zhPlaceholder: '限量 100 册' })}
          ${pair('Size', at('size'), p.size, { hint: 'one side is enough' })}
          ${pair('Excerpt', at('excerpt'), p.excerpt, { rows: 9, hint: 'blank line = new paragraph' })}
          ${pair('Excerpt source', at('excerptSource'), p.excerptSource, { zhPlaceholder: '选自第一章' })}
          ${single('Order / shop link', at('link'), p.link, { check: 'link', placeholder: 'https://…  — leave empty to offer an email link' })}
          ${pair('Button label', at('linkLabel'), p.linkLabel, { hint: 'optional' })}
        </div>
      </details>`;
  };

  const channelCard = (index: number) => {
    const c = doc.channels[index];
    const at = (key: string) => `channels.${index}.${key}`;
    return `
      <details class="me-card" data-id="${esc(c.id)}" ${open.has(c.id) ? 'open' : ''}>
        <summary>
          <span class="me-num">${pad(index)}</span>
          <span class="me-mini qr">${c.qr && isImageUrl(c.qr) ? `<img src="${esc(c.qr)}" alt="">` : ''}</span>
          <span class="me-title">${esc(bilingualLabel(c.name, 'Unnamed'))}<small>${esc(c.handle)}</small></span>
          ${controls('channels', index, doc.channels.length)}
        </summary>
        <div class="me-body">
          ${image('QR code', at('qr'), c.qr, 'qr')}
          <div class="me-head"><span></span><span>EN</span><span>中文</span></div>
          ${pair('Platform', at('name'), c.name, { zhPlaceholder: '微信公众号' })}
          ${pair('Note', at('note'), c.note, { hint: 'optional', zhPlaceholder: '扫码关注' })}
          <div class="me-singles">
            ${single('Account / ID', at('handle'), c.handle, { placeholder: '@name' })}
            ${single('Link', at('href'), c.href, { check: 'link', placeholder: 'https://…  (optional)' })}
          </div>
        </div>
      </details>`;
  };

  /* ── Render ─────────────────────────────────────────────────────── */

  const statusText = () =>
    meta.custom
      ? `Published ${meta.updated ? timeLabel(meta.updated) : ''}`
      : 'Showing the built-in sample content (content/more.ts) — edit and save to replace it';

  const updateStatus = () => {
    const status = root.querySelector('#me-status');
    if (!status) return;
    status.innerHTML = `${esc(statusText())}${dirty() ? ' · <b class="warn">unsaved changes</b>' : ''}`;
    root.querySelector('#me-save')?.classList.toggle('primary', dirty());
  };

  function render() {
    root.innerHTML = `
      <div class="me-bar">
        <p class="hint" id="me-status"></p>
        <div class="row2 tight">
          <button type="button" id="me-save">Save</button>
          <a class="me-link" href="${MORE_PATH}" target="_blank" rel="noopener">View page ↗</a>
          <span class="me-spacer"></span>
          <button type="button" class="ghost" id="me-export">Export JSON</button>
          <button type="button" class="ghost" id="me-import">Import JSON…</button>
          <button type="button" class="ghost" id="me-reset" ${meta.custom ? '' : 'disabled'}>Reset to samples</button>
        </div>
      </div>

      <h3 class="admin-sec">Intro</h3>
      <div class="me-head"><span></span><span>EN</span><span>中文</span></div>
      ${pair('Intro', 'intro', doc.intro, { rows: 3 })}

      <h3 class="admin-sec">Publications <small class="hint">${doc.publications.length}</small></h3>
      <p class="hint">Order here = order on the page. Covers: any ratio, about 1200 px on the long side; leave empty for a typographic cover.</p>
      <div class="me-list">${doc.publications.map((_, i) => publicationCard(i)).join('') || '<p class="hint">No publications — the section is hidden.</p>'}</div>
      <button type="button" data-act="add" data-list="publications">+ Add publication</button>

      <h3 class="admin-sec">Contact channels <small class="hint">${doc.channels.length}</small></h3>
      <p class="hint">Social accounts with optional QR codes (square PNG/JPG). The contact email comes from Settings.</p>
      <div class="me-list">${doc.channels.map((_, i) => channelCard(i)).join('') || '<p class="hint">No channels — only the email is shown.</p>'}</div>
      <button type="button" data-act="add" data-list="channels">+ Add channel</button>`;
    updateStatus();
    root.querySelectorAll<HTMLInputElement>('[data-check]').forEach(checkField);
  }

  /* ── Editing ────────────────────────────────────────────────────── */

  const checkField = (input: HTMLInputElement) => {
    const value = input.value.trim();
    const ok = input.dataset.check === 'image' ? isImageUrl(value) : isLinkUrl(value);
    input.classList.toggle('invalid', !ok);
    input.title = ok ? '' : input.dataset.check === 'image' ? 'Use /uploads/…, another site path, or an https:// URL' : 'Use https://, http:// or mailto:';
  };

  const setImage = (path: string, url: string) => {
    setPath(doc, path, url);
    const input = root.querySelector<HTMLInputElement>(`input[data-path="${path}"]`);
    if (input) {
      input.value = url;
      checkField(input);
    }
    refreshPreview(path);
    updateStatus();
  };

  const refreshPreview = (path: string) => {
    const url = String(getPath(doc, path) ?? '');
    const box = root.querySelector<HTMLElement>(`[data-thumb="${path}"]`);
    const kind = path.endsWith('.qr') ? 'QR code' : 'Cover';
    if (box) box.innerHTML = thumb(url, kind);
    const mini = box?.closest('details')?.querySelector('.me-mini');
    if (mini) mini.innerHTML = url && isImageUrl(url) ? `<img src="${esc(url)}" alt="">` : '';
  };

  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    const path = input.dataset?.path;
    if (!path) return;
    let value: unknown = input.value;
    if (input instanceof HTMLInputElement && input.type === 'number') value = input.value === '' ? null : Number(input.value);
    setPath(doc, path, value);
    input.classList.remove('invalid');
    if (input instanceof HTMLInputElement && input.dataset.check) checkField(input);
    if (/\.(cover|qr)$/.test(path)) refreshPreview(path);
    // Keep the collapsed header in sync with the title / name / year / handle.
    const card = input.closest('details');
    const match = /^(publications|channels)\.(\d+)\./.exec(path);
    if (card && match) {
      const list = match[1] as ListKey;
      const index = Number(match[2]);
      const title = card.querySelector('.me-title');
      if (title) {
        title.innerHTML =
          list === 'publications'
            ? `${esc(bilingualLabel(doc.publications[index].title, 'Untitled'))}<small>${esc(doc.publications[index].year)}</small>`
            : `${esc(bilingualLabel(doc.channels[index].name, 'Unnamed'))}<small>${esc(doc.channels[index].handle)}</small>`;
      }
    }
    updateStatus();
  });

  root.addEventListener(
    'toggle',
    (event) => {
      const card = event.target as HTMLDetailsElement;
      if (!(card instanceof HTMLDetailsElement) || !card.dataset.id) return;
      if (card.open) open.add(card.dataset.id);
      else open.delete(card.dataset.id);
    },
    true,
  );

  root.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!button) return;
    event.preventDefault(); // buttons inside <summary> must not toggle the card
    const { act, list, target } = button.dataset;
    const index = Number(button.dataset.index);
    const items = list ? (doc[list as ListKey] as { id: string }[]) : [];

    if (act === 'add' && list) {
      const item = list === 'publications' ? blankPublication() : blankChannel();
      items.push(item);
      open.add(item.id);
      render();
      root.querySelector<HTMLInputElement>(`details[data-id="${item.id}"] input[data-path$=".en"]`)?.focus();
    } else if ((act === 'up' || act === 'down') && list) {
      move(items, index, act === 'up' ? -1 : 1);
      render();
    } else if (act === 'remove' && list) {
      const label = list === 'publications' ? bilingualLabel(doc.publications[index].title, 'this publication') : bilingualLabel(doc.channels[index].name, 'this channel');
      if (!confirm(`Remove “${label}”? (Nothing is published until you save.)`)) return;
      items.splice(index, 1);
      render();
    } else if (act === 'upload' && target) {
      const file = await pickFile(IMAGE_TYPES);
      if (!file) return;
      try {
        toast(`Uploading ${file.name}…`);
        const uploaded = await busy(button.parentElement!, () => api.uploads.upload(file));
        setImage(target, uploaded.url);
        hooks.onFilesChanged?.();
        toast('Uploaded — save to publish');
      } catch (error) {
        fail(error);
      }
    } else if (act === 'clear' && target) {
      setImage(target, '');
    }
  });

  /** Jump to the field a validation error names (`details.field`). */
  const showInvalid = (error: unknown) => {
    const field = error instanceof ApiError ? String(error.details?.field ?? '') : '';
    const input = field ? root.querySelector<HTMLElement>(`[data-path="${field}"]`) : null;
    if (!input) return;
    const card = input.closest('details');
    if (card && !card.open) card.open = true;
    input.classList.add('invalid');
    input.scrollIntoView({ block: 'center' });
    input.focus({ preventScroll: true });
  };

  const save = async () => {
    try {
      const response = await busy(root, () => api.more.save(doc));
      load(response);
      hooks.onFilesChanged?.();
      toast('Saved — /more is updated');
    } catch (error) {
      fail(error);
      showInvalid(error);
    }
  };

  root.addEventListener('click', async (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('button[id]')?.id;
    if (id === 'me-save') await save();
    else if (id === 'me-export') {
      const blob = new Blob([JSON.stringify({ document: doc }, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `more-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } else if (id === 'me-import') {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        if (!confirm(`Replace the whole /more page with ${file.name}? This publishes it immediately.`)) return;
        load(await busy(root, () => api.more.save(documentFromImport(json) as MoreDocument)));
        hooks.onFilesChanged?.();
        toast('Imported and saved');
      } catch (error) {
        fail(error instanceof SyntaxError ? new Error(`${file.name} is not valid JSON`) : error);
      }
    } else if (id === 'me-reset') {
      if (!confirm('Delete the saved page and go back to the built-in sample content? Export JSON first if you may want it back.')) return;
      try {
        load(await busy(root, () => api.more.reset()));
        hooks.onFilesChanged?.();
        toast('Reset to the built-in content');
      } catch (error) {
        fail(error);
      }
    }
  });

  root.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  root.innerHTML = '<p class="hint">Loading…</p>';
  api.more.document().then(load).catch(fail);

  return {
    isDirty: dirty,
    /** Pick up server-side changes (a renamed upload); never discards unsaved edits. */
    reload: () => {
      if (dirty()) return toast('A file used on /more was renamed — check its URL in the More tab before saving', true);
      api.more.document().then(load).catch(fail);
    },
  };
}
