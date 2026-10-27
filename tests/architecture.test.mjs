// Enforces the layering described in docs/ARCHITECTURE.md by reading imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

/** Resolved, src-relative paths of every relative import in a file. */
function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const out = [];
  for (const match of text.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (!spec?.startsWith('.')) continue;
    out.push(path.relative(root, path.resolve(path.dirname(file), spec)).split(path.sep).join('/'));
  }
  return out;
}

const files = walk(root).filter((file) => /\.(ts|astro|mjs)$/.test(file));
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
const violations = (predicate, rule) =>
  files.flatMap((file) => importsOf(file).filter((target) => predicate(rel(file), target)).map((target) => `${rel(file)} → ${target} (${rule})`));

test('shared/ and core/ are framework-free leaves (no server, ui or content imports)', () => {
  const bad = violations(
    (from, to) => (from.startsWith('shared/') || from.startsWith('core/')) && /^(server|ui|pages)\//.test(to),
    'leaf layer',
  );
  assert.deepEqual(bad, []);
});

test('ui/ never imports server code — views receive data through props', () => {
  const bad = violations((from, to) => from.startsWith('ui/') && /^(server|pages)\//.test(to), 'ui must stay presentational');
  assert.deepEqual(bad, []);
});

test('server/ never imports ui/', () => {
  const bad = violations((from, to) => from.startsWith('server/') && to.startsWith('ui/'), 'server must not depend on ui');
  assert.deepEqual(bad, []);
});

test('API routes only delegate to server/http/endpoints', () => {
  const bad = violations(
    (from, to) => from.startsWith('pages/api/') && !to.startsWith('server/http/endpoints/'),
    'api routes are adapters',
  );
  assert.deepEqual(bad, []);
});

/** Non-API routes that are pure HTTP adapters (file serving, redirects). */
const ROUTE_ADAPTERS = [
  ['pages/uploads/', 'server/http/endpoints/uploads.ts'],
  ['pages/media/', 'server/http/endpoints/media.ts'],
  ['pages/works/', 'server/http/endpoints/legacy.ts'],
  ['pages/writing/', 'server/http/endpoints/legacy.ts'],
  ['pages/journal/', 'server/http/endpoints/legacy.ts'],
  ['pages/posts/', 'server/http/endpoints/legacy.ts'],
];

test('page routes read data only through server/queries.ts', () => {
  const bad = violations(
    (from, to) => from.startsWith('pages/') && !from.startsWith('pages/api/') && to.startsWith('server/') &&
      to !== 'server/queries.ts' && !ROUTE_ADAPTERS.some(([dir, target]) => from.startsWith(dir) && to === target),
    'pages use the read facade',
  );
  assert.deepEqual(bad, []);
});

test('only server/db/connection.ts touches better-sqlite3', () => {
  const offenders = files
    .filter((file) => /from\s+['"]better-sqlite3['"]/.test(readFileSync(file, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, ['server/db/connection.ts']);
});

test('the site never writes to Notion (read-only client)', () => {
  const client = readFileSync(path.join(root, 'server/notion/client.ts'), 'utf8');
  assert.doesNotMatch(client, /method:\s*['"](PATCH|PUT|DELETE)['"]/);
  // The only POST is the database query (Notion's read endpoint uses POST).
  const posts = [...client.matchAll(/method:\s*['"]POST['"]/g)].length;
  assert.equal(posts, 1);
  const offenders = files
    .filter((file) => !file.endsWith('server/notion/client.ts'))
    .filter((file) => /api\.notion\.com/.test(readFileSync(file, 'utf8')) && !file.endsWith('server/config.ts'))
    .map(rel);
  assert.deepEqual(offenders, []);
});
