/** Settings panel — site copy, the Notion connection and the column check. */
import type { ArticleField, NotionSchemaResponse, SettingKey, SettingsResponse } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, toast } from '../dom.ts';

const LABELS: Record<SettingKey, string> = {
  site_name: 'Site name',
  site_email: 'Contact email',
  site_about: 'Description — English (meta description, RSS)',
  site_intro: 'Homepage intro — English (revealed word by word)',
  site_about_zh: 'Description — 简体中文',
  site_intro_zh: 'Homepage intro — 简体中文',
  tag_glossary: 'Tag pairs — one per line, e.g. “Fiction = 小说” (adds to the built-in pairs)',
  NOTION_TOKEN: 'Notion integration token',
  NOTION_DATABASE_ID: 'Notion database — id or link',
};

const FIELD_LABELS: Record<ArticleField, string> = {
  title: 'Title',
  slug: 'Slug',
  date: 'Date',
  published: 'Published',
  tags: 'Tags',
  excerpt: 'Excerpt',
  cover: 'Cover',
  rank: 'Rank (featured)',
};

const MULTILINE: SettingKey[] = ['site_about', 'site_intro', 'site_about_zh', 'site_intro_zh', 'tag_glossary'];

export function schemaHtml(schema: NotionSchemaResponse): string {
  const rows = (Object.keys(FIELD_LABELS) as ArticleField[])
    .map((field) => {
      const m = schema.mapping[field];
      const found = m.property
        ? `<span class="ok">✓</span> <code>${esc(m.property)}</code> <small class="hint">${esc(m.type)}</small>`
        : `<span class="${m.required ? 'warn' : 'hint'}">— ${esc(m.fallback)}</span>`;
      return `<tr><td>${FIELD_LABELS[field]}</td><td>${found}</td><td><small class="hint">${esc(m.accepts.join(' / '))}</small></td></tr>`;
    })
    .join('');
  return `
    <h3 class="admin-sec">${esc(schema.database.title)}</h3>
    ${schema.warnings.length ? `<ul class="warnings">${schema.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="ok">All set.</p>'}
    <table class="grid"><thead><tr><th>Field</th><th>Notion column</th><th>Accepted types</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function settingsPanel(root: HTMLElement, api: ApiClient, initial: SettingsResponse, onSaved: (state: SettingsResponse) => void) {
  let state = initial;
  const keys = Object.keys(LABELS) as SettingKey[];

  const field = (key: SettingKey) => {
    const value = esc(state.values[key]);
    if (key === 'tag_glossary') return `<textarea name="${key}" rows="4" spellcheck="false" placeholder="Fiction = 小说&#10;Poetry, Poem = 诗歌">${value}</textarea>`;
    if (MULTILINE.includes(key)) return `<textarea name="${key}" rows="3">${value}</textarea>`;
    if (key === 'NOTION_TOKEN') {
      return `<input name="${key}" type="password" autocomplete="off" value="" placeholder="${
        state.values.hasToken ? `stored (${value}) — leave blank to keep` : 'not set'
      }">`;
    }
    if (key === 'NOTION_DATABASE_ID') return `<input name="${key}" value="${value}" placeholder="https://www.notion.so/…  or  0123456789abcdef…" spellcheck="false">`;
    return `<input name="${key}" value="${value}">`;
  };

  const render = () => {
    root.innerHTML = `
      <form class="form" id="sf">${keys.map((key) => `<label>${LABELS[key]}${field(key)}</label>`).join('')}
        <div class="row2 tight"><button>Save</button><button type="button" id="chk">Check columns</button></div>
      </form>
      <p class="hint">Share the database with your integration in Notion (••• → Connections). Only a title column is required; see the README for the recognised column names.</p>
      <div id="schema"></div>`;

    const form = $<HTMLFormElement>('#sf', root);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(form)) as Record<SettingKey, string>;
        state = await busy(form, () => api.settings.update(values));
        render();
        onSaved(state);
        toast('Saved');
      } catch (error) {
        fail(error);
      }
    };

    $('#chk', root).onclick = async () => {
      const target = $('#schema', root);
      try {
        const schema = await busy(form, () => api.notion.schema());
        target.innerHTML = schemaHtml(schema);
      } catch (error) {
        target.innerHTML = '';
        fail(error);
      }
    };
  };
  render();
}
