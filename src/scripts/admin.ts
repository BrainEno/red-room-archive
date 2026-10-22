const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const app = $('#app');
let tok = sessionStorage.getItem('tok') ?? '';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const toast = (m: string, bad = false) => { const t = $('#toast'); t.textContent = m; t.className = 'toast on' + (bad ? ' bad' : ''); setTimeout(() => (t.className = 'toast'), 3200); };
async function api(p: string, init: RequestInit = {}) {
  const r = await fetch(p, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${tok}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const upload = async (file: File, as = '') => { const fd = new FormData(); fd.append('file', file); if (as) fd.append('as', as); return (await api('/api/upload', { method: 'POST', body: fd })) as { url: string; name: string }; };
const pick = () => new Promise<File | null>((ok) => { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => ok(i.files?.[0] ?? null); i.click(); });
const fail = (e: any) => toast(e.message, true);

function login() {
  app.innerHTML = `<form class="card" id="lg"><h1>Admin</h1><input id="tk" type="password" placeholder="ADMIN_TOKEN" autofocus><button>Enter</button></form>`;
  $('#lg').onsubmit = (e) => { e.preventDefault(); tok = $<HTMLInputElement>('#tk').value.trim(); sessionStorage.setItem('tok', tok); boot(); };
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
const field = (p: any, i: number) => {
  if (!OK.includes(p.type)) return '';
  const n = esc(p.name), has = p.options?.length;
  const inp = p.type === 'rich_text' ? `<textarea name="${n}" rows="2"></textarea>` : p.type === 'checkbox' ? `<input type="checkbox" name="${n}">`
    : `<input name="${n}" type="${({ number: 'number', date: 'date' } as any)[p.type] ?? 'text'}" step="any" ${has ? `list="dl${i}"` : ''} ${p.type === 'title' ? 'required' : ''}>`;
  return `<label>${n}<small>${p.type}</small>${inp}${p.type === 'url' ? `<button type="button" class="up" data-for="${n}">Upload file → fill URL</button>` : ''}${has ? `<datalist id="dl${i}">${p.options.map((o: string) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}</label>`;
};
function entries(el: HTMLElement) {
  el.innerHTML = `<div class="row2"><select id="kind">${KINDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select><span class="hint">Fields follow your Notion database columns.</span></div><form class="form" id="ef"></form>`;
  const form = $<HTMLFormElement>('#ef', el), sel = $<HTMLSelectElement>('#kind', el);
  let props: any[] = [];
  const load = async () => {
    form.innerHTML = '<p class="hint">Loading…</p>';
    try {
      props = await api(`/api/notion/${sel.value}`);
      form.innerHTML = props.map(field).join('') + `<label>Body<small>page content · blank line = new paragraph</small><textarea name="__body" rows="10"></textarea></label><div><button>Create in Notion</button></div>`;
    } catch (e: any) { form.innerHTML = `<p class="hint">${esc(e.message)}<br>Set the Notion token and database IDs in Settings.</p>`; }
  };
  sel.onchange = load; load();
  form.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.up'); if (!b) return;
    const f = await pick(); if (!f) return;
    try { const u = await upload(f); (form.elements.namedItem(b.dataset.for!) as HTMLInputElement).value = location.origin + u.url; toast('Uploaded'); } catch (e) { fail(e); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form), body: Record<string, any> = { body: fd.get('__body') };
    for (const p of props) { const v = p.type === 'checkbox' ? fd.get(p.name) === 'on' : fd.get(p.name); if (v !== null && v !== '') body[p.type === 'title' ? 'title' : p.name.toLowerCase()] = v; }
    try { await api(`/api/notion/${sel.value}`, { method: 'POST', body: JSON.stringify(body) }); toast('Created in Notion'); form.reset(); } catch (e) { fail(e); }
  };
}

// ── Posts：只存 SQLite，公开地址 /journal/<slug>
function posts(el: HTMLElement) {
  el.innerHTML = `<form class="form"><label>Title<input name="title" required></label><label>Slug<small>optional</small><input name="slug"></label><label>Tags<small>comma separated</small><input name="tags"></label><label>Body<small>blank line = new paragraph</small><textarea name="body" rows="14" required></textarea></label><div><button>Publish</button></div></form><ul class="files" id="pl"></ul>`;
  const list = async () => { const r: any[] = await fetch('/api/posts').then((x) => x.json()); $('#pl', el).innerHTML = r.map((p) => `<li><a href="/journal/${encodeURIComponent(p.slug)}">${esc(p.title)}</a><span class="hint">${esc(String(p.created).slice(0, 10))}</span></li>`).join(''); };
  $<HTMLFormElement>('form', el).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target as HTMLFormElement, d = Object.fromEntries(new FormData(f)) as Record<string, string>;
    try { const r = await api('/api/posts', { method: 'POST', body: JSON.stringify({ ...d, tags: d.tags.split(',').map((x) => x.trim()).filter(Boolean) }) }); toast('Published → /journal/' + r.slug); f.reset(); list(); } catch (e) { fail(e); }
  };
  list();
}

// ── Files：上传到服务器 data/uploads，/uploads/<name> 提供访问
function files(el: HTMLElement) {
  el.innerHTML = `<div class="row2"><select id="as"><option value="">Library file (audio / video / image / pdf)</option><option value="model">Statue model (.glb) → replaces the 3D statue</option></select><button id="pk">Choose file…</button></div><ul class="files" id="fl"></ul>`;
  const list = async () => {
    const f: any[] = await api('/api/upload');
    $('#fl', el).innerHTML = f.map((x) => `<li><span>${esc(x.name)}</span><span class="hint">${(x.size / 1048576).toFixed(1)} MB</span><button data-c="${esc(x.url)}">Copy URL</button><button data-d="${esc(x.name)}">Delete</button></li>`).join('') || '<li class="hint">No files yet</li>';
  };
  $('#pk', el).onclick = async () => { const f = await pick(); if (!f) return; toast('Uploading…'); try { await upload(f, $<HTMLSelectElement>('#as', el).value); toast('Uploaded'); list(); } catch (e) { fail(e); } };
  $('#fl', el).onclick = async (e) => {
    const b = e.target as HTMLElement;
    if (b.dataset.c) { await navigator.clipboard.writeText(location.origin + b.dataset.c); toast('URL copied'); }
    if (b.dataset.d && confirm('Delete ' + b.dataset.d + '?')) { await api('/api/upload?name=' + encodeURIComponent(b.dataset.d), { method: 'DELETE' }); list(); }
  };
  list().catch(fail);
}

// ── Settings：站点信息 + Notion 连接 + 手动同步
function settings(el: HTMLElement, s: any) {
  const K = ['site_name', 'site_email', 'site_about', 'NOTION_TOKEN', 'NOTION_DB_WRITING', 'NOTION_DB_FILMS', 'NOTION_DB_MUSIC'];
  const L: Record<string, string> = { site_name: 'Site name', site_email: 'Contact email', site_about: 'About text', NOTION_TOKEN: 'Notion integration token', NOTION_DB_WRITING: 'Notion database ID — Works', NOTION_DB_FILMS: 'Notion database ID — Video', NOTION_DB_MUSIC: 'Notion database ID — Music' };
  el.innerHTML = `<form class="form">${K.map((k) => `<label>${L[k]}${k === 'site_about' ? `<textarea name="${k}" rows="3">${esc(s.values[k])}</textarea>` : `<input name="${k}" value="${esc(s.values[k])}" ${k === 'NOTION_TOKEN' ? 'type="password" autocomplete="off"' : ''}>`}</label>`).join('')}<div><button>Save</button></div></form><p class="hint" id="stt"></p><div class="row2"><button id="sy">Sync from Notion now</button></div>`;
  const show = (st: any) => ($('#stt', el).textContent = `Notion ${st.notion ? 'configured' : 'not configured'} · cached ${['writing', 'music', 'films'].map((k) => `${k}: ${st.counts[k] ?? 0}`).join(', ')} · last sync ${st.synced ? new Date(st.synced).toLocaleString() : 'never'}`);
  show(s.status);
  $<HTMLFormElement>('form', el).onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target as HTMLFormElement))) }); show(r.status); toast('Saved'); } catch (x) { fail(x); } };
  $('#sy', el).onclick = async () => { toast('Syncing…'); try { show((await api('/api/sync', { method: 'POST' })).status); toast('Synced'); } catch (x) { fail(x); } };
}

boot();
