import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

test('layout font resolves to an installed Archivo face with the width axis', async () => {
  const layout = await readFile(new URL('../src/ui/layouts/Base.astro', import.meta.url), 'utf8');
  assert.match(layout, /import\s+['"]@fontsource-variable\/archivo\/wdth\.css['"]/);

  const cssPath = require.resolve('@fontsource-variable/archivo/wdth.css');
  const css = await readFile(cssPath, 'utf8');
  assert.match(css, /font-family:\s*['"]Archivo Variable['"]/);
  assert.match(css, /font-stretch:\s*62%\s+125%/);
  assert.match(css, /font-weight:\s*100\s+900/);
  const files = [...css.matchAll(/url\((\.\/files\/[^)]+\.woff2)\)/g)];
  assert.ok(files.length > 0, 'width-axis font files must be referenced');
  await Promise.all(files.map(([, file]) => access(resolve(dirname(cssPath), file))));
});
