/**
 * Articles panel — read-only view of what the site publishes, plus sync.
 * Content is edited in Notion; the site never writes back.
 */
import type { ArticleSummary, SyncResponse, SyncStatus } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, dateLabel, esc, fail, timeLabel, toast } from '../dom.ts';
import { t } from '../i18n.ts';

export const describeStatus = (status: SyncStatus) =>
  [
    status.demo ? t.articles.demo : t.articles.configured,
    t.articles.published(status.articles),
    status.demo ? '' : t.articles.bodies(status.bodiesCached),
    status.demo ? '' : t.articles.lastSync(status.syncedAt ? timeLabel(status.syncedAt) : t.common.never),
    status.syncing ? t.articles.syncing : '',
    status.syncError ? t.articles.lastError(status.syncError) : '',
  ]
    .filter(Boolean)
    .join(' · ');

export type SyncOptions = { full?: boolean; bodies?: boolean };

export function articlesPanel(root: HTMLElement, api: ApiClient, initial: SyncStatus) {
  const a = t.articles;
  root.innerHTML = `
    <p class="hint" id="ast" role="status"></p>
    <div class="row2">
      <button id="sync">${esc(a.sync)}</button>
      <button id="syncb" title="${esc(a.syncBodiesTitle)}">${esc(a.syncBodies)}</button>
      <button id="full" class="ghost" title="${esc(a.fullTitle)}">${esc(a.full)}</button>
    </div>
    <div id="alist"></div>`;

  const show = (status: SyncStatus) => {
    $('#ast', root).textContent = describeStatus(status);
    for (const id of ['#sync', '#syncb', '#full']) $<HTMLButtonElement>(id, root).hidden = status.demo;
  };
  show(initial);

  const row = (article: ArticleSummary) => `
    <tr>
      <td><a href="${esc(article.href)}" target="_blank" rel="noopener">${esc(article.title)}</a><br><small class="hint">${esc(article.slug)}</small></td>
      <td>${esc(dateLabel(article.date))}</td>
      <td>${esc(article.tags.join(', '))}</td>
      <td class="num">${article.rank || ''}</td>
      <td><button type="button" data-refresh="${esc(article.slug)}" title="${esc(a.refreshTitle)}">${esc(a.refresh)}</button></td>
    </tr>`;

  const load = async () => {
    const list = $('#alist', root);
    try {
      const { articles, total } = await api.articles.list({ limit: 100 });
      list.innerHTML = articles.length
        ? `<div class="table-scroll" role="region" aria-label="${esc(a.region)}" tabindex="0"><table class="grid"><thead><tr><th>${esc(a.cols.title)}</th><th>${esc(a.cols.date)}</th><th>${esc(a.cols.tags)}</th><th>${esc(a.cols.rank)}</th><th></th></tr></thead><tbody>${articles.map(row).join('')}</tbody></table></div>${
            total > articles.length ? `<p class="hint">${esc(a.showing(articles.length, total))}</p>` : ''
          }`
        : `<p class="hint">${esc(a.empty)}</p>`;
      list.querySelectorAll<HTMLButtonElement>('[data-refresh]').forEach((button) => {
        button.onclick = async () => {
          try {
            await busy(button.closest('td')!, () => api.articles.get(button.dataset.refresh!, true));
            toast(a.refreshed);
          } catch (error) {
            fail(error);
          }
        };
      });
    } catch (error) {
      list.innerHTML = '';
      fail(error);
    }
  };

  /** Run a sync (also used by the Overview's quick actions). Resolves with the result, or null if cancelled / failed. */
  const sync = async (opts: SyncOptions): Promise<SyncResponse | null> => {
    if (opts.full && !confirm(a.confirmFull)) return null;
    toast(a.syncingToast);
    try {
      const result = await busy(root, () => api.sync.run(opts));
      show(result.status);
      toast(a.synced(result.synced, result.bodies));
      await load();
      return result;
    } catch (error) {
      fail(error);
      api.sync.status().then(({ status }) => show(status)).catch(() => undefined);
      return null;
    }
  };
  $('#sync', root).onclick = () => void sync({});
  $('#syncb', root).onclick = () => void sync({ bodies: true });
  $('#full', root).onclick = () => void sync({ full: true });

  void load();
  return { show, reload: load, sync };
}
