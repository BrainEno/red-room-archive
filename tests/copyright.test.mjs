// Ownership and reuse terms: the /copyright document, robots.txt AI-crawler
// block, RSS <copyright> and the JSON-LD rights fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyrightDoc } from '../src/content/copyright.ts';
import { AI_TRAINING_CRAWLERS, robots, rssFeed, sitemap } from '../src/ui/feeds.ts';
import { articleLd } from '../src/shared/structured-data.ts';

const owner = { name: 'Test Studio', email: 'owner@example.test', year: 2026 };
const text = (doc) => JSON.stringify(doc);

test('the copyright page exists in both languages with the same sections, owner and contact', () => {
  const en = copyrightDoc('en', owner), zh = copyrightDoc('zh-CN', owner);
  assert.deepEqual(en.sections.map((s) => s.id), zh.sections.map((s) => s.id), 'section anchors match across languages');
  assert.deepEqual(en.sections.map((s) => s.id), ['ownership', 'reuse', 'permission', 'ai', 'code', 'third-party', 'report']);
  for (const doc of [en, zh]) {
    assert.match(text(doc), /© 2026 Test Studio/);
    assert.match(text(doc), /mailto:owner@example\.test/, 'permission requests go to the site email');
    assert.match(text(doc), /CC BY 4\.0/, 'CC BY 4.0 attribution for the statue model is shown to visitors');
    assert.match(text(doc), /Thunk3D/);
    assert.match(text(doc), /github\.com\/BrainEno\/red-room-archive\/blob\/main\/LICENSE/);
  }
  assert.match(text(zh), /未经作者事先书面许可/);
  assert.match(text(en), /prior written permission/);
});

test('robots.txt keeps search crawlers and blocks AI-training crawlers', () => {
  const body = robots('https://site.test');
  assert.match(body, /^User-agent: \*\nDisallow: \/admin\nDisallow: \/api\/\n/);
  for (const bot of ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended']) assert.ok(AI_TRAINING_CRAWLERS.includes(bot), bot);
  const block = body.split('\n\n').find((group) => group.includes('GPTBot'));
  for (const bot of AI_TRAINING_CRAWLERS) assert.match(block, new RegExp(`^User-agent: ${bot}$`, 'm'));
  assert.match(block, /^Disallow: \/$/m);
  assert.doesNotMatch(body, /Googlebot|Bingbot/, 'search engines are not blocked');
  assert.match(body, /https:\/\/site\.test\/copyright/);
});

test('RSS carries the copyright line; the sitemap lists /copyright in both languages', () => {
  const rss = rssFeed({ origin: 'https://site.test', title: 'T', description: 'D', articles: [], copyright: '© 2026 Test Studio. All rights reserved.' });
  assert.match(rss, /<copyright>© 2026 Test Studio\. All rights reserved\.<\/copyright>/);
  assert.doesNotMatch(rssFeed({ origin: 'https://site.test', title: 'T', description: 'D', articles: [] }), /<copyright>/);
  const map = sitemap({ origin: 'https://site.test', articles: [] });
  assert.match(map, /<loc>https:\/\/site\.test\/copyright<\/loc>/);
  assert.match(map, /<loc>https:\/\/site\.test\/zh-CN\/copyright<\/loc>/);
});

test('article JSON-LD names the copyright holder, year and terms', () => {
  const ld = articleLd({ url: 'https://site.test/articles/a', headline: 'A', inLanguage: 'en', siteName: 'Test Studio', homeUrl: 'https://site.test/', copyrightYear: 2025, license: 'https://site.test/copyright' });
  assert.deepEqual(ld.copyrightHolder, { '@type': 'Organization', name: 'Test Studio', url: 'https://site.test/' });
  assert.equal(ld.copyrightYear, 2025);
  assert.equal(ld.license, 'https://site.test/copyright');
});

test('the repository is marked proprietary with third-party credits', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.private, true);
  assert.match(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'), /All rights reserved\.[\s\S]*NOT open source/);
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  assert.match(notices, /venus\.glb[\s\S]*Thunk3D[\s\S]*CC BY 4\.0/);
});
