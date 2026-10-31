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
import { t } from '../i18n.ts';
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
const m = t.more;

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
      const attrs = `data-path="${p}" lang="${lang}" aria-label="${esc(`${label} — ${lang === 'en' ? m.langEn : m.langZh}`)}"`;
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

  const availability = (path: string, value: string | undefined) =>
    `<label class="me-single">${esc(m.availability)}<select data-path="${path}">` +
    `<option value="" ${!value ? 'selected' : ''}>${esc(m.availabilityUnset)}</option>` +
    Object.entries(m.availabilityOptions).map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${esc(label)}</option>`).join('') +
    '</select></label>';

  const image = (label: string, path: string, url: string, kind: 'cover' | 'qr') => `
    <div class="me-image ${kind}">
      <div class="me-thumb" data-thumb="${path}">${thumb(url, kind)}</div>
      <div class="me-image-ctl">
        <label class="me-single">${esc(label)} URL<input data-path="${path}" data-check="image" spellcheck="false" value="${esc(url)}" placeholder="/uploads/…  or  https://…"></label>
        <div class="row2 tight">
          <button type="button" data-act="upload" data-target="${path}">${esc(m.upload)}</button>
          <button type="button" class="ghost" data-act="clear" data-target="${path}">${esc(m.remove)}</button>
        </div>
      </div>
    </div>`;

  const thumb = (url: string, kind: 'cover' | 'qr') =>
    url && isImageUrl(url) ? `<img src="${esc(url)}" alt="${esc(kind === 'qr' ? m.qr : m.cover)}">` : `<span>${esc(kind === 'qr' ? m.noQr : m.typographic)}</span>`;

  const controls = (list: ListKey, index: number, length: number) => `
    <span class="me-ctl">
      <button type="button" data-act="up" data-list="${list}" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="${esc(m.moveUp)}">↑</button>
      <button type="button" data-act="down" data-list="${list}" data-index="${index}" ${index === length - 1 ? 'disabled' : ''} aria-label="${esc(m.moveDown)}">↓</button>
      <button type="button" data-act="remove" data-list="${list}" data-index="${index}" aria-label="${esc(m.removeItem)}">×</button>
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
          <span class="me-title">${esc(bilingualLabel(p.title, m.untitled))}<small>${esc(bilingualLabel(p.year, ''))}</small></span>
        </summary>
        <div class="me-body">
          ${controls('publications', index, doc.publications.length)}
          ${image(m.cover, at('cover'), p.cover, 'cover')}
          <div class="me-head"><span></span><span>EN</span><span>中文</span></div>
          ${pair(m.title, at('title'), p.title)}
          ${pair(m.subtitle, at('subtitle'), p.subtitle)}
          ${pair(m.description, at('description'), p.description ?? { en: '', 'zh-CN': '' }, { rows: 4, hint: m.descriptionHint })}
          ${pair(m.year, at('year'), p.year)}
          <div class="me-singles">
            ${availability(at('availability'), p.availability)}
            ${single(m.pages, at('pages'), p.pages, { type: 'number', placeholder: '48' })}
          </div>
          ${pair(m.printing, at('format'), p.format, { zhPlaceholder: 'Risograph 双色印刷' })}
          ${pair(m.edition, at('edition'), p.edition, { zhPlaceholder: '限量 100 册' })}
          ${pair(m.size, at('size'), p.size, { hint: m.oneSide })}
          ${pair(m.excerpt, at('excerpt'), p.excerpt, { rows: 9, hint: m.paragraphs })}
          ${pair(m.excerptSource, at('excerptSource'), p.excerptSource, { zhPlaceholder: '选自第一章' })}
          ${single(m.link, at('link'), p.link, { check: 'link', placeholder: m.linkPlaceholder })}
          ${pair(m.linkLabel, at('linkLabel'), p.linkLabel, { hint: m.optional })}
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
          <span class="me-title">${esc(bilingualLabel(c.name, m.unnamed))}<small>${esc(c.handle)}</small></span>
        </summary>
        <div class="me-body">
          ${controls('channels', index, doc.channels.length)}
          ${image(m.qr, at('qr'), c.qr, 'qr')}
          <div class="me-head"><span></span><span>EN</span><span>中文</span></div>
          ${pair(m.platform, at('name'), c.name, { zhPlaceholder: '微信公众号' })}
          ${pair(m.note, at('note'), c.note, { hint: m.optional, zhPlaceholder: '扫码关注' })}
          <div class="me-singles">
            ${single(m.handle, at('handle'), c.handle, { placeholder: '@name' })}
            ${single(m.href, at('href'), c.href, { check: 'link', placeholder: m.hrefPlaceholder })}
          </div>
        </div>
      </details>`;
  };

  /* ── Render ─────────────────────────────────────────────────────── */

  const statusText = () =>
    meta.custom
      ? m.published(meta.updated ? timeLabel(meta.updated) : '')
      : m.sample;

  const updateStatus = () => {
    const status = root.querySelector('#me-status');
    if (!status) return;
    status.innerHTML = `${esc(statusText())}${dirty() ? ` · <b class="warn">${esc(t.common.unsaved)}</b>` : ''}`;
    root.querySelector('#me-save')?.classList.toggle('primary', dirty());
  };

  function render() {
    root.innerHTML = `
      <div class="me-bar">
        <p class="hint" id="me-status"></p>
        <div class="row2 tight">
          <button type="button" id="me-save">${esc(t.common.save)}</button>
          <a class="me-link" href="${MORE_PATH}" target="_blank" rel="noopener">${esc(m.viewPage)}</a>
          <span class="me-spacer"></span>
          <button type="button" class="ghost" id="me-export">${esc(m.exportJson)}</button>
          <button type="button" class="ghost" id="me-import">${esc(m.importJson)}</button>
          <button type="button" class="ghost" id="me-reset" ${meta.custom ? '' : 'disabled'}>${esc(m.reset)}</button>
        </div>
      </div>

      <h3 class="admin-sec">${esc(m.intro)}</h3>
      <div class="me-head"><span></span><span>EN</span><span>中文</span></div>
      ${pair(m.intro, 'intro', doc.intro, { rows: 3 })}

      <h3 class="admin-sec">${esc(m.publications)} <small class="hint">${doc.publications.length}</small></h3>
      <p class="hint">${esc(m.publicationsHint)}</p>
      <div class="me-list">${doc.publications.map((_, i) => publicationCard(i)).join('') || `<p class="hint">${esc(m.noPublications)}</p>`}</div>
      <button type="button" data-act="add" data-list="publications">${esc(m.addPublication)}</button>

      <h3 class="admin-sec">${esc(m.channels)} <small class="hint">${doc.channels.length}</small></h3>
      <p class="hint">${esc(m.channelsHint)}</p>
      <div class="me-list">${doc.channels.map((_, i) => channelCard(i)).join('') || `<p class="hint">${esc(m.noChannels)}</p>`}</div>
      <button type="button" data-act="add" data-list="channels">${esc(m.addChannel)}</button>`;
    updateStatus();
    root.querySelectorAll<HTMLInputElement>('[data-check]').forEach(checkField);
  }

  /* ── Editing ────────────────────────────────────────────────────── */

  const checkField = (input: HTMLInputElement) => {
    const value = input.value.trim();
    const ok = input.dataset.check === 'image' ? isImageUrl(value) : isLinkUrl(value);
    input.classList.toggle('invalid', !ok);
    input.title = ok ? '' : input.dataset.check === 'image' ? m.badImage : m.badLink;
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
    if (box) box.innerHTML = thumb(url, path.endsWith('.qr') ? 'qr' : 'cover');
    const mini = box?.closest('details')?.querySelector('.me-mini');
    if (mini) mini.innerHTML = url && isImageUrl(url) ? `<img src="${esc(url)}" alt="">` : '';
  };

  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
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
            ? `${esc(bilingualLabel(doc.publications[index].title, m.untitled))}<small>${esc(bilingualLabel(doc.publications[index].year, ''))}</small>`
            : `${esc(bilingualLabel(doc.channels[index].name, m.unnamed))}<small>${esc(doc.channels[index].handle)}</small>`;
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
    event.preventDefault();
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
      const itemId = items[index]?.id;
      move(items, index, act === 'up' ? -1 : 1);
      render();
      if (itemId) {
        const card = [...root.querySelectorAll<HTMLDetailsElement>('details[data-id]')].find((element) => element.dataset.id === itemId);
        const next = card?.querySelector<HTMLButtonElement>(`button[data-act="${act}"]:not(:disabled)`);
        (next ?? card?.querySelector<HTMLElement>('summary'))?.focus();
      }
    } else if (act === 'remove' && list) {
      const label = list === 'publications' ? bilingualLabel(doc.publications[index].title, m.thisPublication) : bilingualLabel(doc.channels[index].name, m.thisChannel);
      if (!confirm(m.confirmRemove(label))) return;
      items.splice(index, 1);
      render();
    } else if (act === 'upload' && target) {
      const file = await pickFile(IMAGE_TYPES);
      if (!file) return;
      try {
        toast(m.uploading(file.name));
        const uploaded = await busy(button.parentElement!, () => api.uploads.upload(file));
        setImage(target, uploaded.url);
        hooks.onFilesChanged?.();
        toast(m.uploaded);
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
      toast(m.saved);
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
        if (!confirm(m.confirmImport(file.name))) return;
        load(await busy(root, () => api.more.save(documentFromImport(json) as MoreDocument)));
        hooks.onFilesChanged?.();
        toast(m.imported);
      } catch (error) {
        fail(error instanceof SyntaxError ? new Error(m.notJson(file.name)) : error);
      }
    } else if (id === 'me-reset') {
      if (!confirm(m.confirmReset)) return;
      try {
        load(await busy(root, () => api.more.reset()));
        hooks.onFilesChanged?.();
        toast(m.resetDone);
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

  root.innerHTML = `<p class="hint">${esc(t.common.loading)}</p>`;
  api.more.document().then(load).catch(fail);

  return {
    isDirty: dirty,
    /** Pick up server-side changes (a renamed upload); never discards unsaved edits. */
    reload: () => {
      if (dirty()) return toast(m.renamedWhileDirty, true);
      api.more.document().then(load).catch(fail);
    },
  };
}
