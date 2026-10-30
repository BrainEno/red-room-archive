// Verify a stopped Node instance can be migrated with a SQLite backup and all uploads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

async function start(dir) {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    DB_PATH: path.join(dir, 'archive.db'), UPLOAD_DIR: path.join(dir, 'uploads'), MEDIA_CACHE_DIR: path.join(dir, 'media'),
    ADMIN_TOKEN: 'test-admin', NOTION_TOKEN: '', NOTION_API_SECRET: '', NOTION_DATABASE_ID: '', DATABASE_ID: '', NOTION_DB_WRITING: '',
    NOTION_API_BASE: 'http://127.0.0.1:1/v1', SITE_URL: 'https://example.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(new Error(`startup timed out: ${log}`)), 20000);
    const data = (chunk) => { log += chunk; if (log.includes('Server listening')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', data); child.stderr.on('data', data);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${log}`)); });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}
async function stop(server) { if (server?.child.exitCode === null && server.child.signalCode === null) { server.child.kill(); await once(server.child, 'exit'); } }
const auth = { Authorization: 'Bearer test-admin' };

test('Node stopped-instance backup and restore preserves settings, More, uploads and first publication dates', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rra-node-migration-'));
  const source = path.join(dir, 'source'); const target = path.join(dir, 'target');
  await mkdir(source); await mkdir(target);
  let server;
  try {
    server = await start(source);
    const json = async (url, options = {}) => {
      const result = await fetch(server.base + url, options);
      assert.ok(result.ok, `${url}: ${result.status} ${await result.clone().text()}`);
      return result.json();
    };
    await json('/api/settings', { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_name: 'Migrated Archive', site_intro_zh: '迁移验证', NOTION_TOKEN: 'mock-private-token', NOTION_DATABASE_ID: '0123456789abcdef0123456789abcdef' }) });
    const doc = (await json('/api/more/document', { headers: auth })).document;
    doc.intro.en = 'Migrated More description';
    const cover = await json('/api/uploads?name=cover.png', { method: 'POST', headers: auth, body: Buffer.from('example cover bytes') });
    await json('/api/uploads?name=model.glb&as=model', { method: 'POST', headers: auth, body: Buffer.from('example model bytes') });
    doc.publications[0].cover = cover.url;
    await json('/api/more/document', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
    await stop(server); server = undefined;
    const sourceDb = new Database(path.join(source, 'archive.db'));
    sourceDb.prepare('INSERT OR REPLACE INTO notion_first_publication(database_id,page_id,date) VALUES (?,?,?)').run('db', 'page', '2020-01-02');
    // SQLite's backup API produces a consistent single DB even if a WAL exists.
    await sourceDb.backup(path.join(target, 'archive.db')); sourceDb.close();
    await cp(path.join(source, 'uploads'), path.join(target, 'uploads'), { recursive: true });
    server = await start(target);
    const settings = await json('/api/settings', { headers: auth });
    assert.equal(settings.values.site_name, 'Migrated Archive');
    assert.equal(settings.values.site_intro_zh, '迁移验证');
    assert.equal(settings.values.NOTION_DATABASE_ID, '0123456789abcdef0123456789abcdef');
    assert.equal(settings.values.NOTION_TOKEN, '••••oken');
    const restored = (await json('/api/more/document', { headers: auth })).document;
    assert.equal(restored.intro.en, 'Migrated More description');
    assert.equal(restored.publications[0].cover, cover.url);
    assert.equal(await (await fetch(server.base + cover.url)).text(), 'example cover bytes');
    assert.equal(await (await fetch(server.base + '/uploads/venus.glb')).text(), 'example model bytes');
    await stop(server); server = undefined;
    const db = new Database(path.join(target, 'archive.db'), { readonly: true });
    assert.equal(db.prepare('SELECT date FROM notion_first_publication WHERE database_id = ? AND page_id = ?').get('db', 'page').date, '2020-01-02');
    db.close();
  } finally { await stop(server); await rm(dir, { recursive: true, force: true }); }
});
