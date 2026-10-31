/** Report browser JavaScript bytes without adding a build dependency. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const client = path.resolve(process.argv[2] || 'dist/client');
const directory = path.join(client, '_astro');
const files = [];
for (const name of await readdir(directory)) {
  if (!name.endsWith('.js')) continue;
  const body = await readFile(path.join(directory, name));
  files.push({ file: name, bytes: body.byteLength, gzip: gzipSync(body).byteLength });
}
files.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
console.log(JSON.stringify({
  directory: path.relative(process.cwd(), directory),
  files,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  totalGzip: files.reduce((sum, file) => sum + file.gzip, 0),
}, null, 2));
