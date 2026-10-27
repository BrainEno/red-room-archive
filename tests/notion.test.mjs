import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveItem, createItem, fetchBody, fetchKind, updateItem } from '../src/lib/notion.ts';

// 用假的 fetch 代替 Notion API：验证我们发出去的请求与解析回来的数据。
const calls = [];
const schema = { properties: {
  Name: { type: 'title' }, Slug: { type: 'rich_text' }, Year: { type: 'number' }, Type: { type: 'select' },
  Published: { type: 'checkbox' }, Date: { type: 'date' }, Tags: { type: 'multi_select' }, Link: { type: 'url' },
} };
const page = { id: 'abcd1234abcd1234abcd1234abcd1234', url: 'https://www.notion.so/x' };
let childBlocks = [];
let queryResults = [];

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ url: u, method: init.method ?? 'GET', body });
  if (u.endsWith('/query')) return json({ results: queryResults, has_more: false });
  if (/\/databases\/[^/]+$/.test(u)) return json(schema);
  if (u.endsWith('/pages') && init.method === 'POST') return json(page);
  if (/\/pages\/[^/]+$/.test(u)) return json(page);
  if (u.includes('/children')) {
    if (init.method === 'PATCH') return json({ results: [] });
    return json({ results: childBlocks, has_more: false });
  }
  if (/\/blocks\/[^/]+$/.test(u) && init.method === 'DELETE') return json({});
  return json({});
};

process.env.NOTION_TOKEN = 'secret_test';
process.env.NOTION_DB_WRITING = 'db-writing';

const reset = () => { calls.length = 0; childBlocks = []; queryResults = []; };
test.after(() => { globalThis.fetch = realFetch; });

test('createItem maps aliases and encodes each property by its real type', async () => {
  reset();
  await createItem('writing', {
    title: 'A Quiet Room', slug: 'a-quiet-room', year: 2026, type: 'Essay',
    published: true, date: '2026-01-02', tags: 'red, room', link: 'https://example.test/x',
    body: '# Title\n\nparagraph',
  });
  const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pages'));
  assert.ok(post, 'POST /pages was sent');
  const p = post.body.properties;
  assert.deepEqual(p.Name, { title: [{ text: { content: 'A Quiet Room' } }] });
  assert.deepEqual(p.Slug, { rich_text: [{ text: { content: 'a-quiet-room' } }] });
  assert.deepEqual(p.Year, { number: 2026 });
  assert.deepEqual(p.Type, { select: { name: 'Essay' } });   // 回归：select/status 需要同名的外层键
  assert.deepEqual(p.Published, { checkbox: true });
  assert.deepEqual(p.Date, { date: { start: '2026-01-02' } });
  assert.deepEqual(p.Tags.multi_select, [{ name: 'red' }, { name: 'room' }]);
  assert.deepEqual(p.Link, { url: 'https://example.test/x' });
  assert.equal(post.body.parent.database_id, 'db-writing');
  assert.equal(post.body.children[0].type, 'heading_1');
  assert.equal(post.body.children[1].type, 'paragraph');
});

test('createItem ignores fields that do not match a database column', async () => {
  reset();
  await createItem('writing', { title: 'X', nonsense: 'ignored' });
  const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pages'));
  assert.deepEqual(Object.keys(post.body.properties), ['Name']);
});

test('updateItem patches only the given properties and leaves the body alone', async () => {
  reset();
  await updateItem('writing', page.id, { year: 2027 });
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/pages/'));
  assert.deepEqual(patch.body.properties, { Year: { number: 2027 } });
  assert.ok(!calls.some((c) => c.method === 'DELETE'), 'body untouched → no block deletion');
});

test('updateItem with body replaces the page content (delete old blocks, append new)', async () => {
  reset();
  childBlocks = [{ id: 'b1', type: 'paragraph', paragraph: { rich_text: [] } }, { id: 'b2', type: 'paragraph', paragraph: { rich_text: [] } }];
  await updateItem('writing', page.id, { title: 'New', body: '- one\n- two' });
  const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop()).sort();
  assert.deepEqual(deleted, ['b1', 'b2']);
  const append = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/children')).at(-1);
  assert.equal(append.body.children.length, 2);
  assert.equal(append.body.children[0].type, 'bulleted_list_item');
});

test('updateItem rejects malformed page ids before calling Notion', async () => {
  reset();
  await assert.rejects(updateItem('writing', '../../databases/x', { title: 'x' }), /invalid page id/);
  assert.equal(calls.length, 0);
});

test('archiveItem sends archived:true', async () => {
  reset();
  await archiveItem(page.id);
  assert.deepEqual(calls[0].body, { archived: true });
  assert.equal(calls[0].method, 'PATCH');
});

test('fetchBody renders supported blocks and drops unsafe media', async () => {
  reset();
  childBlocks = [
    { id: 'b1', type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Hi' }] } },
    { id: 'b2', type: 'image', image: { type: 'external', external: { url: 'javascript:alert(1)' } } },
    { id: 'b3', type: 'image', image: { type: 'external', external: { url: 'https://cdn.test/a.png' } } },
  ];
  const html = await fetchBody(page.id);
  assert.match(html, /<h2>Hi<\/h2>/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
});

test('fetchKind reads paginated results, lowercases keys and skips unpublished pages', async () => {
  reset();
  queryResults = [
    { id: '1', created_time: '2026-03-01T00:00:00Z', last_edited_time: '2026-03-02T00:00:00Z',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Published Piece' }] }, Slug: { type: 'rich_text', rich_text: [{ plain_text: 'piece' }] }, Year: { type: 'number', number: 2026 } } },
    { id: '2', created_time: '2026-03-01T00:00:00Z', last_edited_time: '2026-03-02T00:00:00Z',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Draft Piece' }] }, Published: { type: 'checkbox', checkbox: false } } },
  ];
  const items = await fetchKind('writing');
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, 'piece');
  assert.equal(items[0].data.year, 2026);
  assert.equal(items[0].data.name, 'Published Piece');
});
