/**
 * Newsletter forms and the two email-link pages.
 *
 * - Sign-up forms (`[data-newsletter-form]`) POST JSON to
 *   /api/newsletter/subscribe and show what actually happened. "Sent" only
 *   appears after the server accepted the request; a missing backend (a
 *   static host without the function), missing email configuration or a
 *   failed send each have their own honest message.
 * - Availability is checked once: on load on /subscribe, on first focus
 *   elsewhere (so article pages cost no extra request until someone types).
 * - Confirm / unsubscribe pages read the token from the #fragment, remove it
 *   from the address bar at once, and act only when the button is clicked.
 */
import { ApiError, createApiClient } from '../lib/api-client.ts';

const api = createApiClient();

type FormMessages = Record<'sent' | 'invalid' | 'rateLimited' | 'closed' | 'paused' | 'pausedMonth' | 'sendFailed' | 'unreachable' | 'error' | 'submit' | 'sending', string>;
type LinkMessages = Record<string, string>;

const read = <T>(element: HTMLElement): T => {
  try {
    return JSON.parse(element.dataset.messages ?? '{}') as T;
  } catch {
    return {} as T;
  }
};

const lang = () => document.documentElement.lang || 'en';

/** Map a failed call to a message key. 404 / network: no newsletter backend on this host. */
function failure(error: unknown): keyof FormMessages {
  if (!(error instanceof ApiError)) return 'unreachable';
  if (error.status === 400 && error.details?.field === 'email') return 'invalid';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 503) {
    // Daily / monthly sending limit (NEWSLETTER_DAILY_LIMIT / NEWSLETTER_MONTHLY_LIMIT).
    const reason = error.details?.reason;
    if (reason === 'monthly-limit' || /monthly email limit/.test(error.message)) return 'pausedMonth';
    if (reason === 'daily-limit' || /daily email limit/.test(error.message)) return 'paused';
    return 'closed';
  }
  if (error.status === 502) return 'sendFailed';
  if (error.status === 404 || error.status === 405) return 'unreachable';
  return 'error';
}

function setStatus(target: HTMLElement | null, text: string, state: string) {
  if (!target) return;
  target.textContent = text;
  target.dataset.state = state;
}

function wireForm(form: HTMLFormElement) {
  const t = read<FormMessages>(form);
  const input = form.querySelector<HTMLInputElement>('input[type=email]')!;
  const trap = form.querySelector<HTMLInputElement>('input[name=website]');
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const status = form.querySelector<HTMLElement>('.letters-status');
  let checked: Promise<void> | null = null;

  const close = (key: keyof FormMessages) => {
    setStatus(status, t[key], 'error');
    input.disabled = true;
    button.disabled = true;
    form.dataset.state = 'closed';
  };

  const check = () =>
    (checked ??= api.newsletter.status().then(
      (availability) => { if (!availability.enabled) close('closed'); },
      (error) => close(failure(error)),
    ));

  if (form.dataset.precheck === 'load') void check();
  else form.addEventListener('focusin', () => void check(), { once: true });

  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    if (status?.dataset.state === 'error' && form.dataset.state !== 'closed') setStatus(status, '', '');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.state === 'busy' || form.dataset.state === 'closed') return;
    const email = input.value.trim();
    if (!email || !input.checkValidity()) {
      input.setAttribute('aria-invalid', 'true');
      setStatus(status, t.invalid, 'error');
      input.focus();
      return;
    }
    form.dataset.state = 'busy';
    button.disabled = true;
    button.firstChild!.textContent = t.sending;
    try {
      await api.newsletter.subscribe({ email, locale: lang(), source: form.dataset.source, website: trap?.value ?? '' });
      form.dataset.state = 'sent';
      input.readOnly = true;
      setStatus(status, t.sent, 'ok');
    } catch (error) {
      const key = failure(error);
      form.dataset.state = '';
      button.disabled = false;
      if (key === 'invalid') input.setAttribute('aria-invalid', 'true');
      setStatus(status, t[key], 'error');
      if (key === 'closed' || key === 'unreachable') close(key);
    } finally {
      button.firstChild!.textContent = t.submit;
    }
  });
}

/** `#token=…` (what emails link to), or `?token=…` if a mail client moved it. */
function takeToken(): string {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
  const fromQuery = new URLSearchParams(location.search).get('token');
  const token = fromHash || fromQuery || '';
  if (token) history.replaceState(null, '', location.pathname); // out of the address bar and history
  return token;
}

function wireLink(root: HTMLElement) {
  const action = root.dataset.newsletterLink as 'confirm' | 'unsubscribe';
  const t = read<LinkMessages>(root);
  const button = root.querySelector<HTMLButtonElement>('[data-newsletter-act]')!;
  const status = root.querySelector<HTMLElement>('[data-newsletter-status]');
  const next = root.querySelector<HTMLElement>('[data-newsletter-next]');
  const token = takeToken();

  const finish = (text: string, state: 'ok' | 'error', show: ('again' | 'read')[]) => {
    button.hidden = true;
    setStatus(status, text, state);
    if (next) {
      next.hidden = show.length === 0;
      next.querySelectorAll<HTMLElement>('[data-next]').forEach((link) => (link.hidden = !show.includes(link.dataset.next as 'again' | 'read')));
    }
  };

  if (!token) return finish(t.missing!, 'error', ['again']);
  button.hidden = false;

  button.addEventListener('click', async () => {
    button.disabled = true;
    const label = button.firstChild!.textContent;
    button.firstChild!.textContent = t.working!;
    try {
      if (action === 'confirm') {
        const result = await api.newsletter.confirm(token);
        finish(result.status === 'confirmed' ? t.confirmed! : t.already!, 'ok', ['read']);
      } else {
        await api.newsletter.unsubscribe(token);
        finish(t.done!, 'ok', ['again']);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) return finish(t.expired!, 'error', ['again']);
      if (error instanceof ApiError && error.status === 400) return finish(t.invalid!, 'error', ['again']);
      const key = error instanceof ApiError ? (error.status === 429 ? 'rateLimited' : error.status === 404 ? 'unreachable' : 'error') : 'unreachable';
      setStatus(status, t[key]!, 'error');
      button.disabled = false;
      button.firstChild!.textContent = label;
    }
  });
}

document.querySelectorAll<HTMLFormElement>('[data-newsletter-form]').forEach(wireForm);
document.querySelectorAll<HTMLElement>('[data-newsletter-link]').forEach(wireLink);
