import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const start = (child) => new Promise((resolve, reject) => {
  let log = ''; const timer = setTimeout(() => reject(new Error(`server timeout ${log}`)), 20000);
  const onData = (data) => { log += data; if (log.includes('Server listening')) { clearTimeout(timer); resolve(); } };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${log}`)); });
});

test('chunked JSON, multipart and raw requests are limited and later requests remain usable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rra-http-limit-'));
  const reservation = createTcpServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(dir, 'db'), UPLOAD_DIR: path.join(dir, 'uploads'), MEDIA_CACHE_DIR: path.join(dir, 'media'), ADMIN_TOKEN: 'limit-token', NOTION_TOKEN: '', NOTION_DATABASE_ID: '', MAX_JSON_KB: '1', MAX_UPLOAD_MB: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const request = (url, { method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers, agent }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
  try {
    await start(child);
    const token = { authorization: 'Bearer limit-token' };
    const json = await request('/api/settings', { method: 'PATCH', headers: { ...token, 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, body: JSON.stringify({ site_name: 'x'.repeat(3000) }) });
    assert.equal(json.status, 413, json.body); assert.equal(json.headers.connection, 'close');
    assert.equal((await request('/api/health')).status, 200);
    const declared = await request('/api/settings', { method: 'PATCH', headers: { ...token, 'content-type': 'application/json', 'content-length': '9999' }, body: '{}' });
    assert.equal(declared.status, 413);
    assert.equal(declared.headers.connection, 'close');
    assert.equal((await request('/api/health')).status, 200);
    const boundary = 'rra-boundary';
    const form = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n${'x'.repeat(2 * 1024 * 1024 + 100)}\r\n--${boundary}--\r\n`;
    const multi = await request('/api/uploads', { method: 'POST', headers: { ...token, 'content-type': `multipart/form-data; boundary=${boundary}`, 'transfer-encoding': 'chunked' }, body: form });
    assert.equal(multi.status, 413, multi.body); assert.equal(multi.headers.connection, 'close');
    assert.equal((await request('/api/health')).status, 200);
    const raw = await request('/api/uploads?name=big.mp3', { method: 'POST', headers: { ...token, 'content-type': 'audio/mpeg', 'transfer-encoding': 'chunked' }, body: 'x'.repeat(1024 * 1024 + 1000) });
    assert.equal(raw.status, 413, raw.body); assert.equal((await request('/api/health')).status, 200);
    const valid = await request('/api/uploads?name=small.mp3', { method: 'POST', headers: { ...token, 'content-type': 'audio/mpeg', 'transfer-encoding': 'chunked' }, body: 'hello' });
    assert.equal(valid.status, 201, valid.body);
    const smallForm = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="small.png"\r\nContent-Type: image/png\r\n\r\nabc\r\n--${boundary}--\r\n`;
    const validMultipart = await request('/api/uploads', { method: 'POST', headers: { ...token, 'content-type': `multipart/form-data; boundary=${boundary}`, 'transfer-encoding': 'chunked' }, body: smallForm });
    assert.equal(validMultipart.status, 201, validMultipart.body);
    for (let i = 1; i <= 12; i++) {
      const badLogin = await request('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i}` }, body: JSON.stringify({ token: 'wrong' }) });
      assert.equal(badLogin.status, 401);
    }
    const locked = await request('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.100' }, body: JSON.stringify({ token: 'limit-token' }) });
    assert.equal(locked.status, 429, 'rotating spoofed forwarding headers cannot evade the limit');
  } finally { agent.destroy(); if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } await rm(dir, { recursive: true, force: true }); }
});
