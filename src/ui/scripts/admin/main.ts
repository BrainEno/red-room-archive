/**
 * /admin entry point: session handling + tab shell.
 * The token lives only in this tab's sessionStorage.
 */
import { ApiError, createApiClient } from '../lib/api-client.ts';
import { $, esc } from './dom.ts';
import { dataPanel } from './panels/data.ts';
import { entriesPanel } from './panels/entries.ts';
import { filesPanel } from './panels/files.ts';
import { postsPanel } from './panels/posts.ts';
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

const TABS = ['Entries', 'Posts', 'Files', 'Data', 'Settings'] as const;

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
    <nav class="tabs" role="tablist">
      ${TABS.map((tab, index) => `<button role="tab" data-tab="${tab}" aria-selected="${index === 0}" class="${index ? '' : 'on'}">${tab}</button>`).join('')}
      <a href="/" class="tabs-site">← Site</a>
      <button type="button" id="logout" class="ghost">Sign out</button>
    </nav>
    ${TABS.map((tab, index) => `<section role="tabpanel" data-panel="${tab}" ${index ? 'hidden' : ''}></section>`).join('')}`;

  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.onclick = () => {
      app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((other) => {
        other.classList.toggle('on', other === button);
        other.setAttribute('aria-selected', String(other === button));
      });
      app.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => (panel.hidden = panel.dataset.panel !== button.dataset.tab));
      history.replaceState(null, '', `#${button.dataset.tab!.toLowerCase()}`);
    };
  });
  $('#logout').onclick = () => logout();

  entriesPanel($('[data-panel=Entries]'), api);
  postsPanel($('[data-panel=Posts]'), api);
  filesPanel($('[data-panel=Files]'), api);
  dataPanel($('[data-panel=Data]'), api);
  settingsPanel($('[data-panel=Settings]'), api, settings);

  const fromHash = TABS.find((tab) => tab.toLowerCase() === location.hash.slice(1));
  if (fromHash) app.querySelector<HTMLButtonElement>(`[data-tab=${fromHash}]`)?.click();
}

void boot();
