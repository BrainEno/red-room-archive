// Phase 6 rendering: MathML equations, highlighted code, bookmark previews,
// link metadata parsing, the outbound address guard and JSON-LD (all pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkUrls, renderBlocks } from '../src/core/blocks.ts';
import { renderMath } from '../src/core/math.ts';
import { codeLanguage, highlightCode } from '../src/core/highlight.ts';
import { decodeEntities, htmlCharset, parseLinkPreview, tidy } from '../src/core/link-meta.ts';
import { assertFetchableUrl, BlockedUrlError, isPublicAddress } from '../src/server/net/safe-fetch.ts';
import { articleLd, breadcrumbLd, serializeJsonLd, websiteLd } from '../src/shared/structured-data.ts';

const rt = (text) => [{ type: 'text', plain_text: text, annotations: {} }];

/* ── maths ─────────────────────────────────────────────────────────── */

test('equations render as MathML without inline styles, scripts or links', () => {
  const inline = renderMath('x^2 + y^2 = r^2');
  assert.match(inline, /^<math\b/);
  assert.doesNotMatch(inline, /display="block"/);
  assert.match(inline, /<annotation encoding="application\/x-tex">x\^2 \+ y\^2 = r\^2<\/annotation>/, 'source kept for copy and assistive tech');
  assert.match(renderMath('\\frac{a}{b}', true), /display="block"/);
  assert.match(inline, /<mi class="tml-v">x<\/mi>/, 'single-letter variables are italicised by CSS, not by math-font codepoints');
  assert.match(renderMath('\\sin x'), /<mi>sin<\/mi>/, 'multi-letter names stay upright');

  const coloured = renderMath('\\color{red}{x} \\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', true);
  assert.match(coloured, /<mtable/);
  assert.doesNotMatch(coloured, /style=/, 'the CSP forbids inline styles; matrix padding comes from CSS');

  const script = renderMath('\\text{<script>alert(1)</script>}');
  assert.match(script, /^<math\b/);
  assert.doesNotMatch(script, /<script/i);
  // \href is not allowed (trust: false): the formula falls back to its escaped source, never a link.
  const link = renderMath('\\href{javascript:alert(1)}{x}');
  assert.match(link, /^<code class="math">/);
  assert.doesNotMatch(link, /<a\b|href=|<script/i);
});

test('invalid or oversized TeX falls back to its escaped source', () => {
  assert.equal(renderMath('\\notamacro{'), '<code class="math">\\notamacro{</code>');
  assert.equal(renderMath('a < b \\bad', true), '<code class="math" data-math-source>a &lt; b \\bad</code>');
  assert.match(renderMath('x'.repeat(5000)), /^<code class="math">/);
  assert.equal(renderMath('   '), '');
});

test('Notion inline and block equations use the MathML renderer and feed search text', () => {
  const { html, text } = renderBlocks([
    { type: 'paragraph', paragraph: { rich_text: [...rt('Area '), { type: 'equation', plain_text: '\\pi r^2', equation: { expression: '\\pi r^2' }, annotations: {} }] } },
    { type: 'equation', equation: { expression: 'E = mc^2' } },
  ]);
  assert.match(html, /<p>Area <math\b[^>]*>.*<\/math><\/p>/s);
  assert.match(html, /<div class="equation"><math\b[^>]*display="block"/);
  assert.match(text, /E = mc\^2/);
});

/* ── code ──────────────────────────────────────────────────────────── */

test('code is highlighted with class-only markup, unknown languages are escaped', () => {
  const js = highlightCode('const a = "<b>";', 'javascript');
  assert.match(js, /<span class="hljs-keyword">const<\/span>/);
  assert.match(js, /&lt;b&gt;/);
  assert.doesNotMatch(js, /style=|<b>/);
  assert.equal(highlightCode('<x> & y', 'klingon'), '&lt;x&gt; &amp; y');
  assert.equal(codeLanguage('C++'), 'cpp');
  assert.equal(codeLanguage('Plain Text'), null);
  assert.equal(codeLanguage('HTML'), 'xml');

  const html = renderBlocks([{ type: 'code', code: { language: 'python', rich_text: rt('def f():\n    return 1'), caption: [] } }]).html;
  assert.match(html, /<figure class="code"><pre data-lang="python"><code class="language-python hljs">/);
  assert.match(html, /<span class="hljs-keyword">def<\/span>/);
});

/* ── bookmarks ─────────────────────────────────────────────────────── */

test('bookmarks show a server-fetched preview when one is known, escaped', () => {
  const block = { type: 'bookmark', bookmark: { url: 'https://example.com/post?a=1&b=2', caption: [] } };
  const plain = renderBlocks([block]).html;
  assert.match(plain, /<a class="bookmark" href="https:\/\/example\.com\/post\?a=1&amp;b=2"[^>]*><span class="bookmark-title">example\.com<\/span>/);
  assert.doesNotMatch(plain, /has-preview/);

  const lookups = [];
  const preview = renderBlocks([{ ...block, bookmark: { ...block.bookmark, caption: rt('Worth reading') } }], {
    bookmark: (url) => (lookups.push(url), { title: 'A <post>', description: 'About "things" & more', site: 'Example' }),
  }).html;
  assert.deepEqual(lookups, ['https://example.com/post?a=1&b=2']);
  assert.match(preview, /<figure class="bookmark-figure"><a class="bookmark has-preview"/);
  assert.match(preview, /<span class="bookmark-title">A &lt;post&gt;<\/span>/);
  assert.match(preview, /<span class="bookmark-desc">About &quot;things&quot; &amp; more<\/span>/);
  assert.match(preview, /<span class="bookmark-url">Example<\/span>/);
  assert.match(preview, /<figcaption>Worth reading<\/figcaption><\/figure>/);
  assert.doesNotMatch(preview, /<img/, 'no third-party images');
});

test('bookmarkUrls collects http(s) bookmark-like links, deduplicated, never media embeds', () => {
  const urls = bookmarkUrls([
    { type: 'bookmark', bookmark: { url: 'https://a.example/x' } },
    { type: 'link_preview', link_preview: { url: 'https://b.example/' } },
    { type: 'embed', embed: { url: 'https://c.example/page' } },
    { type: 'embed', embed: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    { type: 'bookmark', bookmark: { url: 'javascript:alert(1)' } },
    { type: 'toggle', toggle: { rich_text: [] }, children: [{ type: 'bookmark', bookmark: { url: 'https://a.example/x' } }, { type: 'bookmark', bookmark: { url: 'http://d.example/' } }] },
  ]);
  assert.deepEqual(urls, ['https://a.example/x', 'https://b.example/', 'https://c.example/page', 'http://d.example/']);
});

/* ── link metadata ─────────────────────────────────────────────────── */

test('link previews prefer Open Graph, fall back to <title>, and stay plain text', () => {
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"><title>Fallback &amp; title</title>
    <meta name="description" content="Plain description">
    <meta property="og:title" content="  OG   title &#x2014; &quot;quoted&quot; ">
    <meta content="Site &amp; Co" property="og:site_name">
    </head><body><meta property="og:description" content="ignored: in body"></body></html>`;
  assert.deepEqual(parseLinkPreview(html), { title: 'OG title — "quoted"', description: 'Plain description', site: 'Site & Co' });
  assert.deepEqual(parseLinkPreview('<title>Only a title</title>'), { title: 'Only a title', description: '', site: '' });
  assert.equal(parseLinkPreview('<html><head></head><body>no title</body></html>'), null);
  assert.equal(decodeEntities('&#0;&#xD800;&lt;&unknown;'), '<&unknown;');
  const long = tidy('word '.repeat(100), 40);
  assert.ok(long.length <= 41 && long.endsWith('…'), long);
  assert.equal(htmlCharset('text/html; charset=Shift_JIS', ''), 'shift_jis');
  assert.equal(htmlCharset('text/html', '<meta charset="gbk">'), 'gbk');
  assert.equal(htmlCharset('', ''), 'utf-8');
});

/* ── outbound address guard ────────────────────────────────────────── */

test('only globally routable addresses are fetchable', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '[2a00:1450:4001:80b::200e]']) assert.ok(isPublicAddress(address), address);
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '198.18.0.1', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', 'not-an-ip', '',
  ]) assert.equal(isPublicAddress(address), false, address);
});

test('URLs are refused before any connection when they cannot be safe', () => {
  for (const url of [
    'file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com', 'javascript:alert(1)', 'not a url',
    'http://user:pass@example.com/', 'http://example.com:8080/', 'https://example.com:22/',
    'http://localhost/', 'http://foo.localhost/', 'http://printer.local/', 'http://db.internal/',
    'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://[::ffff:10.0.0.1]/', 'http://2130706433/', 'http://0x7f000001/',
  ]) assert.throws(() => assertFetchableUrl(url), BlockedUrlError, url);
  assert.equal(assertFetchableUrl('https://example.com:443/a').toString(), 'https://example.com/a');
  assert.equal(assertFetchableUrl('http://93.184.215.14/').hostname, '93.184.215.14');
});

/* ── structured data ───────────────────────────────────────────────── */

test('JSON-LD is valid schema.org and cannot break out of its script element', () => {
  const site = websiteLd({ url: 'https://example.com/', name: 'Room', inLanguage: 'en', searchUrl: 'https://example.com/search' });
  assert.equal(site.potentialAction.target.urlTemplate, 'https://example.com/search?q={search_term_string}');
  const article = articleLd({
    url: 'https://example.com/articles/a', headline: 'x'.repeat(200), description: '</script><script>alert(1)</script>', datePublished: '2026-01-02',
    keywords: ['Notes', 'Essay'], inLanguage: 'en', siteName: 'Room', homeUrl: 'https://example.com/',
  });
  assert.equal(article.headline.length, 110);
  assert.equal(article.dateModified, '2026-01-02', 'modified defaults to published');
  assert.equal(article.keywords, 'Notes, Essay');
  const crumbs = breadcrumbLd([{ name: 'Home', url: 'https://example.com/' }, { name: 'A', url: 'https://example.com/a' }]);
  assert.deepEqual(crumbs.itemListElement.map((item) => item.position), [1, 2]);

  const json = serializeJsonLd([article, crumbs]);
  assert.doesNotMatch(json, /</);
  const parsed = JSON.parse(json);
  assert.equal(parsed['@context'], 'https://schema.org');
  assert.equal(parsed['@graph'].length, 2);
  assert.equal(parsed['@graph'][0].description, '</script><script>alert(1)</script>');
  assert.equal(JSON.parse(serializeJsonLd([site]))['@type'], 'WebSite');
});
