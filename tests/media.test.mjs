import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMedia } from '../src/core/media.ts';
import { formatBytes, formatDate, readingMinutes, truncate } from '../src/core/text.ts';
import { rssFeed, robots, sitemap } from '../src/ui/feeds.ts';
import { articlePath, notionMediaPath, tagPath } from '../src/shared/routes.ts';

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
  assert.equal(classifyMedia('x.flac').kind, 'audio');
  assert.equal(classifyMedia('x.mp4').kind, 'video');
});

test('text helpers', () => {
  assert.equal(readingMinutes('word '.repeat(440)), 2);
  assert.equal(readingMinutes('字'.repeat(1200)), 3, 'CJK text is counted per character');
  assert.equal(readingMinutes(''), 1);
  assert.equal(truncate('one two three four', 9), 'one two…');
  assert.equal(truncate('short', 9), 'short');
  assert.equal(formatDate('2026-03-04'), '04 Mar 2026');
  assert.equal(formatDate('2026-03-04T23:00:00.000Z'), '04 Mar 2026');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('public URL helpers', () => {
  assert.equal(articlePath('a b'), '/articles/a%20b');
  assert.equal(tagPath('小说'), `/articles?tag=${encodeURIComponent('小说')}`);
  assert.equal(notionMediaPath('01234567-89ab-cdef-0123-456789abcdef'), '/media/notion/0123456789abcdef0123456789abcdef');
});

test('rss and sitemap escape content and use absolute URLs', () => {
  const article = {
    id: 'x', slug: 'a', title: 'Fish & <Chips>', tags: ['x'], date: '2026-01-02', updated: '2026-01-03T10:00:00.000Z',
    excerpt: '"quoted"', href: '/articles/a', cover: '/media/notion/abc', rank: 0,
  };
  const rss = rssFeed({ origin: 'https://site.test', title: 'T', description: 'D', articles: [article] });
  assert.match(rss, /<title>Fish &amp; &lt;Chips&gt;<\/title>/);
  assert.match(rss, /<link>https:\/\/site\.test\/articles\/a<\/link>/);
  assert.match(rss, /<pubDate>Fri, 02 Jan 2026 00:00:00 GMT<\/pubDate>/);
  assert.doesNotMatch(rss, /<enclosure/, 'unknown MIME and length are not invented');
  const map = sitemap({ origin: 'https://site.test', articles: [article], tags: [{ key: 'x', name: 'X', count: 1 }] });
  assert.match(map, /<loc>https:\/\/site\.test\/articles<\/loc>/);
  assert.match(map, /<loc>https:\/\/site\.test\/articles\?tag=x<\/loc>/);
  assert.match(map, /<lastmod>2026-01-03<\/lastmod>/);
  assert.match(robots('https://site.test'), /Disallow: \/api\//);
});

test('RSS does not invent a MIME type or size for PNG, WebP, JPEG or extensionless covers', () => {
  const covers = ['/media/notion/abc', 'https://images.test/photo.png', 'https://images.test/photo.webp', 'https://images.test/photo.jpg'];
  const articles = covers.map((cover, i) => ({ id: String(i), slug: String(i), title: 'Article', tags: [], date: '2020-01-01', updated: '2020-01-01', excerpt: '', href: `/articles/${i}`, cover, rank: 0 }));
  const feed = rssFeed({ origin: 'https://site.test', title: 'Test', description: '', articles });
  assert.equal((feed.match(/<item>/g) || []).length, covers.length);
  assert.doesNotMatch(feed, /<enclosure/);
});
