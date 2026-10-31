// Local-only test servers. Never point browser tests at a real database or token.
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const snapshot = path.join(root, '.ui-test-snapshot');
const temp = await mkdtemp(path.join(tmpdir(), 'rra-ui-'));
const env = { ...process.env, HOST: '127.0.0.1', PORT: '4180', SITE_URL: 'https://example.invalid',
  DB_PATH: path.join(temp, 'site.db'), MEDIA_CACHE_DIR: path.join(temp, 'media'), UPLOAD_DIR: path.join(temp, 'uploads'),
  ADMIN_TOKEN: 'ui-test-only', NOTION_API_BASE: 'http://127.0.0.1:1/v1', NOTION_TOKEN: '', NOTION_API_SECRET: '', NOTION_DATABASE_ID: '', DATABASE_ID: '', NOTION_DB_WRITING: '' };
const child = spawn(process.execPath, [path.join(root, 'dist/server/entry.mjs')], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
let ready = false;
child.stdout.on('data', (chunk) => { process.stdout.write(chunk); if (chunk.toString().includes('Server listening')) ready = true; });
child.stderr.pipe(process.stderr);
child.on('exit', (code) => { if (!stopping) { console.error(`SSR server exited: ${code}`); void shutdown(1); } });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const staticServer = createServer(async (req, res) => {
  if (req.url === '/__ready') { res.writeHead(ready ? 200 : 503).end(); return; }
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    else if (!path.extname(pathname)) pathname += '/index.html';
    const file = path.resolve(snapshot, '.' + pathname);
    if (!file.startsWith(snapshot + path.sep)) throw new Error('Invalid path');
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(404).end('Not found'); }
});
staticServer.listen(4181, '127.0.0.1');

// Browser offline emulation does not consistently apply to service-worker
// requests (and WebKit can fail the reload itself). These local proxies can
// refuse the origin connection instead, exercising the real worker fallback in
// every engine. The control route remains available so tests can restore it.
const outage = { ssr: new Map(), static: new Map() };
function proxy(port, target, key) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/__harness/outage' && req.method === 'POST') {
      const id = url.searchParams.get('id') || '';
      if (!/^[a-z0-9-]+$/.test(id)) { res.writeHead(400).end(); return; }
      const value = url.searchParams.get('value');
      if (value === '1' || value === '503') outage[key].set(id, value);
      else outage[key].delete(id);
      res.writeHead(204, { 'cache-control': 'no-store' }).end();
      return;
    }
    // Only the context carrying this test-only cookie is disconnected. CI runs
    // two workers against the same origins, so a global switch would race.
    const id = /(?:^|;\s*)rra_harness_outage=([a-z0-9-]+)/.exec(req.headers.cookie || '')?.[1];
    const mode = id && outage[key].get(id);
    if (mode === '503') { res.writeHead(503, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<h1>Origin unavailable</h1>'); return; }
    if (mode) { req.socket.destroy(); return; }
    const upstream = httpRequest({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.listen(port, '127.0.0.1');
  return server;
}
const proxies = [proxy(4178, 4180, 'ssr'), proxy(4179, 4181, 'static')];

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  staticServer.close();
  for (const server of proxies) server.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); }
  await rm(temp, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
