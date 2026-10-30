// Notion block renderer (pure): coverage, safety and the render context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBlocks } from '../src/core/blocks.ts';
const blocksToHtml = (blocks, ctx) => renderBlocks(blocks, ctx).html;

const rt = (text, extra = {}) => [{ type: 'text', plain_text: text, annotations: {}, ...extra }];
const para = (text, extra = {}) => ({ type: 'paragraph', paragraph: { rich_text: rt(text), ...extra } });
const bullet = (text, children) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(text) }, ...(children ? { children } : {}) });
const numbered = (text) => ({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt(text) } });
const heading = (level, text, extra = {}) => ({ type: `heading_${level}`, [`heading_${level}`]: { rich_text: rt(text), ...extra } });

test('paragraphs, headings with anchors, dividers', () => {
  const { html, toc } = renderBlocks([heading(1, 'Title'), para('Body text'), { type: 'divider', divider: {} }, heading(2, 'Title')]);
  assert.match(html, /<h2 id="title">Title<\/h2>/);
  assert.match(html, /<h3 id="title-2">Title<\/h3>/, 'duplicate headings get unique anchors');
  assert.match(html, /<p>Body text<\/p>/);
  assert.match(html, /<hr>/);
  assert.deepEqual(toc, [{ id: 'title', text: 'Title', level: 1 }, { id: 'title-2', text: 'Title', level: 2 }]);
});

test('lists are grouped, nested and to-dos get checkboxes', () => {
  const html = blocksToHtml([
    bullet('one', [bullet('inner')]), bullet('two'), numbered('three'), numbered('four'),
    { type: 'to_do', to_do: { rich_text: rt('done'), checked: true } },
  ]);
  assert.match(html, /<ul><li>one<ul><li>inner<\/li><\/ul><\/li><li>two<\/li><\/ul><ol><li>three<\/li><li>four<\/li><\/ol>/);
  assert.match(html, /<ul class="todo"><li class="done"><label><input type="checkbox" disabled checked> <span>done<\/span><\/label><\/li><\/ul>/);
});

test('rich text: annotations, colours, escaping, unsafe links', () => {
  const html = blocksToHtml([{ type: 'paragraph', paragraph: { rich_text: [
    { plain_text: '<script>', annotations: { bold: true } },
    { plain_text: 'link', href: 'https://example.com', annotations: {} },
    { plain_text: 'bad', href: 'javascript:alert(1)', annotations: {} },
    { plain_text: 'red', annotations: { color: 'red_background' } },
    { plain_text: 'x', annotations: { color: 'evil" onload="x' } },
    { type: 'equation', plain_text: 'E=mc^2', equation: { expression: 'E=mc^2' }, annotations: {} },
  ] } }]);
  assert.match(html, /<strong>&lt;script&gt;<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">link<\/a>/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /<span class="nc-red_background">red<\/span>/);
  assert.doesNotMatch(html, /onload/);
  assert.match(html, /<math><semantics>.*<annotation encoding="application\/x-tex">E=mc\^2<\/annotation><\/semantics><\/math>/, 'inline equations render as MathML');
});

test('media: Notion-hosted files go through ctx.fileUrl; unsafe URLs are dropped', () => {
  const result = renderBlocks([
    { id: 'img-1', type: 'image', image: { type: 'file', file: { url: 'https://s3.test/a.png?X-Amz=1' }, caption: rt('A caption') } },
    { type: 'image', image: { type: 'external', external: { url: 'javascript:alert(1)' } } },
    { type: 'video', video: { type: 'external', external: { url: 'https://vimeo.com/123456789' } } },
    { id: 'pdf-1', type: 'pdf', pdf: { type: 'file', file: { url: 'https://s3.test/doc.pdf' }, name: 'doc.pdf' } },
  ], { fileUrl: (id) => `/media/notion/${id}` });
  assert.match(result.html, /<img src="\/media\/notion\/img-1" alt="A caption"/);
  assert.match(result.html, /<figcaption>A caption<\/figcaption>/);
  assert.match(result.html, /player\.vimeo\.com\/video\/123456789/);
  assert.match(result.html, /<a class="file" href="\/media\/notion\/pdf-1"/);
  assert.doesNotMatch(result.html, /s3\.test|javascript:/);
  assert.deepEqual(result.files, ['img-1', 'pdf-1']);
});

test('tables with column and row headers', () => {
  const html = blocksToHtml([{
    type: 'table', table: { has_column_header: true, has_row_header: true },
    children: [
      { type: 'table_row', table_row: { cells: [rt('A'), rt('B')] } },
      { type: 'table_row', table_row: { cells: [rt('1'), rt('2')] } },
    ],
  }]);
  assert.equal(html, '<div class="table-wrap"><table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody><tr><th scope="row">1</th><td>2</td></tr></tbody></table></div>');
});

test('columns, callouts, toggles, toggleable headings, quotes', () => {
  const html = blocksToHtml([
    { type: 'column_list', column_list: {}, children: [
      { type: 'column', column: {}, children: [para('left')] },
      { type: 'column', column: {}, children: [para('right')] },
    ] },
    { type: 'callout', callout: { rich_text: rt('Note'), icon: { type: 'emoji', emoji: '💡' }, color: 'gray_background' }, children: [para('more')] },
    { type: 'toggle', toggle: { rich_text: rt('Open me') }, children: [para('inside')] },
    heading(2, 'Fold', { is_toggleable: true }),
    { type: 'quote', quote: { rich_text: rt('Quoted') } },
  ]);
  assert.match(html, /<div class="columns"><div class="column"><p>left<\/p><\/div><div class="column"><p>right<\/p><\/div><\/div>/);
  assert.match(html, /<aside class="callout nc-gray_background"><span class="callout-icon" aria-hidden="true">💡<\/span><div class="callout-body"><p>Note<\/p><p>more<\/p><\/div><\/aside>/);
  assert.match(html, /<details class="toggle"><summary>Open me<\/summary><p>inside<\/p><\/details>/);
  assert.match(html, /<details class="toggle toggle-heading"><summary><h3 id="fold">Fold<\/h3><\/summary><\/details>/);
  assert.match(html, /<blockquote><p>Quoted<\/p><\/blockquote>/);
});

test('code keeps its language and caption, escaped verbatim', () => {
  const html = blocksToHtml([{ type: 'code', code: { rich_text: rt('a < b'), language: 'Plain Text', caption: rt('cap') } }, { type: 'code', code: { rich_text: rt('x'), language: 'c++' } }]);
  assert.match(html, /<figure class="code"><pre><code class="language-plain-text hljs">a &lt; b<\/code><\/pre><figcaption>cap<\/figcaption><\/figure>/);
  assert.match(html, /<pre data-lang="c\+\+"><code class="language-c\+\+ hljs">x<\/code><\/pre>/);
});

test('page links resolve only to published articles', () => {
  const published = '0123456789abcdef0123456789abcdef';
  const page = (id) => (id === published ? { href: '/articles/hello', title: 'Hello' } : null);
  const html = blocksToHtml([
    { type: 'link_to_page', link_to_page: { type: 'page_id', page_id: '01234567-89ab-cdef-0123-456789abcdef' } },
    { type: 'link_to_page', link_to_page: { type: 'page_id', page_id: 'ffffffffffffffffffffffffffffffff' } },
    { type: 'paragraph', paragraph: { rich_text: [
      { type: 'mention', plain_text: 'Hello', mention: { type: 'page', page: { id: published } }, annotations: {} },
      { type: 'text', plain_text: ' / ', annotations: {} },
      { type: 'text', plain_text: 'private', href: '/ffffffffffffffffffffffffffffffff', annotations: {} },
      { type: 'mention', plain_text: 'Oct 1', mention: { type: 'date', date: { start: '2026-10-01' } }, annotations: {} },
    ] } },
  ], { page });
  assert.match(html, /<p class="page-link"><a href="\/articles\/hello">Hello<\/a><\/p>/);
  assert.equal((html.match(/page-link/g) ?? []).length, 1, 'unpublished page links disappear');
  assert.match(html, /<a href="\/articles\/hello"><span class="mention">Hello<\/span><\/a>/);
  assert.doesNotMatch(html, /href="\/ffff/);
  assert.match(html, /private/);
  assert.match(html, /<time datetime="2026-10-01">Oct 1<\/time>/);
});

test('embeds, bookmarks and the table of contents block', () => {
  const { html } = renderBlocks([
    { type: 'table_of_contents', table_of_contents: {} },
    heading(1, 'Only'),
    { type: 'embed', embed: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    { type: 'bookmark', bookmark: { url: 'https://example.com/post', caption: [] } },
    { type: 'embed', embed: { url: 'javascript:alert(1)' } },
    { type: 'child_database', child_database: { title: 'x' } },
    { type: 'unsupported', unsupported: {} },
  ]);
  assert.match(html, /<nav class="toc" aria-label="Contents"><ol><li class="toc-l1"><a href="#only">Only<\/a><\/li><\/ol><\/nav>/);
  assert.match(html, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(html, /<a class="bookmark" href="https:\/\/example\.com\/post"[^>]*><span class="bookmark-title">example\.com<\/span>/);
  assert.doesNotMatch(html, /javascript:/);
});

test('plain text is collected for search and reading time', () => {
  const { text } = renderBlocks([heading(1, 'Owls'), para('are not'), { type: 'code', code: { rich_text: rt('what they seem') } }]);
  assert.equal(text, 'Owls\nare not\nwhat they seem');
});

test('intentional blank paragraphs and authored line breaks survive rendering', () => {
  const { html, text } = renderBlocks([
    para('First line\nsecond line'), para(''), para('Last line'),
    bullet('List line one\nline two'),
  ]);
  assert.match(html, /<p>First line\nsecond line<\/p><p class="notion-blank-line" aria-hidden="true"><br><\/p><p>Last line<\/p>/);
  assert.match(html, /<li>List line one\nline two<\/li>/);
  assert.equal(text, 'First line\nsecond line\nLast line\nList line one\nline two');
});
