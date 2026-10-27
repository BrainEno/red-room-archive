/** Files panel — upload library files or the 3D statue model; rename / delete. */
import type { ApiClient } from '../../lib/api-client.ts';
import { $, bytes, esc, fail, pickFile, toast } from '../dom.ts';

export function filesPanel(root: HTMLElement, api: ApiClient) {
  root.innerHTML = `
    <div class="row2">
      <select id="as" aria-label="Upload type">
        <option value="">Library file (audio / video / image / pdf)</option>
        <option value="model">Statue model (.glb) → replaces the 3D statue</option>
      </select>
      <button id="pk">Choose file…</button>
      <span class="hint" id="fu"></span>
    </div>
    <ul class="files" id="fl"></ul>`;

  const listEl = $('#fl', root);

  const refresh = async () => {
    const { files, usage } = await api.uploads.list();
    $('#fu', root).textContent = `${usage.count} files · ${bytes(usage.bytes)} used · max ${bytes(usage.limitBytes)} per upload`;
    listEl.innerHTML =
      files
        .map(
          (file) => `<li data-name="${esc(file.name)}">
            <span>${esc(file.name)}</span><span class="hint">${bytes(file.size)}</span>
            <button data-action="copy">Copy URL</button><button data-action="rename">Rename</button><button data-action="delete">Delete</button></li>`,
        )
        .join('') || '<li class="hint">No files yet</li>';
  };

  $('#pk', root).onclick = async () => {
    const asModel = $<HTMLSelectElement>('#as', root).value === 'model';
    const file = await pickFile(asModel ? '.glb' : '');
    if (!file) return;
    toast(`Uploading ${file.name}…`);
    try {
      await api.uploads.upload(file, { asModel });
      toast(asModel ? 'Statue model replaced — reload the homepage to see it' : 'Uploaded');
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
        toast('URL copied');
      } else if (button.dataset.action === 'rename') {
        const next = prompt('New file name (keep the extension):', name);
        if (!next || next === name) return;
        await api.uploads.rename(name, next);
        toast('Renamed');
        await refresh();
      } else if (confirm(`Delete ${name}?`)) {
        await api.uploads.remove(name);
        toast('Deleted');
        await refresh();
      }
    } catch (error) {
      fail(error);
    }
  };

  refresh().catch(fail);
}
