/** Owner-only first-party pageview report. No visitor-level rows exist to show. */
import type { AnalyticsDayCount, AnalyticsSummaryResponse } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, esc, fail, toast } from '../dom.ts';
import { t } from '../i18n.ts';

export function analyticsPanel(root: HTMLElement, api: ApiClient) {
  const a = t.analytics;
  let days = 30;

  root.innerHTML = `
    <header class="ov-head">
      <h2 class="ov-name">${esc(a.title)}</h2>
      <p class="hint an-intro">${esc(a.intro)}</p>
      <p class="hint" id="an-storage"></p>
      <label class="check an-enabled"><input type="checkbox" id="an-enabled"> <span>${esc(a.enabled)}</span></label>
      <p class="warn" id="an-disabled" hidden>${esc(a.disabled)}</p>
    </header>
    <div class="row2 an-actions">
      <label class="an-range" for="an-range"><span>${esc(a.range)}</span><select id="an-range">${[7, 30, 90].map((value) => `<option value="${value}" ${value === days ? 'selected' : ''}>${esc(a.days(value))}</option>`).join('')}</select></label>
      <span class="me-spacer"></span>
      <button type="button" class="ghost" id="an-export">${esc(a.export)}</button>
      <button type="button" class="ghost" id="an-clear">${esc(a.clear)}</button>
    </div>
    <dl class="ov-stats" id="an-stats"></dl>
    <div class="an-grid">
      <section aria-labelledby="an-daily-h">
        <h3 class="admin-sec" id="an-daily-h">${esc(a.daily)}</h3>
        <div class="table-scroll an-daily-scroll" tabindex="0" role="region" aria-label="${esc(a.dailyTable)}">
          <table class="grid"><thead><tr><th scope="col">${esc(a.date)}</th><th scope="col" class="num">${esc(a.views)}</th></tr></thead><tbody id="an-daily"></tbody></table>
        </div>
      </section>
      <section aria-labelledby="an-pages-h">
        <h3 class="admin-sec" id="an-pages-h">${esc(a.pages)}</h3>
        <div class="table-scroll" tabindex="0" role="region" aria-label="${esc(a.pagesTable)}">
          <table class="grid"><thead><tr><th scope="col">${esc(a.path)}</th><th scope="col" class="num">${esc(a.views)}</th></tr></thead><tbody id="an-pages"></tbody></table>
        </div>
      </section>
      <section aria-labelledby="an-referrers-h">
        <h3 class="admin-sec" id="an-referrers-h">${esc(a.referrers)}</h3>
        <div class="table-scroll" tabindex="0" role="region" aria-label="${esc(a.referrersTable)}">
          <table class="grid"><thead><tr><th scope="col">${esc(a.source)}</th><th scope="col" class="num">${esc(a.views)}</th></tr></thead><tbody id="an-referrers"></tbody></table>
        </div>
      </section>
      <section aria-labelledby="an-locales-h">
        <h3 class="admin-sec" id="an-locales-h">${esc(a.locales)}</h3>
        <dl class="ov-stats" id="an-locales"></dl>
      </section>
    </div>`;

  const stat = (label: string, value: string | number) => `<div class="ov-stat"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  const emptyRow = `<tr><td colspan="2" class="hint">${esc(a.empty)}</td></tr>`;
  const source = (key: string) => key === '(direct)' ? a.direct : key === '(internal)' ? a.internal : key === '(other)' ? a.other : key;
  const rows = (items: AnalyticsDayCount[], kind: 'path' | 'source') => items.map((item) => {
    const label = kind === 'source' ? source(item.key) : item.key;
    const name = kind === 'path' && item.key.startsWith('/') ? `<a href="${esc(item.key)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
    return `<tr><td class="an-key">${name}</td><td class="num">${item.views}</td></tr>`;
  }).join('') || emptyRow;

  const render = (view: AnalyticsSummaryResponse) => {
    $('#an-storage', root).textContent = `${a.storage[view.storage] ?? view.storage} · ${a.retention(view.retentionDays)}`;
    $<HTMLInputElement>('#an-enabled', root).checked = view.enabled;
    $('#an-disabled', root).hidden = view.enabled;
    $('#an-stats', root).innerHTML = [
      stat(a.total, view.totals.pageviews), stat(a.today, view.totals.today), stat(a.average, (view.totals.pageviews / view.range.days).toFixed(1)),
    ].join('');
    $('#an-daily', root).innerHTML = view.daily.map((day) => `<tr><td>${esc(day.date)}</td><td class="num">${day.views}</td></tr>`).join('');
    $('#an-pages', root).innerHTML = rows(view.pages, 'path');
    $('#an-referrers', root).innerHTML = rows(view.referrers, 'source');
    $('#an-locales', root).innerHTML = view.locales.map((item) => stat(item.key === 'zh-CN' ? t.common.chinese : t.common.english, item.views)).join('') || `<p class="hint">${esc(a.empty)}</p>`;
  };

  let revision = 0;
  const refresh = () => {
    const current = ++revision;
    return api.analytics.summary(days).then((view) => {
      // A slow older range must not overwrite the owner's latest choice.
      if (current === revision) render(view);
    }).catch((error) => {
      // Keep the controls mounted so a temporary failure can be retried.
      if (current === revision) fail(error);
    });
  };

  $<HTMLSelectElement>('#an-range', root).onchange = (event) => {
    days = Number((event.currentTarget as HTMLSelectElement).value);
    void refresh();
  };
  $<HTMLInputElement>('#an-enabled', root).onchange = async (event) => {
    const checkbox = event.currentTarget as HTMLInputElement;
    const enabled = checkbox.checked;
    try {
      await busy(root, () => api.analytics.update(enabled));
      await refresh();
    } catch (error) {
      checkbox.checked = !enabled;
      fail(error);
    }
  };
  $('#an-export', root).onclick = () => busy(root, async () => {
    try {
      const { blob, filename } = await api.analytics.exportCsv(days);
      const href = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href, download: filename });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast(a.exported);
    } catch (error) { fail(error); }
  });
  $('#an-clear', root).onclick = () => {
    if (!confirm(a.confirmClear)) return;
    void busy(root, async () => {
      try { await api.analytics.clear(); toast(a.cleared); await refresh(); }
      catch (error) { fail(error); }
    });
  };

  return { refresh };
}
