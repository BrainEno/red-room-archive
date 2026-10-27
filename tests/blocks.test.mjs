import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksToHtml, markdownToBlocks, richTextHtml } from '../src/core/blocks.ts';

const para = (text, extra = {}) => ({ type: 'paragraph', paragraph: { rich_text: [{ plain_text: text, annotations: {} }] }, ...extra });
const bullet = (text) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: text }] } });
const numbered = (text) => ({ type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: text }] } });

test('renders paragraphs, headings and dividers', () => {
  const html = blocksToHtml([
    { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Title' }] } },
    para('Body text'),
    { type: 'divider', divider: {} },
  ]);
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<p>Body text<\/p>/);
  assert.match(html, /<hr>/);
});

test('groups consecutive list items into a single list element', () => {
  const html = blocksToHtml([bullet('one'), bullet('two'), numbered('three'), numbered('four')]);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul><ol><li>three<\/li><li>four<\/li><\/ol>/);
});

test('keeps rich text annotations and escapes HTML in content', () => {
  const html = richTextHtml([
    { plain_text: '<script>', annotations: { bold: true } },
    { plain_text: 'link', href: 'https://example.com', annotations: {} },
    { plain_text: 'bad', href: 'javascript:alert(1)', annotations: {} },
  ]);
  assert.match(html, /<strong>&lt;script&gt;<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /javascript:/i);
});

test('drops unsafe media URLs and renders safe ones', () => {
  const html = blocksToHtml([
    { type: 'image', image: { type: 'external', external: { url: 'javascript:alert(1)' } } },
    { type: 'image', image: { type: 'external', external: { url: 'https://cdn.example.com/a.png' }, caption: [{ plain_text: 'A caption' }] } },
    { type: 'video', video: { type: 'external', external: { url: 'https://cdn.example.com/a.mp4' } } },
  ]);
  assert.doesNotMatch(html, /javascript:/i);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.match(html, /<figcaption>A caption<\/figcaption>/);
  assert.match(html, /<video controls/);
});

test('renders code blocks verbatim with escaped markup', () => {
  const html = blocksToHtml([{ type: 'code', code: { rich_text: [{ plain_text: 'a < b' }], language: 'javascript' } }]);
  assert.match(html, /<pre><code class="language-javascript">a &lt; b<\/code><\/pre>/);
});

test('markdownToBlocks converts the supported markdown subset', () => {
  const blocks = markdownToBlocks(['# Title', '', '> quote', '', '- one', '- two', '', '```js', 'x()', '```', '', '---', '', 'plain'].join('\n'));
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types, ['heading_1', 'quote', 'bulleted_list_item', 'bulleted_list_item', 'code', 'divider', 'paragraph']);
  assert.equal(blocks[4].code.language, 'js');
  assert.equal(blocks[6].paragraph.rich_text[0].text.content, 'plain');
});

test('markdownToBlocks splits very long text into <=2000 char rich text items', () => {
  const blocks = markdownToBlocks('x'.repeat(5000));
  const items = blocks[0].paragraph.rich_text;
  assert.ok(items.length >= 3);
  for (const i of items) assert.ok(i.text.content.length <= 1900);
});
