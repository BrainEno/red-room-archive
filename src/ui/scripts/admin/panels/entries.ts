/**
 * Entries panel — create, edit and archive Notion-backed entries.
 * The form is generated from the Notion database columns, so it always
 * matches the owner's own table structure.
 */
import type { ItemDetail, NotionField, NotionWriteBody } from '../../../../shared/contracts.ts';
import { COLLECTIONS, type Kind } from '../../../../shared/kinds.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, pickFile, toast } from '../dom.ts';

const EDITABLE = ['title', 'rich_text', 'select', 'status', 'multi_select', 'number', 'checkbox', 'url', 'date', 'email'];

const fieldValue = (field: NotionField, item?: ItemDetail): string => {
  if (!item) return '';
  const value = field.type === 'title' ? item.title : item.data[field.name.toLowerCase()];
  if (value === null || value === undefined) return '';
  if (field.type === 'checkbox') return value ? 'checked' : '';
  if (Array.isArray(value)) return esc(value.join(', '));
  if (field.type === 'date') return esc(String(value).slice(0, 10));
  return esc(String(value));
};

const inputTypes: Record<string, string> = { number: 'number', date: 'date', email: 'email', url: 'url' };

function renderField(field: NotionField, index: number, item?: ItemDetail): string {
  if (!EDITABLE.includes(field.type)) return '';
  const name = esc(field.name);
  const value = fieldValue(field, item);
  const options = field.options.length
    ? `<datalist id="dl${index}">${field.options.map((option) => `<option value="${esc(option)}">`).join('')}</datalist>`
    : '';
  let input: string;
  if (field.type === 'rich_text') input = `<textarea name="${name}" rows="2">${value}</textarea>`;
  else if (field.type === 'checkbox') input = `<input type="checkbox" name="${name}" ${value}>`;
  else
    input = `<input name="${name}" type="${inputTypes[field.type] ?? 'text'}" step="any" value="${value}" ${
      options ? `list="dl${index}"` : ''
    } ${field.type === 'title' ? 'required' : ''}>`;
  const uploader = field.type === 'url' ? `<button type="button" class="up" data-for="${name}">Upload file → fill URL</button>` : '';
  return `<label>${name}<small>${esc(field.type)}</small>${input}${uploader}${options}</label>`;
}

export function entriesPanel(root: HTMLElement, api: ApiClient) {
  root.innerHTML = `
    <div class="row2">
      <select id="kind" aria-label="Collection">${COLLECTIONS.map((c) => `<option value="${c.kind}">${esc(c.label)}</option>`).join('')}</select>
      <span class="hint" id="emode">New entry · fields follow your Notion database columns.</span>
      <button id="cancel" hidden>Cancel edit</button>
    </div>
    <form class="form" id="ef"></form>
    <h2 class="sec admin-sec">Existing</h2>
    <ul class="files" id="elist"></ul>`;

  const form = $<HTMLFormElement>('#ef', root);
  const select = $<HTMLSelectElement>('#kind', root);
  const listEl = $('#elist', root);
  const modeEl = $('#emode', root);
  const cancel = $<HTMLButtonElement>('#cancel', root);
  let fields: NotionField[] = [];
  let editing: ItemDetail | null = null;
  const kind = () => select.value as Kind;

  const loadList = async () => {
    listEl.innerHTML = '<li class="hint">Loading…</li>';
    try {
      const { items } = await api.items.list(kind(), { limit: 200 });
      listEl.innerHTML =
        items
          .map(
            (item) => `<li data-id="${esc(item.id)}" data-slug="${esc(item.slug)}">
              <span>${esc(item.title)}</span><span class="hint">${esc(item.year ?? '')}</span>
              <a href="${esc(item.href)}" target="_blank" rel="noopener">View</a>
              <button data-action="edit">Edit</button><button data-action="archive">Delete</button></li>`,
          )
          .join('') || '<li class="hint">Nothing cached yet — sync from Settings, or create the first entry above.</li>';
    } catch (error) {
      listEl.innerHTML = `<li class="hint">${esc(error instanceof Error ? error.message : error)}</li>`;
    }
  };

  const setMode = (item: ItemDetail | null = null) => {
    editing = item;
    modeEl.textContent = item
      ? `Editing “${item.title}” — leave Body empty to keep the current page content.`
      : 'New entry · fields follow your Notion database columns.';
    cancel.hidden = !item;
    form.innerHTML =
      fields.map((field, index) => renderField(field, index, item ?? undefined)).join('') +
      `<label>Body<small>Markdown: # heading, &gt; quote, - list, \`\`\` code</small>
        <textarea name="__body" rows="10" ${item ? 'placeholder="Leave empty to keep the current page content"' : ''}></textarea></label>
       <div><button>${item ? 'Save changes' : 'Create in Notion'}</button></div>`;
  };

  const load = async () => {
    form.innerHTML = '<p class="hint">Loading…</p>';
    try {
      fields = (await api.notion.schema(kind())).fields;
      setMode();
    } catch (error) {
      form.innerHTML = `<p class="hint">${esc(error instanceof Error ? error.message : error)}<br>Set the Notion token and database IDs in Settings.</p>`;
    }
    void loadList();
  };

  select.onchange = load;
  cancel.onclick = () => setMode();

  form.onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.up');
    if (!button) return;
    const file = await pickFile();
    if (!file) return;
    try {
      toast(`Uploading ${file.name}…`);
      const uploaded = await api.uploads.upload(file);
      (form.elements.namedItem(button.dataset.for!) as HTMLInputElement).value = location.origin + uploaded.url;
      toast('Uploaded');
    } catch (error) {
      fail(error);
    }
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const body: NotionWriteBody = {};
    const text = String(data.get('__body') ?? '');
    if (text.trim() || !editing) body.body = text;
    for (const field of fields) {
      if (!EDITABLE.includes(field.type)) continue;
      const key = field.type === 'title' ? 'title' : field.name.toLowerCase();
      if (field.type === 'checkbox') {
        body[key] = data.get(field.name) === 'on';
        continue;
      }
      const value = data.get(field.name);
      if (value !== null && value !== '') body[key] = String(value);
    }
    try {
      await busy(form, async () => {
        if (editing) await api.notion.update(kind(), editing.id, body);
        else await api.notion.create(kind(), body);
      });
      toast(editing ? 'Updated in Notion' : 'Created in Notion');
      setMode();
      void loadList();
    } catch (error) {
      fail(error);
    }
  };

  listEl.onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const row = button?.closest<HTMLElement>('li[data-id]');
    if (!button || !row) return;
    try {
      if (button.dataset.action === 'archive') {
        if (!confirm('Archive this entry in Notion? It can be restored from the Notion trash.')) return;
        await api.notion.archive(kind(), row.dataset.id!);
        toast('Archived in Notion');
        if (editing?.id === row.dataset.id) setMode();
        void loadList();
      } else {
        setMode(await api.items.get(kind(), row.dataset.slug!));
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) {
      fail(error);
    }
  };

  void load();
}
