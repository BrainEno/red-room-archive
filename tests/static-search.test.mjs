import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../scripts/static-search.js', import.meta.url), 'utf8');
function element(tag) {
  return { tag, children: [], attributes: {}, textContent: '', append(...nodes) { this.children.push(...nodes); }, setAttribute(name, value) { this.attributes[name] = value; } };
}
const item = { title: '<img src=x onerror=alert(1)>', excerpt: 'Example', tags: ['小说'], searchTags: ['小说', 'Fiction'], text: 'A unique passage', date: '2020-01-01', href: '/zh-CN/articles/safe' };
async function search(query, fail = false, basePath = '') {
  const input = element('input'), section = element('section');
  const document = { documentElement: { lang: 'zh-CN', dataset: basePath ? { basePath } : undefined }, createElement: element, querySelector(selector) { return selector === '#q' ? input : section; } };
  let requested = '';
  await runInNewContext(script, { document, location: { search: `?q=${encodeURIComponent(query)}` }, URLSearchParams, fetch: async (url) => { requested = url; return { ok: !fail, json: async () => ({ 'zh-CN': [item] }) }; } });
  return { section, input, requested };
}
test('static search matches localized aliases and creates safe DOM text', async () => {
  const { section, input } = await search('Fiction');
  assert.equal(input.value, 'Fiction');
  assert.match(section.children[0].textContent, /1 条结果/);
  const link = section.children[1].children[0].children[0].children[0];
  assert.equal(link.href, '/zh-CN/articles/safe');
  assert.equal(link.children[1].children[0].textContent, item.title);
  assert.equal(link.children[1].children[0].children.length, 0, 'title must not be parsed as HTML');
});
test('static search loads its index from a static project base path', async () => {
  const { requested } = await search('Fiction', false, '/red-room-archive');
  assert.equal(requested, '/red-room-archive/static-search.json');
});

test('static search reports a failed index request', async () => {
  const { section } = await search('hello', true);
  assert.match(section.children[0].textContent, /搜索暂时不可用/);
});
