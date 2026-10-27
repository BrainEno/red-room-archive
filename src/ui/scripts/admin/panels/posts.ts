/**
 * Posts panel — journal posts stored in SQLite (drafts, edit, delete, preview)
 * plus per-post history: compare any saved version with the current text and
 * restore it (restoring is itself saved, so it can be undone).
 */
import { diffLines, diffStats } from '../../../../core/diff.ts';
import type { PostDetail, RevisionReason } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, dateLabel, esc, fail, timeLabel, toast } from '../dom.ts';

const REASONS: Record<RevisionReason, string> = {
  edit: 'before edit',
  delete: 'before delete',
  restore: 'before restore',
  import: 'before import',
};

/** Diff as HTML; long unchanged runs collapse to a marker. */
export function renderDiff(before: string, after: string): string {
  const lines = diffLines(before, after);
  const { added, removed } = diffStats(lines);
  if (!added && !removed) return '<p class="hint">Identical to the current text.</p>';
  const out: string[] = [];
  const CONTEXT = 2;
  lines.forEach((line, index) => {
    const near = lines.slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1).some((other) => other.op !== 'same');
    if (line.op === 'same' && !near) {
      if (out.at(-1) !== '<span class="gap">⋯</span>') out.push('<span class="gap">⋯</span>');
      return;
    }
    const mark = line.op === 'add' ? '+' : line.op === 'del' ? '−' : ' ';
    out.push(`<span class="${line.op}">${mark} ${esc(line.text) || '&nbsp;'}</span>`);
  });
  return `<p class="hint">Changes from this version to the current text: <b class="add">+${added}</b> <b class="del">−${removed}</b> lines</p><pre class="diff">${out.join('')}</pre>`;
}

export function postsPanel(root: HTMLElement, api: ApiClient) {
  root.innerHTML = `
    <form class="form" id="pf">
      <label>Title<input name="title" required></label>
      <label>Slug<small>optional · used in /journal/&lt;slug&gt;</small><input name="slug"></label>
      <label>Tags<small>comma separated</small><input name="tags"></label>
      <label>Excerpt<small>optional · shown in lists and feeds when set</small><input name="excerpt"></label>
      <label class="check"><input type="checkbox" name="published" checked> Published<small>uncheck to keep as draft</small></label>
      <label>Body<small>Markdown · single line breaks are kept</small><textarea name="body" rows="14" required></textarea></label>
      <div class="row2 tight">
        <button>Publish</button>
        <button type="button" id="ppreview">Preview</button>
        <button type="button" id="pcancel" hidden>Cancel edit</button>
        <span class="hint" id="pmode">New post</span>
      </div>
    </form>
    <section class="preview prose" id="pv" hidden aria-label="Preview"></section>
    <section class="history" id="ph" hidden aria-label="History"></section>
    <h2 class="sec admin-sec">Posts</h2>
    <ul class="files" id="pl"></ul>`;

  const form = $<HTMLFormElement>('#pf', root);
  const listEl = $('#pl', root);
  const modeEl = $('#pmode', root);
  const cancel = $<HTMLButtonElement>('#pcancel', root);
  const preview = $('#pv', root);
  const history = $('#ph', root);
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  let editing = '';

  const setMode = (post: PostDetail | null = null) => {
    editing = post?.slug ?? '';
    modeEl.textContent = post ? `Editing /journal/${post.slug}` : 'New post';
    cancel.hidden = !post;
    preview.hidden = true;
    form.reset();
    input('title').value = post?.title ?? '';
    input('slug').value = post?.slug ?? '';
    input('tags').value = (post?.tags ?? []).join(', ');
    input('excerpt').value = post?.excerpt ?? '';
    input('published').checked = post ? post.published : true;
    (form.elements.namedItem('body') as HTMLTextAreaElement).value = post?.markdown ?? '';
  };

  const refresh = async () => {
    const { posts } = await api.posts.list({ drafts: true, limit: 200 });
    listEl.innerHTML =
      posts
        .map(
          (post) => `<li data-slug="${esc(post.slug)}">
            <span>${esc(post.title)}${post.published ? '' : ' <span class="badge">draft</span>'}</span>
            <span class="hint">${esc(dateLabel(post.created))}</span>
            <a href="${esc(post.href)}" target="_blank" rel="noopener">View</a>
            <button data-action="edit">Edit</button><button data-action="history">History</button><button data-action="delete">Delete</button></li>`,
        )
        .join('') || '<li class="hint">No posts yet</li>';
  };

  const payload = () => {
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    return {
      title: data.title ?? '',
      slug: data.slug ?? '',
      tags: String(data.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      excerpt: data.excerpt ?? '',
      body: data.body ?? '',
      published: data.published === 'on',
    };
  };

  cancel.onclick = () => setMode();

  /* ── History ── */

  let historyFor = '';

  const showHistory = async (slug: string) => {
    const [{ revisions }, current] = await Promise.all([api.posts.revisions(slug), api.posts.get(slug)]);
    historyFor = slug;
    history.hidden = false;
    history.innerHTML = `
      <div class="row2 tight"><h2 class="admin-sec">History · /journal/${esc(slug)}</h2>
        <button type="button" class="ghost" data-action="close">Close</button></div>
      <p class="hint">Each entry is the post as it was <em>before</em> a save. Restoring keeps the current text as a new entry.</p>
      <ul class="files">${
        revisions
          .map(
            (rev) => `<li data-id="${rev.id}">
              <span>${esc(rev.title)}${rev.published ? '' : ' <span class="badge">draft</span>'}
                <span class="hint">· ${esc(REASONS[rev.reason] ?? rev.reason)} · ${rev.size} chars</span></span>
              <span class="hint">${esc(timeLabel(rev.savedAt))}</span>
              <button data-action="compare">Compare</button><button data-action="restore">Restore</button></li>`,
          )
          .join('') || '<li class="hint">No earlier versions yet — history starts with the next save.</li>'
      }</ul>
      <div id="pd"></div>`;
    history.dataset.current = current.markdown;
    history.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  history.onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'close') {
      history.hidden = true;
      historyFor = '';
      return;
    }
    const id = Number(button.closest<HTMLElement>('li[data-id]')?.dataset.id);
    if (!id || !historyFor) return;
    try {
      if (button.dataset.action === 'compare') {
        const revision = await api.posts.revision(historyFor, id);
        const meta = `<p class="hint">Title then: “${esc(revision.title)}” · tags: ${esc(revision.tags.join(', ') || '—')}</p>`;
        $('#pd', history).innerHTML = meta + renderDiff(revision.markdown, history.dataset.current ?? '');
      } else if (button.dataset.action === 'restore' && confirm('Restore this version? The current text will be kept in history.')) {
        const restored = await api.posts.restore(historyFor, id);
        toast(`Restored → ${restored.href}`);
        if (editing === historyFor) setMode(restored);
        await Promise.all([refresh(), showHistory(historyFor)]);
      }
    } catch (error) {
      fail(error);
    }
  };

  $('#ppreview', root).onclick = async () => {
    const { body, title } = payload();
    try {
      // Rendered server-side by the same pipeline as the public journal page.
      const { html } = await api.posts.preview(body);
      preview.hidden = false;
      preview.innerHTML = `<p class="hint">Preview</p><h1>${esc(title || 'Untitled')}</h1>${html}`;
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      fail(error);
    }
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const saved = await busy(form, () =>
        editing ? api.posts.update(editing, payload()) : api.posts.create(payload()),
      );
      toast(editing ? 'Saved' : `${saved.published ? 'Published' : 'Draft saved'} → ${saved.href}`);
      const wasHistory = historyFor && historyFor === editing ? saved.slug : '';
      setMode();
      await refresh();
      if (wasHistory) await showHistory(wasHistory);
    } catch (error) {
      fail(error);
    }
  };

  listEl.onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const row = button?.closest<HTMLElement>('li[data-slug]');
    if (!button || !row) return;
    const slug = row.dataset.slug!;
    try {
      if (button.dataset.action === 'edit') {
        setMode(await api.posts.get(slug));
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (button.dataset.action === 'history') {
        await showHistory(slug);
      } else if (confirm(`Delete /journal/${slug}? It can be restored from Data → Trash.`)) {
        await api.posts.remove(slug);
        toast('Deleted — restorable from Data → Trash');
        root.dispatchEvent(new CustomEvent('posts:changed', { bubbles: true }));
        if (editing === slug) setMode();
        if (historyFor === slug) {
          history.hidden = true;
          historyFor = '';
        }
        await refresh();
      }
    } catch (error) {
      fail(error);
    }
  };

  // Restores and imports in the Data tab change this list too.
  document.addEventListener('posts:changed', (event) => {
    if (event.target !== root) refresh().catch(fail);
  });

  setMode();
  refresh().catch(fail);
}
