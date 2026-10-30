/**
 * Overview panel — the first thing after signing in: where articles come
 * from, what the site publishes, what needs attention, and quick actions.
 * Read-only; numbers come from GET /api/overview and refresh whenever the
 * tab is shown.
 */
import type { OverviewCheck, OverviewResponse, SyncResponse } from '../../../../shared/contracts.ts';
import { localePath } from '../../../../shared/i18n.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, bytes, dateLabel, esc, fail, timeLabel, toast } from '../dom.ts';
import { errorText, say, t, type TabId } from '../i18n.ts';
import type { SyncOptions } from './articles.ts';
import type { SettingsSection } from './settings.ts';

type Fix = { label: string; tab: TabId; section?: SettingsSection; sync?: SyncOptions };

const FIXES: Partial<Record<OverviewCheck['code'], Fix>> = {
  'notion-missing': { label: t.overview.fix.notion, tab: 'Settings', section: 'notion' },
  'sync-error': { label: t.overview.fix.notion, tab: 'Settings', section: 'notion' },
  'never-synced': { label: t.overview.fix.sync, tab: 'Articles', sync: {} },
  'no-articles': { label: t.overview.fix.notion, tab: 'Settings', section: 'notion' },
  'bodies-partial': { label: t.overview.fix.bodies, tab: 'Articles', sync: { bodies: true } },
  'email-missing': { label: t.overview.fix.site, tab: 'Settings', section: 'site' },
  'more-sample': { label: t.overview.fix.more, tab: 'More' },
  'webhook-pending': { label: t.overview.fix.notion, tab: 'Settings', section: 'notion' },
};

export interface OverviewHooks {
  goTo: (tab: TabId, section?: SettingsSection) => void;
  sync: (opts: SyncOptions) => Promise<SyncResponse | null>;
}

export function overviewPanel(root: HTMLElement, api: ApiClient, hooks: OverviewHooks) {
  const o = t.overview;
  let data: OverviewResponse | null = null;

  const stat = (label: string, value: string, note = '') =>
    `<div class="ov-stat"><dt>${esc(label)}</dt><dd>${esc(value)}${note ? `<small>${esc(note)}</small>` : ''}</dd></div>`;

  const check = (item: OverviewCheck, index: number) => {
    const fix = FIXES[item.code];
    const text = say(o.checks[item.code], item.count ?? 0);
    const detail = item.code === 'sync-error' && data?.status.syncError ? `<code class="ov-error">${esc(data.status.syncError)}</code>` : '';
    return `<li class="ov-check ${item.level}">
      <span class="ov-dot" aria-hidden="true"></span>
      <span class="ov-text">${esc(text)}${detail}</span>
      ${fix ? `<button type="button" class="ghost" data-fix="${index}">${esc(fix.label)} →</button>` : ''}
    </li>`;
  };

  const render = (view: OverviewResponse) => {
    data = view;
    const { status, articles } = view;
    const source = [o.source(status.notion, status.demo), status.demo ? '' : o.lastSync(status.syncedAt ? timeLabel(status.syncedAt) : t.common.never), status.syncing ? o.syncing : '']
      .filter(Boolean)
      .join(' · ');
    const most = Math.max(1, ...articles.years.map((year) => year.count));

    root.innerHTML = `
      <header class="ov-head">
        <h2 class="ov-name">${esc(view.site.name)}</h2>
        <p class="hint" id="ov-source">${esc(source)}${view.site.url ? ` · <a href="${esc(view.site.url)}" target="_blank" rel="noopener">${esc(view.site.url.replace(/^https?:\/\//, ''))}</a>` : ''}</p>
        <div class="row2 tight ov-actions" role="group" aria-label="${esc(o.actions)}">
          ${status.demo ? '' : `<button type="button" id="ov-sync" class="primary">${esc(o.sync)}</button>`}
          <a class="me-link" href="/" target="_blank" rel="noopener">${esc(o.viewEn)}</a>
          <a class="me-link" href="${localePath('/', 'zh-CN')}" target="_blank" rel="noopener">${esc(o.viewZh)}</a>
          <span class="me-spacer"></span>
          <button type="button" class="ghost" id="ov-bundle">${esc(o.bundle)}</button>
          <button type="button" class="ghost" id="ov-settings">${esc(o.toSettings)}</button>
        </div>
      </header>

      <h3 class="admin-sec">${esc(o.stats)}</h3>
      <dl class="ov-stats">
        ${stat(o.articles, String(articles.total))}
        ${stat(o.featured, String(articles.featured))}
        ${stat(o.topics, String(articles.topics))}
        ${status.demo ? '' : stat(o.bodies, `${status.bodiesCached}/${articles.total}`)}
        ${stat(o.publications, String(view.more.publications), view.more.custom ? '' : o.sample)}
        ${stat(o.channels, String(view.more.channels))}
        ${stat(o.uploads, String(view.uploads.count), bytes(view.uploads.bytes))}
      </dl>

      <h3 class="admin-sec">${esc(o.attention)} ${view.checks.length ? `<small class="hint">${view.checks.length}</small>` : ''}</h3>
      ${view.checks.length ? `<ul class="ov-checks">${view.checks.map(check).join('')}</ul>` : `<p class="ok">${esc(o.allClear)}</p>`}

      <div class="ov-cols">
        <section aria-labelledby="ov-latest">
          <h3 class="admin-sec" id="ov-latest">${esc(o.latest)}</h3>
          ${
            articles.latest
              ? `<p class="ov-latest"><a href="${esc(articles.latest.href)}" target="_blank" rel="noopener">${esc(articles.latest.title)}</a><small class="hint">${esc(dateLabel(articles.latest.date))}</small></p>`
              : `<p class="hint">${esc(o.noArticles)}</p>`
          }
        </section>
        <section aria-labelledby="ov-years">
          <h3 class="admin-sec" id="ov-years">${esc(o.years)}</h3>
          <ul class="ov-years">${articles.years
            .map(
              (year) =>
                `<li><span>${esc(year.year || o.undated)}</span><span class="ov-bar" data-share="${year.count / most}" aria-hidden="true"></span><span class="ov-count">${year.count}</span></li>`,
            )
            .join('')}</ul>
        </section>
      </div>`;

    // Bar widths through CSSOM (inline style attributes are blocked by the CSP).
    root.querySelectorAll<HTMLElement>('.ov-bar').forEach((bar) => bar.style.setProperty('--share', bar.dataset.share ?? '0'));

    root.querySelector<HTMLButtonElement>('#ov-sync')?.addEventListener('click', () => void runSync({}));
    $('#ov-settings', root).onclick = () => hooks.goTo('Settings');
    $('#ov-bundle', root).onclick = async () => {
      try {
        const { blob, filename } = await busy(root, () => api.settings.contentBundle());
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast(t.settings.bundleDone);
      } catch (error) {
        fail(error);
      }
    };
    root.querySelectorAll<HTMLButtonElement>('[data-fix]').forEach((button) => {
      button.onclick = () => {
        const item = view.checks[Number(button.dataset.fix)];
        const fix = item && FIXES[item.code];
        if (!fix) return;
        if (fix.sync) void runSync(fix.sync);
        else hooks.goTo(fix.tab, fix.section);
      };
    });
  };

  const runSync = async (opts: SyncOptions) => {
    const result = await busy(root, () => hooks.sync(opts));
    if (result) await refresh();
  };

  let pending: Promise<void> | null = null;
  const refresh = () =>
    (pending ??= api
      .overview()
      .then(render)
      .catch((error) => {
        if (!data) root.innerHTML = `<p class="warn" role="alert">${esc(errorText(error))}</p>`;
        else fail(error);
      })
      .finally(() => (pending = null)));

  root.innerHTML = `<p class="hint">${esc(t.common.loading)}</p>`;
  void refresh();
  return { refresh };
}
