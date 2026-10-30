/**
 * Articles panel — read-only view of what the site publishes, plus sync.
 * Content is edited in Notion; the site never writes back.
 */
import type { ArticleSummary, SyncStatus } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, dateLabel, esc, fail, timeLabel, toast } from '../dom.ts';

const describeStatus = (status: SyncStatus) =>
  [
    status.demo ? 'Notion not configured — showing demo articles' : 'Notion connected',
    `${status.articles} published`,
    status.demo ? '' : `${status.bodiesCached} bodies cached`,
    status.demo ? '' : `last sync ${status.syncedAt ? timeLabel(status.syncedAt) : 'never'}`,
    status.syncing ? 'syncing…' : '',
    status.syncError ? `last error: ${status.syncError}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

export function articlesPanel(root: HTMLElement, api: ApiClient, initial: SyncStatus) {
  root.innerHTML = `
    <p class="hint" id="ast" role="status"></p>
    <div class="row2">
      <button id="sync">Sync now</button>
      <button id="syncb" title="Also fetch every article body (makes search cover the full text)">Sync + fetch bodies</button>
      <button id="full" class="ghost" title="Forget cached bodies and images, then sync">Full resync</button>
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
      <td><button type="button" data-refresh="${esc(article.slug)}" title="Fetch this article's body from Notion again">Refresh</button></td>
    </tr>`;

  const load = async () => {
    const list = $('#alist', root);
    try {
      const { articles, total } = await api.articles.list({ limit: 100 });
      list.innerHTML = articles.length
        ? `<div class="table-scroll" role="region" aria-label="Published articles" tabindex="0"><table class="grid"><thead><tr><th>Title</th><th>Date</th><th>Tags</th><th>Rank</th><th></th></tr></thead><tbody>${articles.map(row).join('')}</tbody></table></div>${
            total > articles.length ? `<p class="hint">Showing the newest ${articles.length} of ${total}.</p>` : ''
          }`
        : '<p class="hint">No published articles. Check the database in Settings → “Check columns”.</p>';
      list.querySelectorAll<HTMLButtonElement>('[data-refresh]').forEach((button) => {
        button.onclick = async () => {
          try {
            await busy(button.closest('td')!, () => api.articles.get(button.dataset.refresh!, true));
            toast('Body refreshed from Notion');
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

  const sync = async (opts: { full?: boolean; bodies?: boolean }) => {
    if (opts.full && !confirm('Drop every cached body and image, then sync from Notion?')) return;
    toast('Syncing…');
    try {
      const result = await busy(root, () => api.sync.run(opts));
      show(result.status);
      toast(`Synced ${result.synced} articles${result.bodies ? `, fetched ${result.bodies} bodies` : ''}`);
      await load();
    } catch (error) {
      fail(error);
      api.sync.status().then(({ status }) => show(status)).catch(() => undefined);
    }
  };
  $('#sync', root).onclick = () => sync({});
  $('#syncb', root).onclick = () => sync({ bodies: true });
  $('#full', root).onclick = () => sync({ full: true });

  void load();
  return { show, reload: load };
}
