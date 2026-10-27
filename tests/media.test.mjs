import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMedia, isAudioUrl } from '../src/core/media.ts';
import { formatBytes, formatDate, markdownToText, readingMinutes } from '../src/core/text.ts';
import { rssFeed, robots, sitemap } from '../src/ui/feeds.ts';
import { collectionBySlug, collectionOf, itemPath } from '../src/shared/kinds.ts';

test('classifyMedia picks native players, embeds or links', () => {
  assert.deepEqual(classifyMedia('/uploads/a.mp3'), { kind: 'audio', src: '/uploads/a.mp3' });
  assert.equal(classifyMedia('https://cdn.test/v.webm?x=1').kind, 'video');
  assert.deepEqual(classifyMedia('https://youtu.be/dQw4w9WgXcQ'), { kind: 'embed', provider: 'youtube', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
  assert.equal(classifyMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3').src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(classifyMedia('https://vimeo.com/123456789').src, 'https://player.vimeo.com/video/123456789');
  assert.equal(classifyMedia('https://soundcloud.com/a/b').provider, 'soundcloud');
  assert.deepEqual(classifyMedia('https://example.test/page'), { kind: 'link', href: 'https://example.test/page' });
  assert.deepEqual(classifyMedia('javascript:alert(1)'), { kind: 'none' });
  assert.deepEqual(classifyMedia(null), { kind: 'none' });
  assert.ok(isAudioUrl('x.flac') && !isAudioUrl('x.mp4'));
});

test('text helpers', () => {
  assert.equal(markdownToText('# Title\n\n**bold** [link](https://x) `code`'), 'Title bold link code');
  assert.equal(readingMinutes('word '.repeat(450)), 2);
  assert.equal(readingMinutes(''), 1);
  assert.equal(formatDate('2026-03-04 12:00:00'), '04 Mar 2026');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('collections map API kinds to public paths', () => {
  assert.equal(collectionOf('writing').path, '/works');
  assert.equal(collectionOf('films').path, '/video');
  assert.equal(collectionBySlug('video').kind, 'films');
  assert.equal(collectionBySlug('writing'), undefined);
  assert.equal(itemPath('music', 'a b'), '/music/a%20b');
});

test('rss and sitemap escape content and use absolute URLs', () => {
  const post = { slug: 'a', title: 'Fish & <Chips>', tags: ['x'], created: '2026-01-02 03:04:05', updated: '2026-01-03', published: true, excerpt: '"quoted"', href: '/journal/a' };
  const rss = rssFeed({ origin: 'https://site.test', title: 'T', description: 'D', posts: [post] });
  assert.match(rss, /<title>Fish &amp; &lt;Chips&gt;<\/title>/);
  assert.match(rss, /<link>https:\/\/site\.test\/journal\/a<\/link>/);
  assert.match(rss, /<pubDate>Fri, 02 Jan 2026 03:04:05 GMT<\/pubDate>/);
  const map = sitemap({ origin: 'https://site.test', posts: [post], items: [] });
  assert.match(map, /<loc>https:\/\/site\.test\/works<\/loc>/);
  assert.match(map, /<lastmod>2026-01-03<\/lastmod>/);
  assert.match(robots('https://site.test'), /Disallow: \/api\//);
});
