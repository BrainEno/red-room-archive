/**
 * Newsletter panel — counts, delivery status, search/filter, CSV export and
 * a "resend confirmation" recovery action for pending addresses.
 * Works on the Node server and, on the static deployment, against the
 * Netlify Function (same /api/newsletter/admin/* endpoints, same token).
 */
import type { NewsletterListResponse, NewsletterStatus, NewsletterSubscriber } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, timeLabel, toast } from '../dom.ts';
import { t } from '../i18n.ts';

const PAGE = 50;
const STATUSES: NewsletterStatus[] = ['active', 'pending', 'unsubscribed'];

export function newsletterPanel(root: HTMLElement, api: ApiClient) {
  const n = t.newsletter;
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  root.innerHTML = `
    <header class="ov-head">
      <h2 class="ov-name">${esc(n.title)}</h2>
      <p class="hint" id="nl-delivery" role="status"></p>
      <dl class="ov-stats" id="nl-counts"></dl>
    </header>
    <form class="row2 nl-filter" id="nl-filter" role="search">
      <label class="sr" for="nl-q">${esc(n.search)}</label>
      <input id="nl-q" type="search" placeholder="${esc(n.searchPlaceholder)}" maxlength="100" autocomplete="off">
      <label class="sr" for="nl-status">${esc(n.status)}</label>
      <select id="nl-status">
        <option value="">${esc(n.all)}</option>
        ${STATUSES.map((status) => `<option value="${status}">${esc(n.statusLabel[status] ?? status)}</option>`).join('')}
      </select>
      <button type="button" id="nl-export">${esc(n.export)}</button>
    </form>
    <div class="table-scroll" id="nl-scroll" tabindex="0" role="region" aria-label="${esc(n.tableLabel)}">
      <table class="grid nl-table">
        <thead><tr>
          <th scope="col">${esc(n.email)}</th><th scope="col">${esc(n.status)}</th><th scope="col">${esc(n.language)}</th>
          <th scope="col">${esc(n.source)}</th><th scope="col">${esc(n.created)}</th><th scope="col">${esc(n.confirmed)}</th>
          <th scope="col">${esc(n.left)}</th><th scope="col"><span class="sr">${esc(n.actions)}</span></th>
        </tr></thead>
        <tbody id="nl-rows"></tbody>
      </table>
    </div>
    <div class="row2 nl-pager">
      <button type="button" class="ghost" id="nl-prev">${esc(n.previous)}</button>
      <span class="hint" id="nl-range"></span>
      <button type="button" class="ghost" id="nl-next">${esc(n.next)}</button>
    </div>`;

  const q = $<HTMLInputElement>('#nl-q', root);
  const status = $<HTMLSelectElement>('#nl-status', root);
  const query = () => ({ q: q.value.trim(), status: status.value as NewsletterStatus | '' });

  const stat = (label: string, value: number) => `<div class="ov-stat"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const when = (value: string | null) => (value ? esc(timeLabel(value)) : '<span class="hint">—</span>');

  const row = (s: NewsletterSubscriber) => `<tr data-id="${s.id}">
      <td class="nl-email">${esc(s.email)}${s.lastError ? ` <span class="badge" title="${esc(s.lastErrorAt ? timeLabel(s.lastErrorAt) : '')}">${esc(n.sendFailed)}</span>` : ''}</td>
      <td><span class="nl-status nl-${esc(s.status)}">${esc(n.statusLabel[s.status] ?? s.status)}</span></td>
      <td>${esc(s.locale)}</td>
      <td>${s.source ? esc(s.source) : '<span class="hint">—</span>'}</td>
      <td>${when(s.createdAt)}</td>
      <td>${when(s.confirmedAt)}</td>
      <td>${when(s.unsubscribedAt)}</td>
      <td>${s.status === 'pending' ? `<button type="button" class="ghost" data-resend="${s.id}">${esc(n.resend)}</button>` : ''}</td>
    </tr>`;

  const render = (data: NewsletterListResponse) => {
    const { counts, delivery } = data;
    $('#nl-counts', root).innerHTML = [stat(n.total, counts.total), stat(n.active, counts.active), stat(n.pending, counts.pending), stat(n.unsubscribed, counts.unsubscribed)].join('');
    const deliveryLine = delivery.configured
      ? n.delivery(delivery.provider ?? '?', delivery.sentToday, delivery.dailyLimit)
      : n.notConfigured(delivery.missing.join(', '));
    const line = $('#nl-delivery', root);
    line.textContent = `${deliveryLine} · ${n.storage[delivery.storage] ?? delivery.storage}`;
    line.classList.toggle('warn', !delivery.configured);
    const filtered = Boolean(query().q || query().status);
    $('#nl-rows', root).innerHTML = data.subscribers.map(row).join('') ||
      `<tr><td colspan="8" class="hint">${esc(filtered ? n.noMatch : n.none)}</td></tr>`;
    const to = offset + data.subscribers.length;
    $('#nl-range', root).textContent = data.total ? n.range(offset + 1, to, data.total) : '';
    $<HTMLButtonElement>('#nl-prev', root).disabled = offset === 0;
    $<HTMLButtonElement>('#nl-next', root).disabled = to >= data.total;
  };

  const refresh = async () => render(await api.newsletter.list({ ...query(), limit: PAGE, offset }));
  const reload = () => {
    offset = 0;
    refresh().catch(fail);
  };

  $('#nl-filter', root).onsubmit = (event) => {
    event.preventDefault();
    reload();
  };
  q.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 250);
  };
  status.onchange = reload;
  $('#nl-prev', root).onclick = () => {
    offset = Math.max(0, offset - PAGE);
    refresh().catch(fail);
  };
  $('#nl-next', root).onclick = () => {
    offset += PAGE;
    refresh().catch(fail);
  };

  $('#nl-export', root).onclick = () =>
    busy(root.querySelector<HTMLElement>('#nl-filter')!, async () => {
      try {
        const { blob, filename } = await api.newsletter.exportCsv(query());
        const href = URL.createObjectURL(blob);
        const link = Object.assign(document.createElement('a'), { href, download: filename });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        toast(n.exported);
      } catch (error) {
        fail(error);
      }
    });

  $('#nl-rows', root).onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-resend]');
    if (!button) return;
    button.disabled = true;
    try {
      await api.newsletter.resend(Number(button.dataset.resend));
      toast(n.resent);
      await refresh();
    } catch (error) {
      fail(error);
      button.disabled = false;
    }
  };

  return { refresh: () => refresh().catch(fail) };
}
