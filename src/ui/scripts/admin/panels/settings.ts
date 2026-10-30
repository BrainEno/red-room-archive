/** Settings panel — site copy, the Notion connection and the column check. */
import { makeProfile, validateProfile, PROFILE_MAX_BYTES } from '../../../../../public/profile-format.js';
import type { ArticleField, NotionSchemaResponse, SettingKey, SettingsResponse } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, pickFile, toast } from '../dom.ts';

const LABELS: Record<SettingKey, string> = {
  site_name: 'Site name',
  site_email: 'Contact email',
  site_about: 'Description — English (homepage, meta description, RSS)',
  site_intro: 'Homepage intro — English (revealed word by word)',
  site_about_zh: 'Description — 简体中文（首页、搜索摘要、RSS）',
  site_intro_zh: 'Homepage intro — 简体中文',
  site_tagline: 'Homepage tagline — English (bottom of opening screen)',
  site_tagline_zh: 'Homepage tagline — 简体中文（首页首屏底部）',
  site_facts: 'Homepage facts — English, one “Label: value” per line (max 6; “-” hides the row)',
  site_facts_zh: 'Homepage facts — 简体中文，每行“标签：内容”（最多 6 行；填 “-” 隐藏）',
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

const MULTILINE: SettingKey[] = ['site_about', 'site_intro', 'site_about_zh', 'site_intro_zh', 'site_facts', 'site_facts_zh', 'tag_glossary'];

function schemaHtml(schema: NotionSchemaResponse): string {
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
    if (key === 'site_facts' || key === 'site_facts_zh') return `<textarea name="${key}" rows="3" spellcheck="false">${value}</textarea>`;
    if (MULTILINE.includes(key)) return `<textarea name="${key}" rows="3">${value}</textarea>`;
    if (key === 'NOTION_TOKEN') {
      return `<input name="${key}" type="password" autocomplete="off" value="" placeholder="${
        state.values.hasToken ? `configured (${value}) — leave blank to keep` : 'not set'
      }">`;
    }
    if (key === 'NOTION_DATABASE_ID') return `<input name="${key}" value="${value}" placeholder="https://www.notion.so/…  or  0123456789abcdef…" spellcheck="false">`;
    return `<input name="${key}" value="${value}">`;
  };

  const render = () => {
    root.innerHTML = `
      <section aria-labelledby="profile-transfer-title">
        <h2 id="profile-transfer-title">Site profile backup</h2>
        <p class="hint">Export the last saved public site text, homepage facts and tag pairs as JSON. No Notion credentials or uploaded files are included. Import replaces these fields immediately; unsaved edits will be lost. Static Netlify/Cloudflare sites need a rebuild using the file.</p>
        <div class="row2 tight"><button type="button" id="profile-export">Export site profile</button><button type="button" id="profile-import">Import site profile…</button></div>
        <h3 class="admin-sec" id="bundle-title">Content bundle for static sites</h3>
        <p class="hint" id="bundle-hint">One ZIP with the site profile, the More page and the files it uses (covers, QR codes) plus an uploaded statue model. Unzip it into <code>site-content/</code> in the repository and rebuild on Netlify or Cloudflare. Articles still come from Notion; no credentials are included.</p>
        <div class="row2 tight"><button type="button" id="bundle-download" aria-describedby="bundle-hint">Download content bundle (.zip)</button></div>
      </section>
      <p id="notion-config-status" role="status" class="hint">${state.status.notion
        ? 'Notion settings are configured (environment or saved settings). Connection and database permissions are not yet verified; use Check columns.'
        : 'Notion is not fully configured. Set a token and database ID, then use Check columns.'}</p>
      <form class="form" id="sf">${keys.map((key) => `<label>${LABELS[key]}${field(key)}</label>`).join('')}
        <div class="row2 tight"><button>Save</button><button type="button" id="chk">Check columns</button></div>
      </form>
      <p class="hint">Description and Homepage intro appear after scrolling; Description also appears in search/RSS. Fill the fields for the language you view. Save before checking columns. Open the database itself (not the containing page), and add your integration via ••• → Connections. <a href="https://github.com/BrainEno/red-room-archive/blob/main/README.md#连接-notion" target="_blank" rel="noopener noreferrer">Connection guide ↗</a></p>
      <div id="schema"></div>`;

    const form = $<HTMLFormElement>('#sf', root);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(form)) as Record<SettingKey, string>;
        const previous = state;
        state = await busy(form, () => api.settings.update(values));
        const profileKeys: SettingKey[] = ['site_name', 'site_email', 'site_about', 'site_intro', 'site_about_zh', 'site_intro_zh', 'site_tagline', 'site_tagline_zh', 'site_facts', 'site_facts_zh'];
        if (profileKeys.some((key) => previous.values[key] !== state.values[key])) {
          try { localStorage.setItem('rra:settings-changed', `${Date.now()}-${Math.random()}`); } catch { /* refresh other tabs manually */ }
        }
        render();
        onSaved(state);
        toast('Saved — open site tabs will refresh');
      } catch (error) {
        fail(error);
      }
    };

    $('#profile-export', root).onclick = () => {
      try {
        const profile = makeProfile(state.values);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2) + '\n'], { type: 'application/json' }));
        link.download = 'site-profile.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch (error) { fail(error); }
    };
    $('#bundle-download', root).onclick = async () => {
      try {
        const { blob, filename } = await busy(root, () => api.settings.contentBundle());
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('Content bundle downloaded');
      } catch (error) { fail(error); }
    };
    $('#profile-import', root).onclick = async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      try {
        if (file.size > PROFILE_MAX_BYTES) throw new Error('Site profile is too large');
        const profile = validateProfile(JSON.parse(await file.text()));
        if (!confirm('Replace all public profile fields with this file? Unsaved edits will be lost. Notion settings will not change.')) return;
        state = await busy(root, () => api.settings.importProfile(profile));
        try { localStorage.setItem('rra:settings-changed', `${Date.now()}-${Math.random()}`); } catch { /* refresh other tabs manually */ }
        render();
        onSaved(state);
        toast('Profile imported and saved');
      } catch (error) { fail(error instanceof SyntaxError ? new Error('Invalid JSON file') : error); }
    };

    $('#chk', root).onclick = async () => {
      const target = $('#schema', root);
      const data = new FormData(form);
      if (String(data.get('NOTION_TOKEN') ?? '').trim() || String(data.get('NOTION_DATABASE_ID') ?? '').trim() !== state.values.NOTION_DATABASE_ID) {
        target.innerHTML = '<p class="warn" role="alert">Save the new token or database link before checking columns.</p>';
        return;
      }
      try {
        const schema = await busy(form, () => api.notion.schema());
        target.innerHTML = schemaHtml(schema);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        target.innerHTML = `<p class="warn" role="alert">${esc(message)}</p>`;
        fail(error);
      }
    };
  };
  render();
}
