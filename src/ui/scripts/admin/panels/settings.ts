/** Settings panel — site copy, Notion connection and manual sync. */
import type { SettingKey, SettingsResponse, SyncStatus } from '../../../../shared/contracts.ts';
import { COLLECTIONS, type Kind } from '../../../../shared/kinds.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, toast } from '../dom.ts';

const LABELS: Record<SettingKey, string> = {
  site_name: 'Site name',
  site_email: 'Contact email',
  site_about: 'About text',
  site_intro: 'Homepage intro (revealed word by word)',
  NOTION_TOKEN: 'Notion integration token',
  NOTION_DB_WRITING: 'Notion database ID — Works',
  NOTION_DB_FILMS: 'Notion database ID — Video',
  NOTION_DB_MUSIC: 'Notion database ID — Music',
};

const MULTILINE: SettingKey[] = ['site_about', 'site_intro'];

const describeStatus = (status: SyncStatus) =>
  [
    `Notion ${status.notion ? 'configured' : 'not configured'}`,
    `cached ${COLLECTIONS.map((c) => `${c.label.toLowerCase()}: ${status.counts[c.kind] ?? 0}`).join(', ')}`,
    `posts ${status.posts} (+${status.drafts} drafts)`,
    `last sync ${status.syncedAt ? new Date(status.syncedAt).toLocaleString() : 'never'}`,
    status.syncing ? 'syncing…' : '',
    status.syncError ? `last error: ${status.syncError}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

export function settingsPanel(root: HTMLElement, api: ApiClient, initial: SettingsResponse) {
  let state = initial;
  const keys = Object.keys(LABELS) as SettingKey[];

  const field = (key: SettingKey) => {
    const value = esc(state.values[key]);
    if (MULTILINE.includes(key)) return `<textarea name="${key}" rows="3">${value}</textarea>`;
    if (key === 'NOTION_TOKEN') {
      return `<input name="${key}" type="password" autocomplete="off" value="" placeholder="${
        state.values.hasToken ? `stored (${value}) — leave blank to keep` : 'not set'
      }">`;
    }
    return `<input name="${key}" value="${value}">`;
  };

  root.innerHTML = `
    <form class="form" id="sf">${keys.map((key) => `<label>${LABELS[key]}${field(key)}</label>`).join('')}<div><button>Save</button></div></form>
    <p class="hint" id="stt" role="status"></p>
    <div class="row2">
      <select id="sk" aria-label="Database">${COLLECTIONS.map((c) => `<option value="${c.kind}">${esc(c.label)}</option>`).join('')}</select>
      <button id="sy1">Sync this database</button><button id="sy">Sync all</button>
    </div>`;

  const show = (status: SyncStatus) => ($('#stt', root).textContent = describeStatus(status));
  show(state.status);

  const form = $<HTMLFormElement>('#sf', root);
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(form)) as Record<SettingKey, string>;
      state = await busy(form, () => api.settings.update(values));
      show(state.status);
      toast('Saved');
    } catch (error) {
      fail(error);
    }
  };

  const sync = async (kind?: Kind) => {
    toast('Syncing…');
    try {
      const result = await busy(root, () => api.sync.run(kind));
      show(result.status);
      const count = Object.values(result.synced).reduce((total, n) => total + (n ?? 0), 0);
      toast(`Synced ${count} entries`);
    } catch (error) {
      fail(error);
    }
  };
  $('#sy', root).onclick = () => sync();
  $('#sy1', root).onclick = () => sync($<HTMLSelectElement>('#sk', root).value as Kind);
}
