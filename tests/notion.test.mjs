// Notion client, mapper and block-tree fetcher (fetch is replaced by a fake).
import test from 'node:test';
import assert from 'node:assert/strict';
import { API, ID, compact, createNotionMock } from './fixtures/notion-mock.mjs';

process.env.NOTION_API_BASE = API;
process.env.TZ = 'UTC';
const { NotionClient } = await import('../src/server/notion/client.ts');
const { coverSource, describeSchema, parseNotionId, resolveMapping, toArticles } = await import('../src/server/notion/mapper.ts');
const { fetchBlockTree } = await import('../src/server/notion/tree.ts');
const { legacyTarget } = await import('../src/server/http/endpoints/legacy.ts');

const realFetch = globalThis.fetch;
test.after(() => (globalThis.fetch = realFetch));

const mock = createNotionMock();
const NOW = Date.parse('2026-10-27T00:00:00Z');

test('toArticles keeps published, dated, titled pages and gives twins distinct slugs', () => {
  const { rows, covers, skipped } = toArticles(mock.state.pages, NOW);
  assert.deepEqual(rows.map((r) => r.slug), ['first-light', '第二篇', 'first-light-2']);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ['scheduled', 'unpublished', 'untitled']);
  assert.deepEqual(covers, [{ id: compact(ID.first), articleId: ID.first }]);
  const first = rows[0];
  assert.deepEqual(first.tags, ['Fiction']);
  assert.equal(first.date, '2026-10-01');
  assert.equal(first.rank, 2);
  assert.equal(first.cover, `/media/notion/${compact(ID.first)}`);
});

test('toArticles orders by the Notion date-time (offsets compared as instants), then creation time', () => {
  const at = (source, date, created) => ({ ...structuredClone(source), id: crypto.randomUUID(), created_time: created,
    properties: { ...structuredClone(source.properties), Date: { id: 'd', type: 'date', date: { start: date, end: null } },
      Page: { id: 'title', type: 'title', title: [{ type: 'text', plain_text: date + created, text: { content: date + created } }] } } });
  const base = mock.state.pages[0];
  const pages = [
    at(base, '2026-10-28', '2026-10-20T00:00:00.000Z'),
    at(base, '2026-10-28T07:00:00.000+08:00', '2026-10-01T00:00:00.000Z'),
    at(base, '2026-10-28T09:00:00.000+08:00', '2026-10-01T00:00:00.000Z'),
    at(base, '2026-10-28', '2026-10-25T00:00:00.000Z'),
  ];
  const { rows } = toArticles(pages, Date.parse('2026-11-01T00:00:00Z'));
  assert.deepEqual(rows.map((r) => [r.date, r.created]), [
    ['2026-10-28T09:00:00.000+08:00', '2026-10-01T00:00:00.000Z'],
    ['2026-10-28', '2026-10-25T00:00:00.000Z'],
    ['2026-10-28', '2026-10-20T00:00:00.000Z'],
    ['2026-10-28T07:00:00.000+08:00', '2026-10-01T00:00:00.000Z'],
  ]);
});

test('the older page keeps the bare slug even when listed after its twin', () => {
  const reversed = [...mock.state.pages].reverse();
  const { rows } = toArticles(reversed, NOW);
  assert.equal(rows.find((r) => r.id === ID.first).slug, 'first-light');
  assert.equal(rows.find((r) => r.id === ID.twin).slug, 'first-light-2');
});

test('resolveMapping matches aliases by name *and* type, title by type', () => {
  const mapping = resolveMapping({
    Name: 'title', Status: 'status', 'Publish Date': 'date', 标签: 'multi_select', Summary: 'rich_text', Cover: 'url', Featured: 'checkbox', Date: 'rich_text',
  });
  assert.equal(mapping.title.property, 'Name');
  assert.equal(mapping.published.property, 'Status');
  assert.equal(mapping.date.property, 'Publish Date', 'a text column called "Date" is not a date');
  assert.equal(mapping.tags.property, '标签');
  assert.equal(mapping.excerpt.property, 'Summary');
  assert.equal(mapping.cover.property, 'Cover');
  assert.equal(mapping.rank.property, 'Featured');
  assert.equal(mapping.slug, null);
});

test('Published formula is treated as a privacy flag rather than a date', () => {
  const mapping = resolveMapping({ Name: 'title', Published: 'formula' });
  assert.equal(mapping.published.property, 'Published');
  assert.equal(mapping.date, null);
  const base = { created_time: '2020-01-01T00:00:00Z', last_edited_time: '2020-01-01T00:00:00Z' };
  const page = (id, formula) => ({ ...base, id, properties: { Name: { type: 'title', title: [{ plain_text: id }] }, Published: { type: 'formula', formula } } });
  const result = toArticles([page('on', { type: 'boolean', boolean: true }), page('off', { type: 'boolean', boolean: false }), page('unknown', { type: 'number', number: 1 })], NOW);
  assert.deepEqual(result.rows.map((row) => row.id), ['on']);
});

test('status/select publish flags, first-seen date fallback and page covers', () => {
  const base = { created_time: '2026-01-02T03:04:05.000Z', last_edited_time: '2026-01-02T03:04:05.000Z' };
  const title = (t) => ({ type: 'title', title: [{ plain_text: t }] });
  const pages = [
    { ...base, id: 'a'.repeat(32), properties: { Name: title('Live one'), Status: { type: 'status', status: { name: 'Published' } } }, cover: { type: 'external', external: { url: 'https://img.test/a.jpg' } } },
    { ...base, id: 'b'.repeat(32), properties: { Name: title('Draft one'), Status: { type: 'status', status: { name: 'Draft' } } } },
    { ...base, id: 'c'.repeat(32), properties: { Name: title('No flag') } },
    { ...base, id: 'd'.repeat(32), archived: true, properties: { Name: title('Archived') } },
  ];
  const { rows } = toArticles(pages, NOW);
  assert.deepEqual(rows.map((r) => r.title).sort(), ['Live one']);
  assert.equal(rows.find((r) => r.title === 'Live one').cover, 'https://img.test/a.jpg', "falls back to the page's own cover");
  assert.equal(rows[0].date, '2026-10-27');
  assert.equal(coverSource({ ...pages[0], cover: { type: 'file', file: { url: 'https://s3.test/x' } } }).kind, 'file');
});

test('describeSchema warns about missing Published/Date and mistyped columns', () => {
  const schema = describeSchema('db', {
    id: 'db', title: [{ plain_text: 'Notes' }],
    properties: { Name: { name: 'Name', type: 'title' }, Tags: { name: 'Tags', type: 'rich_text' } },
  });
  assert.equal(schema.database.title, 'Notes');
  assert.equal(schema.mapping.title.property, 'Name');
  assert.equal(schema.mapping.tags.property, null);
  assert.equal(schema.warnings.length, 3);
  assert.match(schema.warnings.join('\n'), /no pages will be public/);
  assert.match(schema.warnings.join('\n'), /"Tags" is a rich_text column/);
});

test('parseNotionId accepts ids, dashed ids and pasted links; rejects the rest', () => {
  const id = '0123456789abcdef0123456789abcdef';
  assert.equal(parseNotionId(id.toUpperCase()), id);
  assert.equal(parseNotionId('01234567-89ab-cdef-0123-456789abcdef'), id);
  assert.equal(parseNotionId(`https://www.notion.so/team/My-Blog-${id}?v=ffffffffffffffffffffffffffffffff`), id);
  assert.equal(parseNotionId('https://www.notion.so/team/My-Blog'), null);
  assert.equal(parseNotionId(''), null);
  assert.equal(parseNotionId('../x'), null);
});

test('client retries 429/5xx, then reports failures without leaking bodies', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '0.01' } });
    if (calls === 2) return new Response('{}', { status: 503, headers: { 'retry-after': '0.01' } });
    return Response.json({ ok: true });
  };
  assert.deepEqual(await new NotionClient('t').request('/x'), { ok: true });
  assert.equal(calls, 3);

  globalThis.fetch = async () => new Response('{"message":"workspace secret"}', { status: 401 });
  await assert.rejects(new NotionClient('t').request('/x'), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.details.notionStatus, 401);
    assert.doesNotMatch(error.message, /workspace secret/);
    return true;
  });

  let tries = 0;
  globalThis.fetch = async () => { tries += 1; return new Response('', { status: 429, headers: { 'retry-after': '0.01' } }); };
  await assert.rejects(new NotionClient('t').request('/x'), /rate limit/);
  assert.equal(tries, 3, 'gives up after two retries');
});

test('fetchBlockTree attaches children, follows synced blocks, skips child pages', async () => {
  globalThis.fetch = mock.fetch;
  mock.state.calls.length = 0;
  const tree = await fetchBlockTree(new NotionClient('t'), ID.first);
  const byType = (type) => tree.find((b) => b.type === type);
  assert.equal(byType('toggle').children[0].paragraph.rich_text[0].plain_text, 'Hidden paragraph about owls.');
  assert.equal(byType('table').children.length, 2);
  assert.equal(byType('synced_block').children[0].type, 'quote');
  assert.equal(byType('child_page').children, undefined);
  assert.ok(!mock.state.calls.some((c) => c.url.includes(compact(ID.child))), 'child page content is never requested');
});

test('legacy URLs map onto /articles', () => {
  const none = new URLSearchParams();
  assert.equal(legacyTarget(undefined, none), '/articles');
  assert.equal(legacyTarget('first-light', none), '/articles/first-light');
  assert.equal(legacyTarget('tag/%E5%B0%8F%E8%AF%B4', none), `/articles?tag=${encodeURIComponent('小说')}`);
  assert.equal(legacyTarget(undefined, new URLSearchParams('tag=notes')), '/articles?tag=notes');
  assert.equal(legacyTarget('a/b/c', none), '/articles');
});


test('database-page error is actionable without echoing Notion details', async () => {
  globalThis.fetch = async () => Response.json({ object: 'error', message: 'Provided ID secret-id is a page, not a database. Use the retrieve page API instead' }, { status: 400 });
  try {
    await assert.rejects(new NotionClient('secret-token').database('id'), (error) => {
      assert.match(error.message, /page link, not the database/);
      assert.doesNotMatch(error.message, /secret-id|secret-token/);
      assert.equal(error.details.notionStatus, 400);
      return true;
    });
  } finally { globalThis.fetch = realFetch; }
});

test('block tree limits concurrency across the whole article and preserves sibling order', async () => {
  let active = 0, peak = 0;
  const block = (id, children = true) => ({ id, type: 'toggle', has_children: children });
  const client = { async blockChildren(id) {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (id === 'root') return ['a', 'b', 'c', 'd'].map((x) => block(x));
    if (id.length === 1) return [block(id + '1'), block(id + '2')];
    return [block(id + 'leaf', false)];
  } };
  const tree = await fetchBlockTree(client, 'root');
  assert.equal(peak, 3);
  assert.deepEqual(tree.map((b) => b.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(tree[0].children.map((b) => b.id), ['a1', 'a2']);
  assert.equal(tree[3].children[1].children[0].id, 'd2leaf');
});

test('block tree rejects depth and block overflow, but accepts exact limits', async () => {
  const chain = (last) => ({ async blockChildren(id) {
    const depth = Number(id);
    return [{ id: String(depth + 1), type: 'toggle', has_children: depth < last }];
  } });
  await fetchBlockTree(chain(8), '0');
  await assert.rejects(fetchBlockTree(chain(9), '0'), /nesting depth limit/);
  const blocks = (count) => Array.from({ length: count }, (_, i) => ({ id: String(i), type: 'paragraph' }));
  await fetchBlockTree({ async blockChildren() { return blocks(5000); } }, 'root');
  await assert.rejects(fetchBlockTree({ async blockChildren() { return blocks(5001); } }, 'root'), /5000 block limit/);
  // Concurrent branches may each fit their initial remaining budget but exceed it together.
  const nested = { async blockChildren(id) {
    if (id === 'root') return [{ id: 'a', type: 'toggle', has_children: true }, { id: 'b', type: 'toggle', has_children: true }];
    await new Promise((resolve) => setTimeout(resolve, 2));
    return blocks(3000);
  } };
  await assert.rejects(fetchBlockTree(nested, 'root'), /5000 block limit/);
});

test('client rejects missing, repeated and unbounded pagination cursors', async () => {
  const client = new NotionClient('t');
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ results: [], has_more: true, next_cursor: 'same' }); };
  await assert.rejects(client.queryDatabase('db'), /repeated Notion pagination cursor/);
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(client.blockChildren('block'), /repeated Notion pagination cursor/);
  assert.equal(count, 2);
  globalThis.fetch = async () => Response.json({ results: [], has_more: true, next_cursor: null });
  await assert.rejects(client.queryDatabase('db'), /pagination cursor/);
  count = 0;
  globalThis.fetch = async () => Response.json({ results: [], has_more: true, next_cursor: String(++count) });
  await assert.rejects(client.blockChildren('block'), /1000 page limit/);
  assert.equal(count, 1000);
  globalThis.fetch = async () => Response.json({ results: [{ id: 'a' }, { id: 'b' }], has_more: false, next_cursor: null });
  await assert.rejects(client.blockChildren('block', 1), /5000 block limit/);
});

test('a failed tree walk waits for in-flight siblings and starts no further work', async () => {
  let active = 0;
  const calls = [];
  const client = { async blockChildren(id) {
    calls.push(id);
    if (id === 'root') return ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'toggle', has_children: true }));
    active++;
    try {
      if (id === 'a') throw new Error('upstream failure');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [];
    } finally { active--; }
  } };
  await assert.rejects(fetchBlockTree(client, 'root'), /upstream failure/);
  assert.equal(active, 0);
  assert.ok(!calls.includes('d'));
});
