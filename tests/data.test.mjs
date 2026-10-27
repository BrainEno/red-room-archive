// Data safety: post history, trash, backups, export/import, and the pure
// helpers behind them (zip, front matter, diff).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const scratch = mkdtempSync(path.join(tmpdir(), 'rra-data-'));
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = path.join(scratch, 'uploads');
process.env.BACKUP_DIR = path.join(scratch, 'backups');
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.POST_REVISIONS_KEEP = '5';
process.env.BACKUP_KEEP = '2';
delete process.env.NOTION_TOKEN;

const posts = await import('../src/server/http/endpoints/posts.ts');
const revisions = await import('../src/server/http/endpoints/revisions.ts');
const data = await import('../src/server/http/endpoints/data.ts');
const { closeConnection } = await import('../src/server/db/connection.ts');
const { runScheduledBackup, listBackups } = await import('../src/server/services/backups.ts');
const { normalizeDate } = await import('../src/server/services/posts.ts');
const { createZip, readZip, crc32 } = await import('../src/server/storage/zip.ts');
const { parseFrontMatter, stringifyFrontMatter } = await import('../src/core/frontmatter.ts');
const { diffLines, diffStats } = await import('../src/core/diff.ts');

test.after(() => {
  closeConnection();
  rmSync(scratch, { recursive: true, force: true });
});

const TOKEN = 'test-admin-token';

async function call(handler, { method = 'GET', path: p = '/', params = {}, json, body, headers = {}, token = TOKEN } = {}) {
  const url = new URL(p, 'http://archive.test');
  const h = new Headers(headers);
  if (token) h.set('authorization', `Bearer ${token}`);
  if (json !== undefined) h.set('content-type', 'application/json');
  const request = new Request(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, duplex: 'half' });
  const response = await handler({ request, url, params, isPrerendered: false });
  const type = response.headers.get('content-type') ?? '';
  let parsed;
  if (response.status !== 204) {
    if (type.includes('json')) parsed = await response.json();
    else parsed = Buffer.from(await response.arrayBuffer());
  }
  return { status: response.status, headers: response.headers, data: parsed };
}

const create = (json) => call(posts.create, { method: 'POST', json });
const patch = (slug, json) => call(posts.update, { method: 'PATCH', params: { slug }, json });

/* ── Pure helpers ───────────────────────────────────────────────────── */

test('zip: round-trips names (UTF-8), contents and empty files; detects corruption', () => {
  const entries = [
    { name: 'journal/黎明.md', data: Buffer.from('# 黎明\n\n'.repeat(50)) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'bin', data: Buffer.from([0, 1, 2, 255]) },
  ];
  const zip = createZip(entries);
  const back = readZip(zip);
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  back.forEach((entry, i) => assert.ok(entry.data.equals(entries[i].data)));

  const broken = Buffer.from(zip);
  broken[30 + Buffer.byteLength(entries[0].name) + 2] ^= 0xff; // a byte inside the first entry's data
  assert.throws(() => readZip(broken), /valid ZIP/);
  assert.throws(() => readZip(Buffer.from('not a zip')), /valid ZIP/);
  assert.throws(() => readZip(zip, { maxEntries: 2 }), /entries/);
  assert.throws(() => readZip(zip, { maxTotalBytes: 10 }), /limit/);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('front matter: parses common shapes and round-trips our own output', () => {
  const { data, body } = parseFrontMatter('---\ntitle: "Dawn: again"\ndate: 2026-10-27\ntags:\n  - one\n  - \'two\'\ndraft: true\n---\n\nHello');
  assert.deepEqual(data, { title: 'Dawn: again', date: '2026-10-27', tags: ['one', 'two'], draft: true });
  assert.equal(body, 'Hello');

  const source = { title: 'yes', slug: 's', tags: ['a, b', 'c'], published: false, excerpt: '# not a comment' };
  const text = stringifyFrontMatter(source, '\nBody\n\n');
  const again = parseFrontMatter(text);
  assert.deepEqual(again.data, source);
  assert.equal(again.body, '\nBody\n\n');
  assert.deepEqual(parseFrontMatter('no header').data, {});
});

test('diff: minimal line edits, stats', () => {
  const lines = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(lines, [
    { op: 'same', text: 'a' },
    { op: 'del', text: 'b' },
    { op: 'add', text: 'B' },
    { op: 'same', text: 'c' },
    { op: 'same', text: 'd' },
    { op: 'add', text: 'e' },
  ]);
  assert.deepEqual(diffStats(lines), { added: 2, removed: 1 });
  assert.deepEqual(diffStats(diffLines('same', 'same')), { added: 0, removed: 0 });
});

test('dates are normalised to sortable SQL timestamps', () => {
  assert.equal(normalizeDate('2026-01-02'), '2026-01-02 00:00:00');
  assert.equal(normalizeDate('2026-01-02 03:04'), '2026-01-02 03:04:00');
  assert.equal(normalizeDate('2026-01-02T03:04:05'), '2026-01-02 03:04:05');
  assert.equal(normalizeDate('2026-01-02T03:04:05+08:00'), '2026-01-01 19:04:05');
  assert.equal(normalizeDate(''), undefined);
  assert.throws(() => normalizeDate('someday'), /date/);
});

/* ── History ────────────────────────────────────────────────────────── */

test('every edit keeps the previous version; no-op saves do not', async () => {
  assert.equal((await create({ title: 'Tide', body: 'v1', tags: ['sea'] })).status, 201);
  await patch('tide', { body: 'v2' });
  await patch('tide', { body: 'v2' }); // unchanged → no revision
  await patch('tide', { title: 'Tide Line', body: 'v3' });

  const list = await call(revisions.list, { params: { slug: 'tide' } });
  assert.equal(list.status, 200);
  assert.equal(list.data.exists, true);
  assert.deepEqual(list.data.revisions.map((r) => r.reason), ['edit', 'edit']);
  assert.equal(list.data.revisions[0].title, 'Tide'); // state before the title change

  const oldest = list.data.revisions.at(-1);
  const detail = await call(revisions.read, { params: { slug: 'tide', id: String(oldest.id) } });
  assert.equal(detail.data.markdown, 'v1');
  assert.deepEqual(detail.data.tags, ['sea']);
});

test('history follows a renamed post; restore is itself undoable', async () => {
  await create({ title: 'Moth', body: 'first' });
  await patch('moth', { body: 'second', slug: 'night-moth' });

  const list = await call(revisions.list, { params: { slug: 'night-moth' } });
  assert.equal(list.data.revisions.length, 1);
  assert.equal(list.data.revisions[0].slug, 'night-moth');
  const id = String(list.data.revisions[0].id);

  const restored = await call(revisions.restore, { method: 'POST', params: { slug: 'night-moth', id } });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.markdown, 'first');
  assert.equal(restored.data.slug, 'night-moth'); // restoring content keeps the current slug

  const after = await call(revisions.list, { params: { slug: 'night-moth' } });
  assert.equal(after.data.revisions[0].reason, 'restore');
  assert.equal((await call(revisions.read, { params: { slug: 'night-moth', id: String(after.data.revisions[0].id) } })).data.markdown, 'second');
});

test('history is pruned to POST_REVISIONS_KEEP', async () => {
  await create({ title: 'Many', body: 'v0' });
  for (let i = 1; i <= 8; i++) await patch('many', { body: `v${i}` });
  const list = await call(revisions.list, { params: { slug: 'many' } });
  assert.equal(list.data.revisions.length, 5);
  const newest = await call(revisions.read, { params: { slug: 'many', id: String(list.data.revisions[0].id) } });
  assert.equal(newest.data.markdown, 'v7');
});

test('deleted posts go to the trash and can be restored or purged', async () => {
  await create({ title: 'Ash', body: 'keep me', published: false });
  assert.equal((await call(posts.remove, { method: 'DELETE', params: { slug: 'ash' } })).status, 204);

  const trash = await call(revisions.trash);
  const entry = trash.data.posts.find((p) => p.slug === 'ash');
  assert.ok(entry, 'deleted post is listed');
  assert.equal(entry.title, 'Ash');

  const back = await call(revisions.restore, { method: 'POST', params: { slug: 'ash', id: String(entry.revisionId) } });
  assert.equal(back.status, 201);
  assert.equal(back.headers.get('location'), '/journal/ash');
  assert.equal(back.data.markdown, 'keep me');
  assert.equal(back.data.published, false, 'draft state is restored too');
  assert.ok(!(await call(revisions.trash)).data.posts.some((p) => p.slug === 'ash'));

  // Purge only works on deleted posts.
  assert.equal((await call(revisions.purge, { method: 'DELETE', params: { slug: 'ash' } })).status, 409);
  await call(posts.remove, { method: 'DELETE', params: { slug: 'ash' } });
  assert.equal((await call(revisions.purge, { method: 'DELETE', params: { slug: 'ash' } })).status, 204);
  assert.equal((await call(revisions.list, { params: { slug: 'ash' } })).status, 404);
});

test('history endpoints are admin-only and validate ids', async () => {
  assert.equal((await call(revisions.list, { params: { slug: 'tide' }, token: '' })).status, 401);
  assert.equal((await call(revisions.trash, { token: '' })).status, 401);
  assert.equal((await call(revisions.read, { params: { slug: 'tide', id: 'x' } })).status, 400);
  assert.equal((await call(revisions.read, { params: { slug: 'tide', id: '99999' } })).status, 404);
});

/* ── Backups ────────────────────────────────────────────────────────── */

test('manual backups are real, consistent SQLite snapshots', async () => {
  const made = await call(data.backupNow, { method: 'POST' });
  assert.equal(made.status, 201);
  assert.match(made.data.name, /^manual-\d{8}-\d{6}(-\d+)?\.db$/);
  assert.equal(made.data.auto, false);

  const file = path.join(process.env.BACKUP_DIR, made.data.name);
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.ok(copy.prepare("SELECT COUNT(*) AS n FROM posts WHERE slug = 'tide'").get().n === 1);
  assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM post_revisions').get().n > 0);
  copy.close();

  const download = await call(data.downloadBackup, { params: { name: made.data.name } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(download.data.subarray(0, 15).toString(), 'SQLite format 3');

  assert.equal((await call(data.downloadBackup, { params: { name: '../archive.db' } })).status, 400);
  assert.equal((await call(data.downloadBackup, { params: { name: 'manual-20000101-000000.db' } })).status, 404);
  assert.equal((await call(data.backups, { token: '' })).status, 401);

  assert.equal((await call(data.deleteBackup, { method: 'DELETE', params: { name: made.data.name } })).status, 204);
  assert.ok(!existsSync(file));
});

test('scheduled backups run when due and prune old automatic snapshots only', () => {
  const dir = process.env.BACKUP_DIR;
  for (const name of readdirSync(dir)) rmSync(path.join(dir, name));
  const HOUR = 3_600_000;
  const t0 = Date.parse('2026-10-01T00:00:00Z');

  const first = runScheduledBackup(t0);
  assert.ok(first?.auto, 'nothing on disk → due immediately');
  utimesSync(path.join(dir, first.name), new Date(t0), new Date(t0));
  assert.equal(runScheduledBackup(t0 + 23 * HOUR), null, 'not due within the interval');

  const manual = path.join(dir, 'manual-20260101-000000.db');
  writeFileSync(manual, 'x');
  utimesSync(manual, new Date(t0 - 100 * HOUR), new Date(t0 - 100 * HOUR));
  writeFileSync(path.join(dir, 'unrelated.txt'), 'ignored');

  for (let day = 1; day <= 3; day++) {
    const made = runScheduledBackup(t0 + day * 25 * HOUR);
    assert.ok(made, `day ${day} is due`);
    utimesSync(path.join(dir, made.name), new Date(t0 + day * 25 * HOUR), new Date(t0 + day * 25 * HOUR));
  }
  const { backups, schedule } = listBackups(t0 + 75 * HOUR);
  assert.equal(backups.filter((b) => b.auto).length, 2, 'BACKUP_KEEP=2 automatic snapshots');
  assert.ok(backups.some((b) => b.name === 'manual-20260101-000000.db'), 'manual backups are never pruned');
  assert.equal(schedule.intervalHours, 24);
  assert.equal(schedule.nextBackupAt, new Date(t0 + 99 * HOUR).toISOString());

  process.env.BACKUP_INTERVAL_HOURS = '0';
  assert.equal(runScheduledBackup(t0 + 1000 * HOUR), null, '0 disables automatic backups');
  assert.equal(listBackups().schedule.nextBackupAt, null);
  delete process.env.BACKUP_INTERVAL_HOURS;
});

/* ── Export / import ────────────────────────────────────────────────── */

test('export → import round-trips every post, drafts and dates included', async () => {
  await create({ title: 'Lantern', body: '# Lantern\n\nlight', tags: ['a', 'b, c'], published: false, created: '2024-05-01 10:00:00', excerpt: 'short' });

  const exported = await call(data.exportZip);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /red-room-archive-\d{8}\.zip/);
  const entries = readZip(exported.data);
  const names = entries.map((e) => e.name);
  assert.equal(names[0], 'manifest.json');
  assert.ok(names.includes('journal/lantern.md'));
  assert.ok(names.includes('site.json'));
  assert.ok(names.includes('entries/writing.json'));
  const manifest = JSON.parse(entries[0].data.toString());
  assert.equal(manifest.format, 'red-room-archive');

  // Wipe the post, then import the archive back.
  await call(posts.remove, { method: 'DELETE', params: { slug: 'lantern' } });
  const report = await call(data.importPosts, {
    method: 'POST', path: '/api/import', body: exported.data, headers: { 'content-type': 'application/zip' },
  });
  assert.equal(report.status, 200);
  assert.deepEqual(report.data.created.map((p) => p.slug), ['lantern']);
  assert.ok(report.data.skipped.length > 0, 'existing posts are skipped by default');
  assert.deepEqual(report.data.errors, []);

  const back = await call(posts.read, { params: { slug: 'lantern' } });
  assert.equal(back.data.markdown, '# Lantern\n\nlight');
  assert.deepEqual(back.data.tags, ['a', 'b, c'].flatMap((t) => t.split(',')).map((t) => t.trim()));
  assert.equal(back.data.published, false);
  assert.equal(back.data.created, '2024-05-01 10:00:00');
  assert.equal(back.data.excerpt, 'short');
});

test('import: single Markdown, conflict modes, dry run, and history on overwrite', async () => {
  const md = (body) => `---\ntitle: Harbor\ndate: 2025-02-03\ntags: [port]\ndraft: false\n---\n\n${body}`;
  const send = (body, query = '') => call(data.importPosts, {
    method: 'POST', path: `/api/import?name=harbor.md${query}`, body, headers: { 'content-type': 'text/markdown' },
  });

  const first = await send(md('one'));
  assert.deepEqual(first.data.created.map((p) => p.slug), ['harbor']);

  const dry = await send(md('two'), '&onConflict=overwrite&dryRun=1');
  assert.equal(dry.data.dryRun, true);
  assert.deepEqual(dry.data.updated.map((p) => p.slug), ['harbor']);
  assert.equal((await call(posts.read, { params: { slug: 'harbor' } })).data.markdown, 'one', 'dry run writes nothing');

  const over = await send(md('two'), '&onConflict=overwrite');
  assert.deepEqual(over.data.updated.map((p) => p.slug), ['harbor']);
  const history = await call(revisions.list, { params: { slug: 'harbor' } });
  assert.equal(history.data.revisions[0].reason, 'import', 'overwritten text is kept in history');

  const same = await send(md('two'), '&onConflict=overwrite');
  assert.deepEqual(same.data.skipped.map((p) => p.slug), ['harbor'], 'identical content is not rewritten');

  const renamed = await send(md('three'), '&onConflict=rename');
  assert.deepEqual(renamed.data.created.map((p) => p.slug), ['harbor-2']);

  assert.equal((await send(md('x'), '&onConflict=merge')).status, 400);
  assert.equal((await call(data.importPosts, { method: 'POST', body: 'x', token: '' })).status, 401);
});

test('import: foreign ZIPs (title from heading, junk ignored, bad files reported)', async () => {
  const zip = createZip([
    { name: 'notes/', data: Buffer.alloc(0) },
    { name: 'notes/first-snow.md', data: Buffer.from('# First Snow\n\nquiet') },
    { name: '__MACOSX/notes/._first-snow.md', data: Buffer.from('junk') },
    { name: 'notes/empty.md', data: Buffer.from('---\ntitle: Empty\n---\n') },
    { name: 'notes/image.png', data: Buffer.from([1, 2, 3]) },
  ]);
  const form = new FormData();
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'notes.zip');
  const report = await call(data.importPosts, { method: 'POST', path: '/api/import', body: form });
  assert.equal(report.status, 200);
  assert.deepEqual(report.data.created, [{ file: 'notes/first-snow.md', slug: 'first-snow', title: 'First Snow' }]);
  assert.deepEqual(report.data.errors.map((e) => e.file), ['notes/empty.md']);
});

test('import: site settings only with ?settings=1, never the Notion token', async () => {
  const zip = createZip([
    { name: 'site.json', data: Buffer.from(JSON.stringify({ settings: { site_name: 'Imported Name', NOTION_TOKEN: 'secret_x' } })) },
  ]);
  const send = (query) => call(data.importPosts, { method: 'POST', path: `/api/import${query}`, body: zip, headers: { 'content-type': 'application/zip' } });
  assert.deepEqual((await send('')).data.settings, []);
  const applied = await send('?settings=1');
  assert.deepEqual(applied.data.settings, ['site_name']);

  const exported = readZip((await call(data.exportZip)).data);
  const site = JSON.parse(exported.find((e) => e.name === 'site.json').data.toString());
  assert.equal(site.settings.site_name, 'Imported Name');
  assert.equal(site.settings.NOTION_TOKEN, undefined);
});
