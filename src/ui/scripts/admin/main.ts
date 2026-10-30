/**
 * /admin entry point: session handling + tab shell.
 * The token lives only in this tab's sessionStorage.
 * Tab ids (`data-tab`, `#hash`) stay English; only their labels are translated.
 *
 * On the static deployment the only server code is the newsletter's Netlify
 * Function: `/api/auth` and `/api/settings` answer 404 there, so the shell
 * checks the token against the newsletter API and shows that tab alone.
 */
import { ApiError, createApiClient } from '../lib/api-client.ts';
import { $, esc } from './dom.ts';
import { errorText, lang, setLang, t, type AdminLang, type TabId } from './i18n.ts';
import { articlesPanel } from './panels/articles.ts';
import { filesPanel } from './panels/files.ts';
import { morePanel } from './panels/more.ts';
import { newsletterPanel } from './panels/newsletter.ts';
import { overviewPanel } from './panels/overview.ts';
import { settingsPanel } from './panels/settings.ts';

const STORAGE_KEY = 'rra.admin.token';
const app = $('#app');
let token = sessionStorage.getItem(STORAGE_KEY) ?? '';

document.documentElement.lang = lang;
document.title = `${t.login.title} — Red Room`;

const api = createApiClient({
  token: () => token,
  onUnauthorized: () => logout(t.login.expired),
});

function logout(message = '') {
  token = '';
  sessionStorage.removeItem(STORAGE_KEY);
  renderLogin(message);
}

/** EN / 中文 — same look as the public site's switch; saves the choice and reloads. */
const langSwitch = () => `
  <div class="lang-switch admin-lang" role="group" aria-label="${esc(t.langGroup)}">
    ${(['en', 'zh-CN'] as AdminLang[])
      .map((code) => `<button type="button" class="ghost" data-lang="${code}" lang="${code}" aria-pressed="${code === lang}">${code === 'en' ? 'EN' : '中文'}</button>`)
      .join('<span class="admin-lang-sep" aria-hidden="true">/</span>')}
  </div>`;

const wireLangSwitch = () =>
  app.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
    button.onclick = () => {
      const next = button.dataset.lang as AdminLang;
      if (next !== lang) setLang(next);
    };
  });

function renderLogin(message = '') {
  app.innerHTML = `
    <div class="card-lang">${langSwitch()}</div>
    <form class="card" id="lg">
      <h1>${esc(t.login.title)}</h1>
      ${message ? `<p class="hint" role="alert">${esc(message)}</p>` : ''}
      <label class="sr" for="tk">${esc(t.login.token)}</label>
      <input id="tk" type="password" placeholder="ADMIN_TOKEN" autocomplete="current-password" autofocus required>
      <button>${esc(t.login.enter)}</button>
    </form>`;
  wireLangSwitch();
  $('#lg').onsubmit = async (event) => {
    event.preventDefault();
    const candidate = $<HTMLInputElement>('#tk').value.trim();
    try {
      await verify(candidate);
      token = candidate;
      sessionStorage.setItem(STORAGE_KEY, token);
      await boot();
    } catch (error) {
      token = '';
      renderLogin(errorText(error));
    }
  };
}

// A static host answers a missing route with 404 (or 405 for a POST to a static path).
const notFound = (error: unknown) => error instanceof ApiError && (error.status === 404 || error.status === 405);

/** Node server: POST /api/auth. Static deployment: the newsletter API with the same token. */
async function verify(candidate: string) {
  try {
    await api.auth.login(candidate);
    return;
  } catch (error) {
    if (!notFound(error)) throw error;
  }
  token = candidate;
  await api.newsletter.list({ limit: 1 });
}

const ALL_TABS: readonly TabId[] = ['Overview', 'Articles', 'More', 'Newsletter', 'Settings', 'Files'];

async function boot() {
  if (!token) return renderLogin();
  let settings: Awaited<ReturnType<typeof api.settings.get>> | null = null;
  try {
    settings = await api.settings.get();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return; // onUnauthorized already showed the login
    if (!notFound(error)) return renderLogin(errorText(error));
    try {
      await api.newsletter.list({ limit: 1 });
    } catch (inner) {
      if (inner instanceof ApiError && inner.status === 401) return;
      return renderLogin(errorText(inner));
    }
  }
  const TABS: readonly TabId[] = settings ? ALL_TABS : ['Newsletter'];

  app.innerHTML = `
    <nav class="tabs" aria-label="${esc(t.shell.nav)}">
      <div class="tabs-list" role="tablist" aria-label="${esc(t.shell.sections)}">
        ${TABS.map((tab, index) => `<button id="tab-${tab}" role="tab" data-tab="${tab}" aria-controls="panel-${tab}" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}" class="${index ? '' : 'on'}">${esc(t.shell.tabs[tab])}</button>`).join('')}
      </div>
      <a href="/" class="tabs-site">${esc(t.shell.site)}</a>
      ${langSwitch()}
      <button type="button" id="logout" class="ghost">${esc(t.shell.signOut)}</button>
    </nav>
    ${settings ? '' : `<p class="hint nl-static" role="note">${esc(t.shell.staticMode)}</p>`}
    ${TABS.map((tab, index) => `<section id="panel-${tab}" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="0" data-panel="${tab}" ${index ? 'hidden' : ''}></section>`).join('')}`;
  wireLangSwitch();

  /** Called when a tab becomes visible (Overview refetches so its numbers are current). */
  const onShow: Partial<Record<TabId, () => void>> = {};
  const tabs = [...app.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  const activate = (button: HTMLButtonElement) => {
    tabs.forEach((other) => {
      const selected = other === button;
      other.classList.toggle('on', selected);
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
    });
    app.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => (panel.hidden = panel.dataset.panel !== button.dataset.tab));
    history.replaceState(null, '', `#${button.dataset.tab!.toLowerCase()}`);
    onShow[button.dataset.tab as TabId]?.();
  };
  const goTo = (tab: TabId) => {
    const button = tabs.find((candidate) => candidate.dataset.tab === tab);
    if (button) activate(button);
  };
  tabs.forEach((button, index) => {
    button.onclick = () => activate(button);
    button.onkeydown = (event) => {
      let target: number;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      else return;
      event.preventDefault();
      const next = tabs[target]!;
      activate(next);
      next.focus();
    };
  });
  $('#logout').onclick = () => logout();

  const letters = newsletterPanel($('[data-panel=Newsletter]'), api);
  onShow.Newsletter = () => void letters.refresh();
  if (!settings) {
    void letters.refresh();
    return;
  }

  const articles = articlesPanel($('[data-panel=Articles]'), api, settings.status);
  const settingsView = settingsPanel($('[data-panel=Settings]'), api, settings, (next) => {
    articles.show(next.status);
    void articles.reload();
  });
  const files = filesPanel($('[data-panel=Files]'), api, { onRenamed: () => more.reload() });
  const more = morePanel($('[data-panel=More]'), api, { onFilesChanged: () => void files.refresh().catch(() => undefined) });
  const overview = overviewPanel($('[data-panel=Overview]'), api, {
    goTo: (tab, section) => {
      goTo(tab);
      if (tab === 'Settings' && section) settingsView.reveal(section);
    },
    sync: (opts) => articles.sync(opts),
  });
  onShow.Overview = () => void overview.refresh();

  const fromHash = TABS.find((tab) => tab.toLowerCase() === location.hash.slice(1));
  if (fromHash) goTo(fromHash);
}

void boot();
