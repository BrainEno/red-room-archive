import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/lib/markdown.ts';

test('renders headings and inline emphasis', async () => {
  const html = await renderMarkdown('# An Archive\n\nA **bold** and _quiet_ line.');
  assert.match(html, /<h1>An Archive<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>quiet<\/em>/);
});

test('preserves single newlines for poetry and lineated prose', async () => {
  const html = await renderMarkdown('red room\nempty room');
  assert.match(html, /red room<br\s*\/?\s*>\s*empty room/);
});

test('supports GFM tables, strikethrough, lists, and blockquotes', async () => {
  const html = await renderMarkdown([
    '| Work | Year |',
    '| --- | ---: |',
    '| Untitled | 2026 |',
    '',
    '~~removed~~',
    '',
    '- first',
    '- second',
    '',
    '> A note from the archive'
  ].join('\n'));

  assert.match(html, /<table>/);
  assert.match(html, /<del>removed<\/del>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<blockquote>/);
});

test('does not pass raw HTML or unsafe URL schemes through to output', async () => {
  const html = await renderMarkdown([
    '<script>alert("xss")</script>',
    '',
    '<img src=x onerror=alert(1)>',
    '',
    '[unsafe](javascript:alert(1))'
  ].join('\n'));

  assert.doesNotMatch(html, /<script\b|<img\b|onerror\s*=|javascript:/i);
});

test('preserves fenced code content without converting its newlines into breaks', async () => {
  const html = await renderMarkdown('```text\nfirst\nsecond\n```');
  assert.match(html, /<pre><code[^>]*>first\nsecond\n<\/code><\/pre>/);
  assert.doesNotMatch(html, /first<br/);
});
