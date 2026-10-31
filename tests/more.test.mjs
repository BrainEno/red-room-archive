// The /more page editor: validation (core/more.ts), the admin endpoints, the
// page facade, Files integration, and data safety (Notion syncs and
// credential changes never touch the saved page).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API, DB, createNotionMock } from './fixtures/notion-mock.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'rra-more-'));
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.MEDIA_CACHE_DIR = path.join(dir, 'media');
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.NOTION_TOKEN = 'secret_env_token';
process.env.NOTION_API_BASE = API;
process.env.NOTION_DATABASE_ID = DB;
process.env.SYNC_TTL_SECONDS = '3600';

const mock = createNotionMock();
const realFetch = globalThis.fetch;
globalThis.fetch = mock.fetch;

const core = await import('../src/core/more.ts');
const model = await import('../src/ui/scripts/admin/more-model.ts');
const { moreAction } = await import('../src/ui/more-action.ts');
const endpoints = await import('../src/server/http/endpoints/more.ts');
const admin = await import('../src/server/http/endpoints/admin.ts');
const files = await import('../src/server/http/endpoints/uploads.ts');
const queries = await import('../src/server/queries.ts');
const { invalidateMoreCache } = await import('../src/server/services/more.ts');
const { resetAuthThrottle } = await import('../src/server/services/auth.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');

test.after(() => {
  globalThis.fetch = realFetch;
  closeConnection();
  rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(() => resetAuthThrottle());

const TOKEN = 'test-admin-token';

async function call(handler, { method = 'GET', path: p = '/', params = {}, json, body, headers = {}, token } = {}) {
  const url = new URL(p, 'http://archive.test');
  const h = new Headers(headers);
  if (token) h.set('authorization', `Bearer ${token}`);
  if (json !== undefined) h.set('content-type', 'application/json');
  const request = new Request(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, duplex: 'half' });
  const response = await handler({ request, url, params });
  const text = response.status === 204 ? '' : await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { status: response.status, headers: response.headers, data };
}

const both = (en, zh = en) => ({ en, 'zh-CN': zh });

/** A complete, valid document with one book and one channel. */
const sampleDoc = () => ({
  intro: both('Books I print myself.', '我自己印的书。'),
  publications: [
    {
      id: 'book-a',
      title: both('Red Room', '红房间'),
      subtitle: both('Poems', ''),
      year: '2025',
      format: both('Risograph', 'Risograph 印刷'),
      pages: 64,
      edition: both('Edition of 200', '限量 200 册'),
      size: both('A5'),
      cover: '/uploads/cover.png',
      excerpt: both('First paragraph.\n\nSecond paragraph.', '第一段。\n\n第二段。'),
      excerptSource: both('from part one', '选自第一部分'),
      link: 'https://shop.test/red-room',
      linkLabel: both('Buy', '购买'),
    },
  ],
  channels: [
    { id: 'wx', name: both('WeChat', '微信公众号'), handle: 'redroom', href: '', qr: '/uploads/cover.png', note: both('', '扫码关注') },
  ],
});

/* ── core ───────────────────────────────────────────────────────────── */

test('normalizeMoreDocument trims, fills ids and accepts loose shapes', () => {
  const doc = core.normalizeMoreDocument({
    intro: '  Same in both  ',
    publications: [
      { title: 'Plain title', year: 2024, excerpt: [both('One', '一'), both('Two', '二')], link: { href: 'mailto:a@b.test', label: 'Write' }, pages: '12' },
      { id: 'dup', title: both('A\nB', 'C') },
      { id: 'dup', title: both('D') },
    ],
    channels: [{ name: both('IG'), handle: '@x', qr: 'https://cdn.test/qr.png' }],
  });
  assert.deepEqual(doc.intro, both('Same in both'));
  const [first, second, third] = doc.publications;
  assert.match(first.id, /^pub-/);
  assert.deepEqual(first.title, both('Plain title'));
  assert.deepEqual(first.year, both('2024'), 'legacy string years apply to both languages');
  assert.deepEqual(first.description, both(''), 'missing descriptions normalize to empty text');
  assert.equal(first.availability, undefined, 'missing availability keeps legacy behaviour');
  assert.equal(first.pages, 12);
  assert.deepEqual(first.excerpt, both('One\n\nTwo', '一\n\n二'), 'paragraph arrays become blank-line separated text');
  assert.equal(first.link, 'mailto:a@b.test');
  assert.deepEqual(first.linkLabel, both('Write'));
  assert.deepEqual(second.title, both('A B', 'C'), 'single-line fields fold newlines');
  assert.equal(second.id, 'dup');
  assert.notEqual(third.id, 'dup', 'duplicate ids are replaced');
  assert.equal(doc.channels[0].href, '');
  assert.equal(doc.channels[0].qr, 'https://cdn.test/qr.png');
  // Idempotent: a normalised document passes through unchanged.
  assert.deepEqual(core.normalizeMoreDocument(doc), doc);
});

test('normalizeMoreDocument rejects unsafe URLs and oversized input, naming the field', () => {
  const reject = (mutate, field) => {
    const doc = sampleDoc();
    mutate(doc);
    assert.throws(() => core.normalizeMoreDocument(doc), (error) => error.status === 400 && error.details?.field === field, field);
  };
  reject((d) => (d.publications[0].link = 'javascript:alert(1)'), 'publications.0.link');
  reject((d) => (d.publications[0].link = '//evil.test/x'), 'publications.0.link');
  reject((d) => (d.publications[0].cover = 'http://insecure.test/a.jpg'), 'publications.0.cover');
  reject((d) => (d.publications[0].cover = 'data:image/png;base64,AAAA'), 'publications.0.cover');
  reject((d) => (d.channels[0].qr = '/uploads/a b.png'), 'channels.0.qr');
  reject((d) => (d.channels[0].href = 'ftp://x.test'), 'channels.0.href');
  reject((d) => (d.publications[0].pages = 1.5), 'publications.0.pages');
  reject((d) => (d.publications[0].title.en = 'x'.repeat(201)), 'publications.0.title.en');
  reject((d) => (d.publications[0].description = both('x'.repeat(4001))), 'publications.0.description.en');
  for (const availability of ['available', 'SOLD-OUT', 1, true, []]) {
    reject((d) => (d.publications[0].availability = availability), 'publications.0.availability');
  }
  reject((d) => (d.publications = Array.from({ length: 61 }, () => ({}))), 'publications');
  reject((d) => (d.channels = 'nope'), 'channels');
  assert.throws(() => core.normalizeMoreDocument(null), /must be an object/);
  for (const ok of ['', '/more/a.jpg', '/uploads/%E4%B8%AD.png', 'https://cdn.test/a.webp']) assert.ok(core.isImageUrl(ok), ok);
  for (const ok of ['', 'https://a.test', 'http://a.test/x', 'mailto:me@a.test', '/articles']) assert.ok(core.isLinkUrl(ok), ok);
});

test('availability is optional, validated and localized with a multiline description', () => {
  for (const availability of ['sold-out', 'contact', 'preorder']) {
    const doc = core.normalizeMoreDocument({
      publications: [{
        title: both('Studies in Nature', '自然研究'),
        year: both('2026–2027 (planned)', '2026–2027（预计）'),
        availability,
        description: both('First line.\nSecond line.', '第一行。\n第二行。'),
      }],
    });
    const publication = doc.publications[0];
    assert.equal(publication.availability, availability);
    const en = core.localizeMore(doc, 'en').publications[0];
    const zh = core.localizeMore(doc, 'zh-CN').publications[0];
    assert.equal(en.description, 'First line.\nSecond line.');
    assert.equal(zh.description, '第一行。\n第二行。');
    assert.equal(en.year, '2026–2027 (planned)');
    assert.equal(zh.year, '2026–2027（预计）');
    assert.deepEqual(en.excerpt, [], 'a description never becomes an excerpt');
  }
  for (const empty of [undefined, null, '']) {
    const doc = core.normalizeMoreDocument({ publications: [{ title: 'Legacy', availability: empty }] });
    assert.equal(doc.publications[0].availability, undefined);
    assert.equal(core.localizeMore(doc, 'en').publications[0].description, undefined);
  }
});

test('localizeMore picks a language, falls back to the other side and splits paragraphs', () => {
  const doc = core.normalizeMoreDocument(sampleDoc());
  const en = core.localizeMore(doc, 'en');
  const zh = core.localizeMore(doc, 'zh-CN');
  assert.equal(en.intro, 'Books I print myself.');
  assert.equal(zh.publications[0].title, '红房间');
  assert.equal(zh.publications[0].subtitle, 'Poems', 'empty Chinese side falls back to English');
  assert.equal(en.publications[0].year, '2025');
  assert.equal(en.publications[0].description, undefined);
  assert.equal(en.publications[0].availability, undefined);
  assert.deepEqual(en.publications[0].excerpt, ['First paragraph.', 'Second paragraph.']);
  assert.deepEqual(zh.publications[0].link, { href: 'https://shop.test/red-room', label: '购买' });
  assert.equal(en.channels[0].note, '扫码关注');
  assert.equal(en.channels[0].href, undefined);
  // QR frames: '' → frame only for built-in content, otherwise no QR.
  const noQr = { ...doc, channels: [{ ...doc.channels[0], qr: '' }] };
  assert.equal(core.localizeMore(noQr, 'en').channels[0].qr, undefined);
  assert.equal(core.localizeMore(noQr, 'en', { placeholderQr: true }).channels[0].qr, '');
  assert.deepEqual(core.referencedUploads(doc), ['cover.png']);
  const renamed = core.replaceUpload(doc, 'cover.png', '/uploads/new.png');
  assert.equal(renamed.publications[0].cover, '/uploads/new.png');
  assert.equal(renamed.channels[0].qr, '/uploads/new.png');
  assert.equal(core.replaceUpload(doc, 'other.png', '/uploads/x.png'), null);
});

test('publication CTA: status precedence, explicit links, email subjects and no-email safety', () => {
  const publication = (title, availability, link) => ({ id: 'book', title, year: '2026', excerpt: [], availability, link });
  const email = 'doro@example.test';
  assert.equal(moreAction(publication('Sold', 'sold-out', { href: 'https://example.test/sold', label: 'Hidden' }), 'en', email), undefined);
  assert.equal(moreAction(publication('Sold', 'sold-out'), 'en', email), undefined);

  const explicit = moreAction(publication('Animal Specimens', 'contact', { href: 'https://example.test/enquiry', label: 'Enquire' }), 'en', '');
  assert.deepEqual(explicit, { href: 'https://example.test/enquiry', label: 'Enquire', external: true });
  assert.equal(moreAction(publication('Animal Specimens', 'contact', { href: 'https://example.test/enquiry' }), 'en', '')?.label, 'Contact the author');
  assert.equal(moreAction(publication('自然研究', 'preorder', { href: 'https://example.test/interest' }), 'zh-CN', '')?.label, '登记预订意向');
  assert.equal(moreAction(publication('Legacy', undefined, { href: 'https://example.test/order' }), 'en', '')?.label, 'Order a copy');

  assert.deepEqual(moreAction(publication('Animal Specimens', 'contact'), 'en', email), {
    href: `mailto:${email}?subject=${encodeURIComponent('About “Animal Specimens”')}`, label: 'Contact the author', external: false,
  });
  assert.deepEqual(moreAction(publication('动物标本', 'contact'), 'zh-CN', email), {
    href: `mailto:${email}?subject=${encodeURIComponent('关于《动物标本》')}`, label: '联系作者', external: false,
  });
  assert.deepEqual(moreAction(publication('Studies in Nature', 'preorder'), 'en', email), {
    href: `mailto:${email}?subject=${encodeURIComponent('Pre-order interest: “Studies in Nature”')}`, label: 'Register interest', external: false,
  });
  assert.deepEqual(moreAction(publication('自然研究', 'preorder'), 'zh-CN', email), {
    href: `mailto:${email}?subject=${encodeURIComponent('《自然研究》预订意向')}`, label: '登记预订意向', external: false,
  });
  assert.equal(moreAction(publication('Legacy', undefined), 'en', email)?.label, 'Ask for a copy');
  assert.equal(moreAction(publication('旧书', undefined), 'zh-CN', email)?.label, '来信索取');
  for (const availability of [undefined, 'contact', 'preorder']) {
    assert.equal(moreAction(publication('No email', availability), 'en', ''), undefined);
    assert.equal(moreAction(publication('No email', availability), 'en', '   '), undefined);
  }
});

test('editor model: paths, reordering and imports', () => {
  const doc = model.cloneDocument(core.normalizeMoreDocument(sampleDoc()));
  model.setPath(doc, 'publications.0.title.zh-CN', '新标题');
  assert.equal(doc.publications[0].title['zh-CN'], '新标题');
  assert.ok('availability' in doc.publications[0], 'the editor adds the optional status field to legacy documents');
  model.setPath(doc, 'publications.0.availability', 'contact');
  model.setPath(doc, 'publications.0.description.en', 'Publication note');
  assert.equal(doc.publications[0].availability, 'contact');
  assert.equal(doc.publications[0].description.en, 'Publication note');
  assert.equal(model.getPath(doc, 'channels.0.handle'), 'redroom');
  assert.throws(() => model.setPath(doc, 'publications.0.nope', 1), /bad path/);
  const list = ['a', 'b', 'c'];
  assert.equal(model.move(list, 0, 1), 1);
  assert.deepEqual(list, ['b', 'a', 'c']);
  assert.equal(model.move(list, 0, -1), 0, 'clamped at the top');
  assert.deepEqual(list, ['b', 'a', 'c']);
  const blank = model.blankPublication();
  assert.deepEqual(blank.description, both(''));
  assert.equal(blank.availability, undefined);
  assert.deepEqual(blank.year, both(String(new Date().getFullYear())));
  assert.deepEqual(core.normalizeMoreDocument({ publications: [blank] }).publications[0].id, blank.id, 'a blank card is valid as is');
  const imported = model.documentFromImport({ document: doc });
  assert.deepEqual(imported, doc);
  const exported = JSON.parse(JSON.stringify({ document: imported }));
  assert.equal(exported.document.publications[0].availability, 'contact');
  assert.equal(exported.document.publications[0].description.en, 'Publication note');
  assert.equal(model.documentFromImport(exported), exported.document);
  assert.equal(exported.document.publications[0].cover, '/uploads/cover.png');
  assert.equal(exported.document.publications[0].link, 'https://shop.test/red-room');
  assert.equal(exported.document.channels[0].qr, '/uploads/cover.png');
  assert.equal(model.documentFromImport(doc), doc);
  assert.equal(model.documentFromImport(doc), doc);
  assert.equal(model.bilingualLabel(both('Same'), '—'), 'Same');
  assert.equal(model.bilingualLabel(both('', ''), '—'), '—');
});

/* ── endpoints + page ───────────────────────────────────────────────── */

test('before anything is saved the page shows the built-in publications without demo channels', async () => {
  const doc = await call(endpoints.readMoreDocument, { token: TOKEN });
  assert.equal(doc.status, 200);
  assert.equal(doc.data.custom, false);
  assert.equal(doc.data.updated, null);
  assert.equal(doc.data.document.publications[0].id, 'sample-pub-1', 'stable built-in ids');
  assert.deepEqual(doc.data.document.channels, []);
  const page = queries.getMore('zh-CN');
  assert.deepEqual(page.publications.map((p) => p.title), ['孱弱的恶', '动物标本', '自然研究']);
  assert.deepEqual(page.publications.map((p) => p.availability), ['sold-out', 'contact', 'preorder']);
  assert.equal(page.publications[2].year, '2026–2027（预计）');
  assert.equal(page.publications.every((p) => !p.cover && p.excerpt.length === 0 && !p.excerptSource), true);
  assert.deepEqual(page.channels, []);
  const pub = await call(endpoints.publicMore, { path: '/api/more?lang=en' });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.locale, 'en');
  assert.deepEqual(pub.data.publications.map((p) => p.title), ['The Weak Demon', 'Animal Specimens', 'Studies in Nature']);
  assert.equal(pub.data.publications[2].year, '2026–2027 (planned)');
  assert.match(pub.data.publications[1].description, /^Contact me to arrange a copy by post\./);
  assert.doesNotMatch(JSON.stringify(pub.data), /your-handle|your-account|Zine No\.|自印本/);
  assert.match(pub.headers.get('cache-control'), /public/);
});

test('the document endpoints are admin-only', async () => {
  assert.equal((await call(endpoints.readMoreDocument)).status, 401);
  assert.equal((await call(endpoints.writeMoreDocument, { method: 'PUT', json: sampleDoc() })).status, 401);
  assert.equal((await call(endpoints.resetMoreDocument, { method: 'DELETE', token: 'wrong' })).status, 401);
});

test('PUT validates, saves and the page follows; errors name the field', async () => {
  const bad = sampleDoc();
  bad.publications[0].link = 'javascript:alert(1)';
  const rejected = await call(endpoints.writeMoreDocument, { method: 'PUT', json: bad, token: TOKEN });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.details.field, 'publications.0.link');
  const badStatus = sampleDoc();
  badStatus.publications[0].availability = 'available';
  const rejectedStatus = await call(endpoints.writeMoreDocument, { method: 'PUT', json: badStatus, token: TOKEN });
  assert.equal(rejectedStatus.status, 400);
  assert.equal(rejectedStatus.data.details.field, 'publications.0.availability');
  assert.equal((await call(endpoints.readMoreDocument, { token: TOKEN })).data.custom, false, 'nothing saved on error');

  const saved = await call(endpoints.writeMoreDocument, { method: 'PUT', json: sampleDoc(), token: TOKEN });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.custom, true);
  assert.ok(!Number.isNaN(Date.parse(saved.data.updated)));

  invalidateMoreCache(); // read back from SQLite, not the in-process copy
  const page = queries.getMore('en');
  assert.equal(page.intro, 'Books I print myself.');
  assert.deepEqual(page.publications.map((p) => p.title), ['Red Room']);
  assert.equal(page.publications[0].cover, '/uploads/cover.png');
  assert.equal(page.publications[0].description, undefined);
  assert.equal(page.publications[0].availability, undefined);
  assert.deepEqual(page.channels.map((c) => c.name), ['WeChat']);
  const legacyDocument = (await call(endpoints.readMoreDocument, { token: TOKEN })).data.document;
  assert.deepEqual(legacyDocument.publications[0].description, both(''));
  assert.equal(legacyDocument.publications[0].availability, undefined);
  assert.deepEqual(legacyDocument.publications[0].year, both('2025'));
  assert.equal((await call(endpoints.writeMoreDocument, { method: 'PUT', json: legacyDocument, token: TOKEN })).status, 200, 'a legacy document can be saved again');

  // Reorder = save the list in the new order.
  const doc = sampleDoc();
  doc.publications.push({ ...doc.publications[0], id: 'book-b', title: both('Second', '第二本'), cover: '' });
  doc.publications.reverse();
  await call(endpoints.writeMoreDocument, { method: 'PUT', json: doc, token: TOKEN });
  assert.deepEqual(queries.getMore('zh-CN').publications.map((p) => p.title), ['第二本', '红房间']);

  const empty = { intro: both(''), publications: [], channels: [{ id: 'ig', name: both('Instagram'), handle: '@x', href: 'https://instagram.com/x', qr: '', note: both('') }] };
  await call(endpoints.writeMoreDocument, { method: 'PUT', json: empty, token: TOKEN });
  assert.deepEqual(queries.getMore('en').publications, []);
  assert.equal(queries.getMore('en').channels[0].qr, undefined, 'saved channels without a code show no frame');
});

test('all availability values and descriptions survive save/read/localization with existing links and channels', async () => {
  const doc = sampleDoc();
  doc.publications = ['sold-out', 'contact', 'preorder'].map((availability, index) => ({
    ...doc.publications[0],
    id: `book-${availability}`,
    title: both(`Book ${availability}`, `书籍 ${availability}`),
    year: index === 2 ? both('2026–2027 (planned)', '2026–2027（预计）') : '2026',
    availability,
    description: both(`Note ${availability}.\nSecond line.`, `说明 ${availability}。\n第二行。`),
    excerpt: both(''),
    excerptSource: both(''),
  }));
  const saved = await call(endpoints.writeMoreDocument, { method: 'PUT', json: doc, token: TOKEN });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  invalidateMoreCache();
  const stored = (await call(endpoints.readMoreDocument, { token: TOKEN })).data.document;
  assert.deepEqual(stored.publications.map((p) => p.availability), ['sold-out', 'contact', 'preorder']);
  assert.equal(stored.publications[2].year.en, '2026–2027 (planned)');
  assert.equal(stored.publications.every((p) => p.cover === '/uploads/cover.png' && p.link === 'https://shop.test/red-room'), true);
  assert.equal(stored.channels[0].qr, '/uploads/cover.png');
  const en = queries.getMore('en');
  const zh = queries.getMore('zh-CN');
  assert.equal(en.publications[1].description, 'Note contact.\nSecond line.');
  assert.equal(zh.publications[1].description, '说明 contact。\n第二行。');
  assert.equal(en.publications.every((p) => p.excerpt.length === 0), true);
  assert.equal(zh.publications[2].year, '2026–2027（预计）');
});

test('long bilingual excerpts fit (document cap well above MAX_JSON_KB)', async () => {
  const doc = sampleDoc();
  doc.publications = Array.from({ length: 30 }, (_, i) => ({ ...doc.publications[0], id: `b${i}`, excerpt: both('e'.repeat(9000), '中'.repeat(9000)) }));
  const saved = await call(endpoints.writeMoreDocument, { method: 'PUT', json: doc, token: TOKEN });
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 200));
  assert.equal(queries.getMore('en').publications.length, 30);
});

test('Files: uploads used on /more are marked, and renaming one updates the page', async () => {
  const form = new FormData();
  form.append('file', new File([Buffer.from('89504e470d0a1a0a', 'hex')], 'cover.png', { type: 'image/png' }));
  const request = new Request('http://archive.test/api/uploads', { method: 'POST', body: form, headers: { authorization: `Bearer ${TOKEN}` } });
  const uploaded = await files.upload({ request, url: new URL(request.url), params: {} });
  assert.equal(uploaded.status, 201);
  const { url } = await uploaded.json();

  const doc = sampleDoc();
  doc.publications[0].cover = url;
  doc.channels[0].qr = '';
  await call(endpoints.writeMoreDocument, { method: 'PUT', json: doc, token: TOKEN });

  const listed = await call(files.list, { token: TOKEN });
  const entry = listed.data.files.find((f) => f.url === url);
  assert.deepEqual(entry.usedBy, ['more']);

  const name = decodeURIComponent(url.split('/').pop());
  const renamed = await call(files.rename, { method: 'PATCH', params: { name }, json: { name: 'red-room-cover.png' }, token: TOKEN });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(queries.getMore('en').publications[0].cover, '/uploads/red-room-cover.png');
  const after = await call(files.list, { token: TOKEN });
  assert.deepEqual(after.data.files.find((f) => f.name === 'red-room-cover.png').usedBy, ['more']);
});

test('a database failure during file rename leaves both the saved references and source intact', async () => {
  const { connection } = await import('../src/server/db/connection.ts');
  const { saveStream } = await import('../src/server/storage/uploads.ts');
  const { existsSync } = await import('node:fs');
  const uploaded = await saveStream(new Blob(['image']).stream(), 'failure-cover.png');
  const doc = sampleDoc(); doc.publications[0].cover = uploaded.url;
  await call(endpoints.writeMoreDocument, { method: 'PUT', json: doc, token: TOKEN });
  connection().exec(`CREATE TRIGGER fail_more_rename BEFORE UPDATE ON more_page BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  try {
    const result = await call(files.rename, { method: 'PATCH', params: { name: uploaded.name }, json: { name: 'should-not-exist.png' }, token: TOKEN });
    assert.equal(result.status, 500);
    invalidateMoreCache();
    assert.equal(queries.getMore('en').publications[0].cover, uploaded.url);
    assert.ok(existsSync(path.join(process.env.UPLOAD_DIR, uploaded.name)));
    assert.ok(!existsSync(path.join(process.env.UPLOAD_DIR, 'should-not-exist.png')));
  } finally { connection().exec('DROP TRIGGER fail_more_rename'); }
});

test('data safety: a full Notion resync and a credentials change leave /more alone', async () => {
  await call(endpoints.writeMoreDocument, { method: 'PUT', json: sampleDoc(), token: TOKEN });
  const before = (await call(endpoints.readMoreDocument, { token: TOKEN })).data;

  const synced = await call(admin.runSync, { method: 'POST', path: '/api/sync?full=1', token: TOKEN });
  assert.equal(synced.status, 200, JSON.stringify(synced.data));
  const changed = await call(admin.writeSettings, { method: 'PATCH', json: { NOTION_DATABASE_ID: '0123456789abcdef0123456789abcdef' }, token: TOKEN });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));

  invalidateMoreCache();
  assert.deepEqual((await call(endpoints.readMoreDocument, { token: TOKEN })).data, before);
});

test('DELETE resets to the built-in content', async () => {
  const reset = await call(endpoints.resetMoreDocument, { method: 'DELETE', token: TOKEN });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.custom, false);
  invalidateMoreCache();
  assert.equal(queries.getMore('en').publications[0].title, 'The Weak Demon');
});
