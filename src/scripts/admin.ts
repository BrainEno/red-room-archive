const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const app = $('#app');
let tok = sessionStorage.getItem('tok') ?? '';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const toast = (m: string, bad = false) => { const t = $('#toast'); t.textContent = m; t.className = 'toast on' + (bad ? ' bad' : ''); setTimeout(() => (t.className = 'toast'), 3200); };
const authHeaders = () => ({ Authorization: `Bearer ${tok}` });

async function api(p: string, init: RequestInit = {}) {
  const r = await fetch(p, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...authHeaders(), ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const upload = async (file: File, as = '') => {
  // 大文件走原始字节流（服务端边收边写盘，不占内存）；小文件仍用 multipart
  if (file.size > 8 * 1048576) {
    const q = new URLSearchParams({ name: file.name }); if (as) q.set('as', as);
    return (await api(`/api/upload?${q}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })) as { url: string; name: string };
  }
  const fd = new FormData(); fd.append('file', file); if (as) fd.append('as', as);
  return (await api('/api/upload', { method: 'POST', body: fd })) as { url: string; name: string };
};
const pick = () => new Promise<File | null>((ok) => { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => ok(i.files?.[0] ?? null); i.click(); });
const fail = (e: any) => toast(e.message, true);
const bytes = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;

function login(message = '') {
  app.innerHTML = `<form class="card" id="lg"><h1>Admin</h1>${message ? `<p class="hint">${esc(message)}</p>` : ''}<input id="tk" type="password" placeholder="ADMIN_TOKEN" autofocus><button>Enter</button></form>`;
  $('#lg').onsubmit = async (e) => {
    e.preventDefault();
    tok = $<HTMLInputElement>('#tk').value.trim();
    sessionStorage.setItem('tok', tok);
    try { await api('/api/auth', { method: 'POST', body: JSON.stringify({ token: tok }) }); boot(); }
    catch (err: any) { sessionStorage.removeItem('tok'); login(err.message); }
  };
}
async function boot() { try { render(await api('/api/settings')); } catch (e: any) { if (tok) fail(e); login(); } }

function render(s: any) {
  const T = ['Entries', 'Posts', 'Files', 'Settings'];
  app.innerHTML = `<nav class="tabs">${T.map((t, i) => `<button data-t="${t}" class="${i ? '' : 'on'}">${t}</button>`).join('')}<a href="/">← Site</a></nav>${T.map((t, i) => `<section data-p="${t}" ${i ? 'hidden' : ''}></section>`).join('')}`;
  app.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => (b.onclick = () => {
    app.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    app.querySelectorAll<HTMLElement>('[data-p]').forEach((p) => (p.hidden = p.dataset.p !== b.dataset.t));
  }));
  entries($('[data-p=Entries]')); posts($('[data-p=Posts]')); files($('[data-p=Files]')); settings($('[data-p=Settings]'), s);
}

// ── Entries：表单由 Notion 数据库的列定义动态生成，所以和你自己的表结构一致
const KINDS = [['writing', 'Works (writing)'], ['music', 'Music'], ['films', 'Video (films)']];
const OK = ['title', 'rich_text', 'select', 'status', 'multi_select', 'number', 'checkbox', 'url', 'date'];
const fieldValue = (p: any, item?: any) => {
  if (!item) return '';
  const v = p.type === 'title' ? item.title : item.data?.[p.name.toLowerCase()];
  if (v == null) return '';
  if (p.type === 'checkbox') return v ? 'checked' : '';
  if (Array.isArray(v)) return esc(v.join(', '));
  if (p.type === 'date') return esc(String(v).slice(0, 10));
  return esc(String(v));
};
const field = (p: any, i: number, item?: any) => {
  if (!OK.includes(p.type)) return '';
  const n = esc(p.name), has = p.options?.length, v = fieldValue(p, item);
  const inp = p.type === 'rich_text' ? `<textarea name="${n}" rows="2">${v}</textarea>` : p.type === 'checkbox' ? `<input type="checkbox" name="${n}" ${v}>`
    : `<input name="${n}" type="${({ number: 'number', date: 'date' } as any)[p.type] ?? 'text'}" step="any" value="${p.type === 'checkbox' ? '' : v}" ${has ? `list="dl${i}"` : ''} ${p.type === 'title' ? 'required' : ''}>`;
  return `<label>${n}<small>${p.type}</small>${inp}${p.type === 'url' ? `<button type="button" class="up" data-for="${n}">Upload file → fill URL</button>` : ''}${has ? `<datalist id="dl${i}">${p.options.map((o: string) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}</label>`;
};

function entries(el: HTMLElement) {
  el.innerHTML = `<div class="row2"><select id="kind">${KINDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select><span class="hint" id="emode">New entry · fields follow your Notion database columns.</span><button id="cancel" hidden>Cancel edit</button></div>
    <form class="form" id="ef"></form>
    <h2 class="sec" style="margin-top:36px">Existing</h2><ul class="files" id="elist"></ul>`;
  const form = $<HTMLFormElement>('#ef', el), sel = $<HTMLSelectElement>('#kind', el);
  const listEl = $('#elist', el), modeEl = $('#emode', el), cancel = $<HTMLButtonElement>('#cancel', el);
  let props: any[] = [], editing: any = null;

  const loadList = async () => {
    listEl.innerHTML = '<li class="hint">Loading…</li>';
    try {
      const r: any = await api(`/api/items/${sel.value}?limit=100`);
      listEl.innerHTML = r.items.map((i: any) => `<li data-id="${esc(i.id)}" data-slug="${esc(i.slug)}"><span>${esc(i.title)}</span><span class="hint">${esc(i.year ?? '')}</span><a href="${i.kind === 'writing' ? `/writing/${encodeURIComponent(i.slug)}` : '/#music'}" target="_blank" rel="noopener">View</a><button data-e="1">Edit</button><button data-d="1">Delete</button></li>`).join('') || '<li class="hint">Nothing cached yet — sync from Settings, or create the first entry above.</li>';
    } catch (e: any) { listEl.innerHTML = `<li class="hint">${esc(e.message)}</li>`; }
  };

  const setMode = (item: any = null) => {
    editing = item;
    modeEl.textContent = item ? `Editing “${item.title}” — leave Body empty to keep the current page content.` : 'New entry · fields follow your Notion database columns.';
    cancel.hidden = !item;
    form.innerHTML = props.map((p, i) => field(p, i, item ? (item.data ? { ...item, data: item.data } : item) : undefined)).join('')
      + `<label>Body<small>Markdown: # heading, &gt; quote, - list, \`\`\` code</small><textarea name="__body" rows="10" ${item ? 'placeholder="Leave empty to keep the current page content"' : ''}></textarea></label>`
      + `<div><button>${item ? 'Save changes' : 'Create in Notion'}</button></div>`;
  };

  const load = async () => {
    form.innerHTML = '<p class="hint">Loading…</p>';
    try {
      props = await api(`/api/notion/${sel.value}`);
      setMode();
    } catch (e: any) { form.innerHTML = `<p class="hint">${esc(e.message)}<br>Set the Notion token and database IDs in Settings.</p>`; }
    loadList();
  };
  sel.onchange = load;
  cancel.onclick = () => setMode();
  load();

  form.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.up'); if (!b) return;
    const f = await pick(); if (!f) return;
    try { const u = await upload(f); (form.elements.namedItem(b.dataset.for!) as HTMLInputElement).value = location.origin + u.url; toast('Uploaded'); } catch (e) { fail(e); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form), body: Record<string, any> = {};
    const text = String(fd.get('__body') ?? '');
    if (text.trim() || !editing) body.body = text;
    for (const p of props) {
      const v = p.type === 'checkbox' ? fd.get(p.name) === 'on' : fd.get(p.name);
      if (v !== null && v !== '') body[p.type === 'title' ? 'title' : p.name.toLowerCase()] = v;
      if (p.type === 'checkbox') body[p.name.toLowerCase()] = v === true;
    }
    try {
      if (editing) {
        await api(`/api/notion/${sel.value}/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast('Updated in Notion');
      } else {
        await api(`/api/notion/${sel.value}`, { method: 'POST', body: JSON.stringify(body) });
        toast('Created in Notion');
      }
      setMode(); loadList();
    } catch (e) { fail(e); }
  };

  listEl.onclick = async (e) => {
    const btn = e.target as HTMLElement;
    const li = btn.closest<HTMLElement>('li[data-id]'); if (!li) return;
    try {
      if (btn.dataset.d) {
        if (!confirm('Archive this entry in Notion?')) return;
        await api(`/api/notion/${sel.value}/${li.dataset.id}`, { method: 'DELETE' });
        toast('Archived in Notion'); if (editing?.id === li.dataset.id) setMode(); loadList();
      }
      if (btn.dataset.e) {
        const item = await api(`/api/items/${sel.value}/${encodeURIComponent(li.dataset.slug!)}`);
        setMode(item);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (x) { fail(x); }
  };
}

// ── Posts：只存 SQLite，公开地址 /journal/<slug>；支持草稿、编辑、删除
function posts(el: HTMLElement) {
  el.innerHTML = `<form class="form" id="pf">
      <label>Title<input name="title" required></label>
      <label>Slug<small>optional · used in /journal/&lt;slug&gt;</small><input name="slug"></label>
      <label>Tags<small>comma separated</small><input name="tags"></label>
      <label>Excerpt<small>optional · shown in lists when set</small><input name="excerpt"></label>
      <label class="row2" style="display:flex;gap:8px"><input type="checkbox" name="published" checked style="width:auto"> Published<small>uncheck to keep as draft</small></label>
      <label>Body<small>Markdown · blank line = new paragraph</small><textarea name="body" rows="14" required></textarea></label>
      <div class="row2" style="margin:0"><button>Publish</button><button type="button" id="pcancel" hidden>Cancel edit</button><span class="hint" id="pmode">New post</span></div>
    </form><ul class="files" id="pl"></ul>`;
  const form = $<HTMLFormElement>('#pf', el), listEl = $('#pl', el), modeEl = $('#pmode', el), cancel = $<HTMLButtonElement>('#pcancel', el);
  let editing = '';

  const setMode = (p: any = null) => {
    editing = p?.slug ?? '';
    modeEl.textContent = p ? `Editing /journal/${p.slug}` : 'New post';
    cancel.hidden = !p;
    form.reset();
    $<HTMLInputElement>('input[name=title]', form).value = p?.title ?? '';
    $<HTMLInputElement>('input[name=slug]', form).value = p?.slug ?? '';
    $<HTMLInputElement>('input[name=tags]', form).value = (p?.tags ?? []).join(', ');
    $<HTMLInputElement>('input[name=excerpt]', form).value = p?.excerpt ?? '';
    $<HTMLInputElement>('input[name=published]', form).checked = p ? p.published : true;
    $<HTMLTextAreaElement>('textarea[name=body]', form).value = p?.markdown ?? '';
  };

  const list = async () => {
    const r: any = await api('/api/posts?drafts=1&limit=200');
    listEl.innerHTML = r.posts.map((p: any) => `<li data-slug="${esc(p.slug)}"><span>${esc(p.title)}${p.published ? '' : ' <span class="hint">draft</span>'}</span><span class="hint">${esc(String(p.created).slice(0, 10))}</span><a href="/journal/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View</a><button data-e="1">Edit</button><button data-d="1">Delete</button></li>`).join('') || '<li class="hint">No posts yet</li>';
  };
  cancel.onclick = () => setMode();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)) as Record<string, any>;
    const payload = { title: d.title, slug: d.slug, tags: String(d.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean), excerpt: d.excerpt, body: d.body, published: d.published === 'on' };
    try {
      if (editing) { await api(`/api/posts/${encodeURIComponent(editing)}`, { method: 'PUT', body: JSON.stringify(payload) }); toast('Saved'); }
      else { const r = await api('/api/posts', { method: 'POST', body: JSON.stringify(payload) }); toast('Published → /journal/' + r.slug); }
      setMode(); list();
    } catch (err) { fail(err); }
  };

  listEl.onclick = async (e) => {
    const btn = e.target as HTMLElement, li = btn.closest<HTMLElement>('li[data-slug]'); if (!li) return;
    const slug = li.dataset.slug!;
    try {
      if (btn.dataset.e) { setMode(await api(`/api/posts/${encodeURIComponent(slug)}`)); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      if (btn.dataset.d && confirm(`Delete /journal/${slug} permanently?`)) {
        await api(`/api/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        toast('Deleted'); if (editing === slug) setMode(); list();
      }
    } catch (x) { fail(x); }
  };
  setMode(); list().catch(fail);
}

// ── Files：上传到服务器 data/uploads，/uploads/<name> 提供访问
function files(el: HTMLElement) {
  el.innerHTML = `<div class="row2"><select id="as"><option value="">Library file (audio / video / image / pdf)</option><option value="model">Statue model (.glb) → replaces the 3D statue</option></select><button id="pk">Choose file…</button><span class="hint" id="fu"></span></div><ul class="files" id="fl"></ul>`;
  const list = async () => {
    const r: any = await api('/api/upload');
    $('#fu', el).textContent = `${r.usage.count} files · ${bytes(r.usage.bytes)} used (limit ${bytes(r.usage.limitBytes)} per upload)`;
    $('#fl', el).innerHTML = r.files.map((x: any) => `<li data-name="${esc(x.name)}"><span>${esc(x.name)}</span><span class="hint">${bytes(x.size)}</span><button data-c="1">Copy URL</button><button data-r="1">Rename</button><button data-d="1">Delete</button></li>`).join('') || '<li class="hint">No files yet</li>';
  };
  $('#pk', el).onclick = async () => {
    const f = await pick(); if (!f) return;
    toast(`Uploading ${f.name}…`);
    try { await upload(f, $<HTMLSelectElement>('#as', el).value); toast('Uploaded'); list(); } catch (e) { fail(e); }
  };
  $('#fl', el).onclick = async (e) => {
    const b = e.target as HTMLElement, li = b.closest<HTMLElement>('li[data-name]'); if (!li) return;
    const name = li.dataset.name!;
    try {
      if (b.dataset.c) { await navigator.clipboard.writeText(location.origin + '/uploads/' + encodeURIComponent(name)); toast('URL copied'); }
      if (b.dataset.r) {
        const next = prompt('New file name (keep the extension):', name);
        if (!next || next === name) return;
        await api('/api/upload/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify({ name: next }) });
        toast('Renamed'); list();
      }
      if (b.dataset.d && confirm('Delete ' + name + '?')) { await api('/api/upload/' + encodeURIComponent(name), { method: 'DELETE' }); toast('Deleted'); list(); }
    } catch (x) { fail(x); }
  };
  list().catch(fail);
}

// ── Settings：站点信息 + Notion 连接 + 手动同步
function settings(el: HTMLElement, s: any) {
  const L: Record<string, string> = {
    site_name: 'Site name', site_email: 'Contact email', site_about: 'About text', site_intro: 'Homepage lede (intro section)',
    NOTION_TOKEN: 'Notion integration token', NOTION_DB_WRITING: 'Notion database ID — Works',
    NOTION_DB_FILMS: 'Notion database ID — Video', NOTION_DB_MUSIC: 'Notion database ID — Music',
  };
  const K = Object.keys(L);
  const input = (k: string) => {
    const v = esc(s.values[k]);
    if (k === 'site_about' || k === 'site_intro') return `<textarea name="${k}" rows="3">${v}</textarea>`;
    return `<input name="${k}" value="${v}" ${k === 'NOTION_TOKEN' ? 'type="password" autocomplete="off" placeholder="' + (s.values.hasToken ? 'stored — leave blank to keep' : 'not set') + '"' : ''}>`;
  };
  el.innerHTML = `<form class="form">${K.map((k) => `<label>${L[k]}${input(k)}</label>`).join('')}<div><button>Save</button></div></form>
    <p class="hint" id="stt"></p>
    <div class="row2"><select id="sk">${KINDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select><button id="sy1">Sync this database</button><button id="sy">Sync all</button></div>`;
  const show = (st: any) => ($('#stt', el).textContent = `Notion ${st.notion ? 'configured' : 'not configured'} · cached ${['writing', 'music', 'films'].map((k) => `${k}: ${st.counts[k] ?? 0}`).join(', ')} · posts ${st.posts} (+${st.drafts} drafts) · last sync ${st.synced ? new Date(st.synced).toLocaleString() : 'never'}${st.syncing ? ' · syncing…' : ''}${st.syncError ? ` · last error: ${st.syncError}` : ''}`);
  show(s.status);
  $<HTMLFormElement>('form', el).onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target as HTMLFormElement))) }); s.values = r.values; show(r.status); toast('Saved'); }
    catch (x) { fail(x); }
  };
  $('#sy', el).onclick = async () => { toast('Syncing…'); try { const r = await api('/api/sync', { method: 'POST' }); show(r.status); toast('Synced'); } catch (x) { fail(x); } };
  $('#sy1', el).onclick = async () => {
    toast('Syncing…');
    try { const r = await api(`/api/sync?kind=${$<HTMLSelectElement>('#sk', el).value}`, { method: 'POST' }); show(r.status); toast('Synced'); } catch (x) { fail(x); }
  };
}

boot();
