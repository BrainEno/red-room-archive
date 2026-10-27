/**
 * Posts panel — journal posts stored in SQLite (drafts, edit, delete, preview).
 */
import type { PostDetail } from '../../../../shared/contracts.ts';
import type { ApiClient } from '../../lib/api-client.ts';
import { $, busy, dateLabel, esc, fail, toast } from '../dom.ts';

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
    <h2 class="sec admin-sec">Posts</h2>
    <ul class="files" id="pl"></ul>`;

  const form = $<HTMLFormElement>('#pf', root);
  const listEl = $('#pl', root);
  const modeEl = $('#pmode', root);
  const cancel = $<HTMLButtonElement>('#pcancel', root);
  const preview = $('#pv', root);
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
            <button data-action="edit">Edit</button><button data-action="delete">Delete</button></li>`,
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
      setMode();
      await refresh();
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
      } else if (confirm(`Delete /journal/${slug} permanently?`)) {
        await api.posts.remove(slug);
        toast('Deleted');
        if (editing === slug) setMode();
        await refresh();
      }
    } catch (error) {
      fail(error);
    }
  };

  setMode();
  refresh().catch(fail);
}
