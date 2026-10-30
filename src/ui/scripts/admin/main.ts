/**
 * /admin entry point: session handling + tab shell.
 * The token lives only in this tab's sessionStorage.
 */
import { ApiError, createApiClient } from '../lib/api-client.ts';
import { $, esc } from './dom.ts';
import { articlesPanel } from './panels/articles.ts';
import { filesPanel } from './panels/files.ts';
import { morePanel } from './panels/more.ts';
import { settingsPanel } from './panels/settings.ts';

const STORAGE_KEY = 'rra.admin.token';
const app = $('#app');
let token = sessionStorage.getItem(STORAGE_KEY) ?? '';

const api = createApiClient({
  token: () => token,
  onUnauthorized: () => logout('Your session has expired — sign in again.'),
});

function logout(message = '') {
  token = '';
  sessionStorage.removeItem(STORAGE_KEY);
  renderLogin(message);
}

function renderLogin(message = '') {
  app.innerHTML = `
    <form class="card" id="lg">
      <h1>Admin</h1>
      ${message ? `<p class="hint" role="alert">${esc(message)}</p>` : ''}
      <label class="sr" for="tk">Admin token</label>
      <input id="tk" type="password" placeholder="ADMIN_TOKEN" autocomplete="current-password" autofocus required>
      <button>Enter</button>
    </form>`;
  $('#lg').onsubmit = async (event) => {
    event.preventDefault();
    const candidate = $<HTMLInputElement>('#tk').value.trim();
    try {
      await api.auth.login(candidate);
      token = candidate;
      sessionStorage.setItem(STORAGE_KEY, token);
      await boot();
    } catch (error) {
      renderLogin(error instanceof Error ? error.message : String(error));
    }
  };
}

const TABS = ['Articles', 'More', 'Settings', 'Files'] as const;

async function boot() {
  if (!token) return renderLogin();
  let settings;
  try {
    settings = await api.settings.get();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return; // onUnauthorized already showed the login
    return renderLogin(error instanceof Error ? error.message : String(error));
  }

  app.innerHTML = `
    <nav class="tabs" aria-label="Admin navigation">
      <div class="tabs-list" role="tablist" aria-label="Admin sections">
        ${TABS.map((tab, index) => `<button id="tab-${tab}" role="tab" data-tab="${tab}" aria-controls="panel-${tab}" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}" class="${index ? '' : 'on'}">${tab}</button>`).join('')}
      </div>
      <a href="/" class="tabs-site">← Site</a>
      <button type="button" id="logout" class="ghost">Sign out</button>
    </nav>
    ${TABS.map((tab, index) => `<section id="panel-${tab}" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="0" data-panel="${tab}" ${index ? 'hidden' : ''}></section>`).join('')}`;

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

  const articles = articlesPanel($('[data-panel=Articles]'), api, settings.status);
  settingsPanel($('[data-panel=Settings]'), api, settings, (next) => {
    articles.show(next.status);
    void articles.reload();
  });
  const files = filesPanel($('[data-panel=Files]'), api, { onRenamed: () => more.reload() });
  const more = morePanel($('[data-panel=More]'), api, { onFilesChanged: () => void files.refresh().catch(() => undefined) });

  const fromHash = TABS.find((tab) => tab.toLowerCase() === location.hash.slice(1));
  if (fromHash) app.querySelector<HTMLButtonElement>(`[data-tab=${fromHash}]`)?.click();
}

void boot();
