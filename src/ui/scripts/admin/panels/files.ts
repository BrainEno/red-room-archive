/** Files panel — upload library files or the 3D statue model; rename / delete. Files shown on /more are marked. */
import type { ApiClient } from '../../lib/api-client.ts';
import { $, bytes, esc, fail, pickFile, toast } from '../dom.ts';
import { t } from '../i18n.ts';

export function filesPanel(root: HTMLElement, api: ApiClient, hooks: { onRenamed?: () => void } = {}) {
  const f = t.files;
  root.innerHTML = `
    <div class="row2">
      <select id="as" aria-label="${esc(f.type)}">
        <option value="">${esc(f.library)}</option>
        <option value="model">${esc(f.model)}</option>
      </select>
      <button id="pk">${esc(f.choose)}</button>
      <span class="hint" id="fu"></span>
    </div>
    <ul class="files" id="fl"></ul>`;

  const listEl = $('#fl', root);

  const refresh = async () => {
    const { files, usage } = await api.uploads.list();
    $('#fu', root).textContent = f.usage(usage.count, bytes(usage.bytes), bytes(usage.limitBytes));
    listEl.innerHTML =
      files
        .map(
          (file) => `<li data-name="${esc(file.name)}"${file.usedBy?.length ? ` data-used="${esc(file.usedBy.join(','))}"` : ''}>
            <span>${esc(file.name)}${file.usedBy?.includes('more') ? ` <span class="badge" title="${esc(f.onMoreTitle)}">${esc(f.onMore)}</span>` : ''}</span><span class="hint">${bytes(file.size)}</span>
            <button data-action="copy">${esc(f.copy)}</button><button data-action="rename">${esc(f.rename)}</button><button data-action="delete">${esc(f.delete)}</button></li>`,
        )
        .join('') || `<li class="hint">${esc(f.empty)}</li>`;
  };

  $('#pk', root).onclick = async () => {
    const asModel = $<HTMLSelectElement>('#as', root).value === 'model';
    const file = await pickFile(asModel ? '.glb' : '');
    if (!file) return;
    toast(f.uploading(file.name));
    try {
      await api.uploads.upload(file, { asModel });
      toast(asModel ? f.modelReplaced : f.uploaded);
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  listEl.onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const row = button?.closest<HTMLElement>('li[data-name]');
    if (!button || !row) return;
    const name = row.dataset.name!;
    try {
      if (button.dataset.action === 'copy') {
        await navigator.clipboard.writeText(`${location.origin}/uploads/${encodeURIComponent(name)}`);
        toast(f.copied);
      } else if (button.dataset.action === 'rename') {
        const next = prompt(f.renamePrompt, name);
        if (!next || next === name) return;
        await api.uploads.rename(name, next);
        toast(row.dataset.used ? f.renamedUsed : f.renamed);
        if (row.dataset.used) hooks.onRenamed?.();
        await refresh();
      } else if (
        confirm(
          row.dataset.used ? f.confirmDeleteUsed(name) : f.confirmDelete(name),
        )
      ) {
        await api.uploads.remove(name);
        toast(f.deleted);
        await refresh();
      }
    } catch (error) {
      fail(error);
    }
  };

  refresh().catch(fail);
  return { refresh };
}
