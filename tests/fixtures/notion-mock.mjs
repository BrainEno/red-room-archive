// A fake Notion API + file host, shaped like the BrainEno/astro-notion blog
// database (Page, Slug, Date, Published, Tags, Excerpt, FeaturedImage, Rank).
//
// `createNotionMock()` returns a `fetch` replacement for unit tests;
// `node tests/fixtures/notion-mock.mjs [port]` serves the same data over HTTP
// so a built server can be smoke-tested with NOTION_API_BASE=http://…/v1.

import zlib from 'node:zlib';

export const DB = '0123456789abcdef0123456789abcdef';
export const API = 'https://notion.test/v1';
export const FILES = 'https://files.test';

export const ID = {
  first: '11111111-1111-4111-8111-111111111111',
  second: '22222222-2222-4222-8222-222222222222',
  draft: '33333333-3333-4333-8333-333333333333',
  future: '44444444-4444-4444-8444-444444444444',
  untitled: '55555555-5555-4555-8555-555555555555',
  twin: '66666666-6666-4666-8666-666666666666',
  image: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  toggle: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  table: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  synced: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  original: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  child: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};

export const compact = (id) => id.replace(/-/g, '');

const text = (content, extra = {}) => ({ type: 'text', plain_text: content, text: { content, link: null }, annotations: {}, href: null, ...extra });
const rt = (content) => [text(content)];

const page = (id, { title, slug = '', date = null, published = true, tags = [], excerpt = '', cover = null, rank = null, created, edited }) => ({
  object: 'page',
  id,
  created_time: created,
  last_edited_time: edited ?? created,
  archived: false,
  cover: null,
  url: `https://www.notion.so/${compact(id)}`,
  properties: {
    Page: { id: 'title', type: 'title', title: title ? rt(title) : [] },
    Slug: { id: 's', type: 'rich_text', rich_text: slug ? rt(slug) : [] },
    Date: { id: 'd', type: 'date', date: date ? { start: date, end: null } : null },
    Published: { id: 'p', type: 'checkbox', checkbox: published },
    Tags: { id: 't', type: 'multi_select', multi_select: tags.map((name) => ({ name, color: 'red' })) },
    Excerpt: { id: 'e', type: 'rich_text', rich_text: excerpt ? rt(excerpt) : [] },
    FeaturedImage: { id: 'f', type: 'files', files: cover ? [cover] : [] },
    Rank: { id: 'r', type: 'number', number: rank },
  },
});

/** A real (small) PNG: a dark-red vertical gradient, so previews show an image. */
function gradientPng(width, height) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * 3 + 1);
    const t = y / height;
    for (let x = 0; x < width; x++) {
      rows[offset + 1 + x * 3] = Math.round(40 + 140 * (1 - t));
      rows[offset + 2 + x * 3] = Math.round(8 + 10 * t);
      rows[offset + 3 + x * 3] = Math.round(14 + 12 * t);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

export function createNotionMock() {
  const state = {
    calls: [],
    downloads: 0,
    signature: 1,
    /** Answer the next N Notion requests with 429. */
    rateLimit: 0,
    offline: false,
    pages: [],
    blocks: {},
  };

  const fileUrl = (name) => `${FILES}/${name}?sig=${state.signature}`;
  const imageBlock = () => ({ object: 'block', id: ID.image, type: 'image', has_children: false, image: { type: 'file', file: { url: fileUrl('photo.png') }, caption: rt('A photo') } });

  state.pages = [
    page(ID.first, {
      title: 'First Light', slug: 'first-light', date: '2026-10-01', tags: ['Fiction'], excerpt: 'Where it begins.',
      cover: { type: 'file', name: 'cover.png', file: { url: fileUrl('cover.png') } }, rank: 2,
      created: '2026-01-01T00:00:00.000Z', edited: '2026-10-01T10:00:00.000Z',
    }),
    page(ID.second, {
      title: '第二篇', date: '2026-09-01', tags: ['Poem', 'fiction'], cover: { type: 'external', name: 'x', external: { url: 'https://images.test/second.jpg' } },
      created: '2026-02-01T00:00:00.000Z',
    }),
    page(ID.draft, { title: 'Draft', date: '2026-07-01', published: false, created: '2026-03-01T00:00:00.000Z' }),
    page(ID.future, { title: 'Future', date: '2999-01-01', created: '2026-04-01T00:00:00.000Z' }),
    page(ID.untitled, { title: '', date: '2026-06-01', created: '2026-05-01T00:00:00.000Z' }),
    page(ID.twin, { title: 'First Light', date: '2026-08-01', created: '2026-06-01T00:00:00.000Z' }),
  ];

  state.blocks = {
    [compact(ID.first)]: [
      { object: 'block', id: 'b1', type: 'heading_1', has_children: false, heading_1: { rich_text: rt('Opening'), is_toggleable: false, color: 'default' } },
      { object: 'block', id: 'b2', type: 'table_of_contents', has_children: false, table_of_contents: { color: 'gray' } },
      {
        object: 'block', id: 'b3', type: 'paragraph', has_children: false,
        paragraph: {
          color: 'default',
          rich_text: [
            text('See '),
            text('the second', { href: `/${compact(ID.second)}`, text: { content: 'the second', link: { url: `/${compact(ID.second)}` } } }),
            text(' and '),
            { type: 'mention', plain_text: 'Draft', href: `https://www.notion.so/${compact(ID.draft)}`, annotations: {}, mention: { type: 'page', page: { id: ID.draft } } },
            text(' — light through the curtain falls on the floor.', { annotations: { italic: true, color: 'red' } }),
          ],
        },
      },
      imageBlock(),
      { object: 'block', id: ID.toggle, type: 'toggle', has_children: true, toggle: { rich_text: rt('More'), color: 'default' } },
      { object: 'block', id: ID.table, type: 'table', has_children: true, table: { table_width: 2, has_column_header: true, has_row_header: false } },
      { object: 'block', id: ID.synced, type: 'synced_block', has_children: true, synced_block: { synced_from: { type: 'block_id', block_id: ID.original } } },
      { object: 'block', id: ID.child, type: 'child_page', has_children: true, child_page: { title: 'Private sub-page' } },
      { object: 'block', id: 'b4', type: 'heading_2', has_children: false, heading_2: { rich_text: rt('Closing'), is_toggleable: false, color: 'default' } },
      { object: 'block', id: 'b5', type: 'video', has_children: false, video: { type: 'external', external: { url: 'https://youtu.be/dQw4w9WgXcQ' }, caption: [] } },
    ],
    [compact(ID.toggle)]: [{ object: 'block', id: 'b6', type: 'paragraph', has_children: false, paragraph: { rich_text: rt('Hidden paragraph about owls.'), color: 'default' } }],
    [compact(ID.table)]: [
      { object: 'block', id: 'r1', type: 'table_row', has_children: false, table_row: { cells: [rt('Name'), rt('Value')] } },
      { object: 'block', id: 'r2', type: 'table_row', has_children: false, table_row: { cells: [rt('Room'), rt('Red')] } },
    ],
    [compact(ID.original)]: [{ object: 'block', id: 'b7', type: 'quote', has_children: false, quote: { rich_text: rt('Synced words.'), color: 'default' } }],
    [compact(ID.child)]: [{ object: 'block', id: 'b8', type: 'paragraph', has_children: false, paragraph: { rich_text: rt('SECRET child page content'), color: 'default' } }],
    [compact(ID.second)]: [{ object: 'block', id: 'b9', type: 'paragraph', has_children: false, paragraph: { rich_text: rt('Back to the first.'), color: 'default' } }],
    [compact(ID.twin)]: [],
  };

  const json = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

  const findBlock = (id) => {
    for (const list of Object.values(state.blocks)) {
      const block = list.find((b) => compact(b.id) === compact(id));
      if (block) return block;
    }
    return null;
  };

  async function notion(url, init) {
    const path = url.pathname.replace(/^\/v1/, '');
    if (state.offline) throw new TypeError('fetch failed');
    if (state.rateLimit > 0) {
      state.rateLimit -= 1;
      return json({ object: 'error', status: 429, code: 'rate_limited' }, 429, { 'retry-after': '0.01' });
    }
    let match;
    if ((match = /^\/databases\/([^/]+)\/query$/.exec(path)) && init.method === 'POST') {
      if (compact(match[1]) !== DB) return json({ object: 'error', status: 404, message: 'secret database detail' }, 404);
      const body = JSON.parse(init.body ?? '{}');
      const start = Number(body.start_cursor ?? 0);
      const size = 4; // force pagination
      const slice = state.pages.slice(start, start + size);
      const more = start + size < state.pages.length;
      return json({ object: 'list', results: slice, has_more: more, next_cursor: more ? String(start + size) : null });
    }
    if ((match = /^\/databases\/([^/]+)$/.exec(path))) {
      return json({
        object: 'database', id: DB, title: rt('Bottom Think'),
        properties: Object.fromEntries(Object.entries(state.pages[0].properties).map(([name, p]) => [name, { id: p.id, name, type: p.type }])),
      });
    }
    if ((match = /^\/blocks\/([^/]+)\/children$/.exec(path))) {
      const children = state.blocks[compact(match[1])];
      if (!children) return json({ object: 'error', status: 404 }, 404);
      return json({ object: 'list', results: children, has_more: false, next_cursor: null });
    }
    if ((match = /^\/blocks\/([^/]+)$/.exec(path))) {
      if (compact(match[1]) === compact(ID.image)) return json(imageBlock());
      const block = findBlock(match[1]);
      return block ? json(block) : json({ object: 'error', status: 404 }, 404);
    }
    if ((match = /^\/pages\/([^/]+)$/.exec(path))) {
      const found = state.pages.find((p) => compact(p.id) === compact(match[1]));
      if (!found) return json({ object: 'error', status: 404 }, 404);
      // Fresh signature, like Notion re-signing S3 URLs on every read.
      const clone = structuredClone(found);
      const cover = clone.properties.FeaturedImage.files[0];
      if (cover?.type === 'file') cover.file.url = fileUrl(cover.name);
      return json(clone);
    }
    return json({ object: 'error', status: 400, message: `unhandled ${path}` }, 400);
  }

  const PNG = gradientPng(480, 270);

  async function files(url) {
    if (state.offline) throw new TypeError('fetch failed');
    if (url.searchParams.get('sig') !== String(state.signature)) return new Response('expired', { status: 403 });
    state.downloads += 1;
    return new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } });
  }

  async function fetchMock(input, init = {}) {
    const url = new URL(String(input instanceof Request ? input.url : input));
    state.calls.push({ url: url.toString(), method: init.method ?? 'GET', path: url.pathname });
    if (url.origin === new URL(FILES).origin) return files(url);
    return notion(url, init);
  }

  return { fetch: fetchMock, state, PNG, fileUrl, touch(id, edited) {
    const p = state.pages.find((candidate) => candidate.id === id);
    p.last_edited_time = edited;
  } };
}

// `node tests/fixtures/notion-mock.mjs 4999` — serve the mock over HTTP.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createServer } = await import('node:http');
  const port = Number(process.argv[2] ?? 4999);
  const base = `http://127.0.0.1:${port}`;
  const mock = createNotionMock();
  // Point file URLs at this server too.
  const rewrite = (value) => JSON.parse(JSON.stringify(value).replaceAll(FILES, `${base}/files`));
  createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
    const target = req.url.startsWith('/files/') ? `${FILES}${req.url.slice(6)}` : `${API}${req.url.replace(/^\/v1/, '')}`;
    const response = await mock.fetch(target, { method: req.method, body });
    const type = response.headers.get('content-type') ?? '';
    const payload = type.includes('json') ? JSON.stringify(rewrite(await response.json())) : Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, { 'content-type': type });
    res.end(payload);
  }).listen(port, '127.0.0.1', () => console.log(`notion mock on ${base}/v1 (database ${DB})`));
}
