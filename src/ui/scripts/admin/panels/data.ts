/**
 * Data panel — everything that keeps the archive safe and portable:
 * database backups, Markdown export / import, and the trash of deleted posts.
 */
import type { ImportConflict, ImportReport } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, bytes, esc, fail, pickFile, saveDownload, timeLabel, toast } from '../dom.ts';

const reportHtml = (report: ImportReport) => {
  const group = (label: string, rows: { file: string; slug?: string; error?: string }[]) =>
    rows.length
      ? `<p><b>${label} (${rows.length})</b></p><ul class="report">${rows
          .map((row) => `<li>${esc(row.file)}${row.slug ? ` → <code>${esc(row.slug)}</code>` : ''}${row.error ? ` — ${esc(row.error)}` : ''}</li>`)
          .join('')}</ul>`
      : '';
  return `
    <p class="hint">${report.dryRun ? 'Preview only — nothing was written.' : 'Import finished.'} Conflicts: ${esc(report.onConflict)}</p>
    ${group(report.dryRun ? 'Would create' : 'Created', report.created)}
    ${group(report.dryRun ? 'Would overwrite' : 'Overwritten (old text kept in history)', report.updated)}
    ${group('Skipped', report.skipped)}
    ${group('Errors', report.errors)}
    ${report.settings.length ? `<p><b>Site settings ${report.dryRun ? 'to apply' : 'applied'}:</b> ${esc(report.settings.join(', '))}</p>` : ''}`;
};

export function dataPanel(root: HTMLElement, api: ApiClient) {
  root.innerHTML = `
    <h2 class="admin-sec">Backups</h2>
    <p class="hint" id="bs"></p>
    <div class="row2"><button id="bn">Back up now</button></div>
    <ul class="files" id="bl"></ul>

    <h2 class="admin-sec">Export</h2>
    <p class="hint">A ZIP with every journal post as Markdown (drafts included), site settings without secrets, and a
      snapshot of the Notion entries. Readable without this site; re-importable below. Uploaded media are not included.</p>
    <div class="row2"><button id="ex">Download export (.zip)</button></div>

    <h2 class="admin-sec">Import</h2>
    <p class="hint">A ZIP from Export, any ZIP of Markdown files (Hugo, Jekyll, Obsidian…), or one <code>.md</code> file.
      Front matter <code>title / slug / date / tags / draft|published / excerpt</code> is understood.</p>
    <form class="form" id="im">
      <div class="row2 tight">
        <label>When a slug already exists
          <select name="onConflict">
            <option value="skip">Skip that file</option>
            <option value="overwrite">Overwrite (old text kept in history)</option>
            <option value="rename">Import as a copy (slug-2)</option>
          </select>
        </label>
      </div>
      <label class="check"><input type="checkbox" name="settings"> Also apply site settings from <code>site.json</code><small>never the Notion token</small></label>
      <div class="row2 tight">
        <button type="button" data-run="preview">Choose file &amp; preview…</button>
        <button type="button" data-run="import" disabled>Import</button>
        <span class="hint" id="if"></span>
      </div>
    </form>
    <section class="preview" id="ir" hidden aria-live="polite"></section>

    <h2 class="admin-sec">Trash</h2>
    <p class="hint">Deleted journal posts. Restoring brings the post back under the same address.</p>
    <ul class="files" id="tl"></ul>`;

  const backupList = $('#bl', root);
  const trashList = $('#tl', root);
  const importForm = $<HTMLFormElement>('#im', root);
  const importButton = $<HTMLButtonElement>('[data-run=import]', root);
  const reportEl = $('#ir', root);
  let chosen: File | null = null;

  const refreshBackups = async () => {
    const { backups, schedule } = await api.backups.list();
    $('#bs', root).innerHTML =
      (schedule.intervalHours > 0
        ? `Automatic snapshot every ${schedule.intervalHours} h, newest ${schedule.keep} kept · next ${esc(timeLabel(schedule.nextBackupAt))}`
        : 'Automatic backups are off (<code>BACKUP_INTERVAL_HOURS=0</code>)') +
      ` · stored in <code>${esc(schedule.dir)}</code>. A backup is the full database, including the Notion token — keep downloads private.`;
    backupList.innerHTML =
      backups
        .map(
          (backup) => `<li data-name="${esc(backup.name)}">
            <span>${esc(backup.name)}${backup.auto ? ' <span class="badge">auto</span>' : ''}</span>
            <span class="hint">${bytes(backup.size)} · ${esc(timeLabel(backup.createdAt))}</span>
            <button data-action="download">Download</button><button data-action="delete">Delete</button></li>`,
        )
        .join('') || '<li class="hint">No backups yet</li>';
  };

  const refreshTrash = async () => {
    const { posts } = await api.trash.list();
    trashList.innerHTML =
      posts
        .map(
          (post) => `<li data-slug="${esc(post.slug)}" data-id="${post.revisionId}">
            <span>${esc(post.title)} <span class="hint">/journal/${esc(post.slug)} · ${post.revisions} versions</span></span>
            <span class="hint">deleted ${esc(timeLabel(post.deletedAt))}</span>
            <button data-action="restore">Restore</button><button data-action="purge">Delete forever</button></li>`,
        )
        .join('') || '<li class="hint">Trash is empty</li>';
  };

  $('#bn', root).onclick = async (event) => {
    try {
      const made = await busy(event.currentTarget as HTMLElement, () => api.backups.create());
      toast(`Backup written: ${made.name}`);
      await refreshBackups();
    } catch (error) {
      fail(error);
    }
  };

  backupList.onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const name = button?.closest<HTMLElement>('li[data-name]')?.dataset.name;
    if (!button || !name) return;
    try {
      if (button.dataset.action === 'download') saveDownload(await api.backups.download(name));
      else if (confirm(`Delete backup ${name}?`)) {
        await api.backups.remove(name);
        toast('Backup deleted');
        await refreshBackups();
      }
    } catch (error) {
      fail(error);
    }
  };

  $('#ex', root).onclick = async (event) => {
    try {
      saveDownload(await busy(event.currentTarget as HTMLElement, () => api.data.export()));
    } catch (error) {
      fail(error);
    }
  };

  const options = () => {
    const form = new FormData(importForm);
    return { onConflict: String(form.get('onConflict') ?? 'skip') as ImportConflict, settings: form.get('settings') === 'on' };
  };

  const run = async (dryRun: boolean) => {
    if (!chosen) return;
    const report = await busy(importForm, () => api.data.import(chosen!, { ...options(), dryRun }));
    reportEl.hidden = false;
    reportEl.innerHTML = reportHtml(report);
    importButton.disabled = dryRun ? report.created.length + report.updated.length + report.settings.length === 0 : true;
    if (!dryRun) {
      toast(`Imported ${report.created.length + report.updated.length} posts`);
      root.dispatchEvent(new CustomEvent('posts:changed', { bubbles: true }));
      chosen = null;
      $('#if', root).textContent = '';
      await refreshTrash();
    }
  };

  $('[data-run=preview]', root).onclick = async () => {
    const file = await pickFile('.zip,.md,.markdown,.mdx,application/zip,text/markdown');
    if (!file) return;
    chosen = file;
    $('#if', root).textContent = `${file.name} · ${bytes(file.size)}`;
    await run(true).catch(fail);
  };
  importButton.onclick = () => run(false).catch(fail);
  // Changing the options invalidates the preview.
  importForm.onchange = () => {
    if (chosen) run(true).catch(fail);
  };

  trashList.onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const row = button?.closest<HTMLElement>('li[data-slug]');
    if (!button || !row) return;
    const slug = row.dataset.slug!;
    try {
      if (button.dataset.action === 'restore') {
        const post = await api.posts.restore(slug, Number(row.dataset.id));
        toast(`Restored → ${post.href}`);
        await refreshTrash();
        root.dispatchEvent(new CustomEvent('posts:changed', { bubbles: true }));
      } else if (confirm(`Delete /journal/${slug} and all of its history forever? This cannot be undone.`)) {
        await api.trash.purge(slug);
        toast('Deleted forever');
        await refreshTrash();
      }
    } catch (error) {
      fail(error);
    }
  };

  // Posts deleted in the Posts tab show up here without a reload.
  document.addEventListener('posts:changed', (event) => {
    if (event.target !== root) refreshTrash().catch(fail);
  });

  refreshBackups().catch(fail);
  refreshTrash().catch(fail);
}
