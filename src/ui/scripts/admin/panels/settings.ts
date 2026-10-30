/**
 * Settings panel, grouped: Site · Homepage copy (EN | 中文 side by side) ·
 * Topics · Notion (+ column check) · Backup & static sites.
 * One form, one Save in a sticky bar that shows whether anything is unsaved.
 */
import { makeProfile, validateProfile, PROFILE_MAX_BYTES } from '../../../../../public/profile-format.js';
import type { ArticleField, NotionSchemaResponse, SettingKey, SettingsResponse } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, pickFile, toast } from '../dom.ts';
import { errorText, t } from '../i18n.ts';

export type SettingsSection = 'site' | 'home' | 'topics' | 'notion' | 'backup';
const SECTIONS: SettingsSection[] = ['site', 'home', 'topics', 'notion', 'backup'];

/** Homepage rows: English key, Chinese key, single-line or rows. */
const HOME_ROWS = [
  { id: 'tagline', en: 'site_tagline', zh: 'site_tagline_zh', rows: 0 },
  { id: 'about', en: 'site_about', zh: 'site_about_zh', rows: 3 },
  { id: 'intro', en: 'site_intro', zh: 'site_intro_zh', rows: 3 },
  { id: 'facts', en: 'site_facts', zh: 'site_facts_zh', rows: 4 },
] as const satisfies readonly { id: keyof typeof t.settings.rows; en: SettingKey; zh: SettingKey; rows: number }[];

const PROFILE_KEYS: SettingKey[] = ['site_name', 'site_email', 'site_about', 'site_intro', 'site_about_zh', 'site_intro_zh', 'site_tagline', 'site_tagline_zh', 'site_facts', 'site_facts_zh'];

const announceProfileChange = () => {
  try {
    localStorage.setItem('rra:settings-changed', `${Date.now()}-${Math.random()}`);
  } catch {
    /* other tabs refresh manually */
  }
};

const downloadBlob = (blob: Blob, filename: string) => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

function schemaHtml(schema: NotionSchemaResponse): string {
  const s = t.settings;
  const rows = (Object.keys(s.fields) as ArticleField[])
    .map((field) => {
      const m = schema.mapping[field];
      const found = m.property
        ? `<span class="ok">✓</span> <code>${esc(m.property)}</code> <small class="hint">${esc(m.type)}</small>`
        : `<span class="${m.required ? 'warn' : 'hint'}">— ${esc(m.fallback)}</span>`;
      return `<tr><td>${esc(s.fields[field])}</td><td>${found}</td><td><small class="hint">${esc(m.accepts.join(' / '))}</small></td></tr>`;
    })
    .join('');
  return `
    <h4 class="set-sub">${esc(schema.database.title)}</h4>
    ${schema.warnings.length ? `<ul class="warnings">${schema.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : `<p class="ok">${esc(s.allSet)}</p>`}
    <div class="table-scroll"><table class="grid"><thead><tr><th>${esc(s.schemaCols.field)}</th><th>${esc(s.schemaCols.column)}</th><th>${esc(s.schemaCols.types)}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function settingsPanel(root: HTMLElement, api: ApiClient, initial: SettingsResponse, onSaved: (state: SettingsResponse) => void) {
  const s = t.settings;
  let state = initial;
  let snapshot = '';

  const value = (key: SettingKey) => esc(state.values[key]);
  const label = (key: SettingKey) => esc(s.labels[key] ?? key);

  const homeRow = (row: (typeof HOME_ROWS)[number]) => {
    const text = s.rows[row.id];
    const control = (key: SettingKey, lang: 'en' | 'zh-CN') => {
      const attrs = `name="${key}" lang="${lang}" aria-label="${esc(`${text.label} — ${lang === 'en' ? t.common.english : t.common.chinese}`)}" aria-describedby="hint-${row.id}"${row.id === 'facts' ? ' spellcheck="false"' : ''}`;
      return row.rows ? `<textarea ${attrs} rows="${row.rows}">${value(key)}</textarea>` : `<input ${attrs} value="${value(key)}">`;
    };
    return `<div class="me-pair"><span class="me-label">${esc(text.label)}<small id="hint-${row.id}">${esc(text.hint)}</small></span>${control(row.en, 'en')}${control(row.zh, 'zh-CN')}</div>`;
  };

  const render = () => {
    root.innerHTML = `
      <nav class="set-nav" aria-label="${esc(s.nav)}">
        ${SECTIONS.map((id) => `<a href="#set-${id}" data-section="${id}">${esc(s.groups[id])}</a>`).join('')}
      </nav>

      <form class="form set-form" id="sf">
        <fieldset class="set-group" id="set-site">
          <legend>${esc(s.groups.site)}</legend>
          <div class="set-cols">
            <label>${label('site_name')}<input name="site_name" value="${value('site_name')}"></label>
            <label>${label('site_email')}<input name="site_email" type="email" value="${value('site_email')}" spellcheck="false"></label>
          </div>
        </fieldset>

        <fieldset class="set-group" id="set-home">
          <legend>${esc(s.groups.home)}</legend>
          <p class="hint">${esc(s.homeHint)}</p>
          <div class="me-head" aria-hidden="true"><span></span><span>EN</span><span>中文</span></div>
          ${HOME_ROWS.map(homeRow).join('')}
        </fieldset>

        <fieldset class="set-group" id="set-topics">
          <legend>${esc(s.groups.topics)}</legend>
          <label>${label('tag_glossary')}<textarea name="tag_glossary" rows="5" spellcheck="false" placeholder="Fiction = 小说&#10;Poetry, Poem = 诗歌" aria-describedby="topics-hint">${value('tag_glossary')}</textarea></label>
          <p class="hint" id="topics-hint">${esc(s.topicsHint)}</p>
        </fieldset>

        <fieldset class="set-group" id="set-notion">
          <legend>${esc(s.groups.notion)}</legend>
          <p id="notion-config-status" role="status" class="hint">${esc(state.status.notion ? s.notionConfigured : s.notionMissing)}</p>
          <label>${label('NOTION_TOKEN')}<input name="NOTION_TOKEN" type="password" autocomplete="off" value="" placeholder="${esc(
            state.values.hasToken ? s.tokenSet(state.values.NOTION_TOKEN) : s.tokenUnset,
          )}"></label>
          <label>${label('NOTION_DATABASE_ID')}<input name="NOTION_DATABASE_ID" value="${value('NOTION_DATABASE_ID')}" placeholder="https://www.notion.so/…  or  0123456789abcdef…" spellcheck="false"></label>
          <div class="row2 tight"><button type="button" id="chk">${esc(s.check)}</button></div>
          <p class="hint">${esc(s.notionHint)} <a href="https://github.com/BrainEno/red-room-archive/blob/main/README.md#连接-notion" target="_blank" rel="noopener noreferrer">${esc(s.guide)}</a></p>
          <div id="schema"></div>
        </fieldset>

        <div class="set-bar">
          <span class="hint" id="sf-state" aria-live="polite"></span>
          <button id="sf-save">${esc(t.common.save)}</button>
        </div>
      </form>

      <section class="set-group" id="set-backup" aria-labelledby="profile-transfer-title">
        <h3 class="set-legend">${esc(s.groups.backup)}</h3>
        <h4 class="set-sub" id="profile-transfer-title">${esc(s.profileTitle)}</h4>
        <p class="hint">${esc(s.profileHint)}</p>
        <div class="row2 tight"><button type="button" id="profile-export">${esc(s.export)}</button><button type="button" id="profile-import">${esc(s.import)}</button></div>
        <h4 class="set-sub" id="bundle-title">${esc(s.bundleTitle)}</h4>
        <p class="hint" id="bundle-hint">${s.bundleHint}</p>
        <div class="row2 tight"><button type="button" id="bundle-download" aria-describedby="bundle-hint">${esc(s.bundle)}</button></div>
      </section>`;

    const form = $<HTMLFormElement>('#sf', root);
    const serialize = () => JSON.stringify([...new FormData(form)]);
    snapshot = serialize();
    const showState = () => {
      const changed = dirty();
      $('#sf-state', root).innerHTML = changed ? `<b class="warn">${esc(t.common.unsaved)}</b>` : esc(s.clean);
      $('#sf-save', root).classList.toggle('primary', changed);
    };
    dirty = () => serialize() !== snapshot;
    form.addEventListener('input', showState);
    showState();

    root.querySelectorAll<HTMLAnchorElement>('[data-section]').forEach((link) => {
      link.onclick = (event) => {
        event.preventDefault(); // the #hash belongs to the tab router
        reveal(link.dataset.section as SettingsSection);
      };
    });

    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(form)) as Record<SettingKey, string>;
        const previous = state;
        state = await busy(form, () => api.settings.update(values));
        if (PROFILE_KEYS.some((key) => previous.values[key] !== state.values[key])) announceProfileChange();
        render();
        onSaved(state);
        toast(s.savedToast);
      } catch (error) {
        fail(error);
      }
    };

    $('#profile-export', root).onclick = () => {
      try {
        const profile = makeProfile(state.values);
        downloadBlob(new Blob([JSON.stringify(profile, null, 2) + '\n'], { type: 'application/json' }), 'site-profile.json');
      } catch (error) {
        fail(error);
      }
    };
    $('#bundle-download', root).onclick = async () => {
      try {
        const { blob, filename } = await busy(root, () => api.settings.contentBundle());
        downloadBlob(blob, filename);
        toast(s.bundleDone);
      } catch (error) {
        fail(error);
      }
    };
    $('#profile-import', root).onclick = async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      try {
        if (file.size > PROFILE_MAX_BYTES) throw new Error(s.tooLarge);
        const profile = validateProfile(JSON.parse(await file.text()));
        if (!confirm(s.confirmImport)) return;
        state = await busy(root, () => api.settings.importProfile(profile));
        announceProfileChange();
        render();
        onSaved(state);
        toast(s.imported);
      } catch (error) {
        fail(error instanceof SyntaxError ? new Error(t.common.invalidJson) : error);
      }
    };

    $('#chk', root).onclick = async () => {
      const target = $('#schema', root);
      const data = new FormData(form);
      if (String(data.get('NOTION_TOKEN') ?? '').trim() || String(data.get('NOTION_DATABASE_ID') ?? '').trim() !== state.values.NOTION_DATABASE_ID) {
        target.innerHTML = `<p class="warn" role="alert">${esc(s.saveFirst)}</p>`;
        return;
      }
      try {
        const schema = await busy(form, () => api.notion.schema());
        target.innerHTML = schemaHtml(schema);
      } catch (error) {
        target.innerHTML = `<p class="warn" role="alert">${esc(errorText(error))}</p>`;
        fail(error);
      }
    };
  };

  let dirty = () => false;

  /** Scroll a group into view and focus its first field (used by the anchor nav and the Overview). */
  const reveal = (section: SettingsSection) => {
    const group = root.querySelector<HTMLElement>(`#set-${section}`);
    if (!group) return;
    group.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    group.querySelector<HTMLElement>('input, textarea, button')?.focus({ preventScroll: true });
  };

  root.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      root.querySelector<HTMLFormElement>('#sf')?.requestSubmit();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  render();
  return { reveal, isDirty: () => dirty() };
}
