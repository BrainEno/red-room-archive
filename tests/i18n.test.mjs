// Interface language resolution, localized formatting, article ordering, the
// translation dictionary and the Chinese display-type wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  contentLang, isPagePath, localePath, localizedPath, splitLocale, switchHref, negotiateLocale, parseLocale, resolveLocale,
} from '../src/shared/i18n.ts';
import { formatDate, isoDatetime } from '../src/core/text.ts';
import { instant, newestFirst } from '../src/core/order.ts';
import { messages } from '../src/ui/i18n.ts';
import { sitemap } from '../src/ui/feeds.ts';
import { copy } from '../src/content/site.ts';

const root = path.resolve(import.meta.dirname, '..');

test('parseLocale: any Chinese tag → zh-CN, any English tag → en, others → null', () => {
  for (const tag of ['zh', 'zh-CN', 'zh-cn', 'zh_Hans', 'zh-TW', 'zh-HK']) assert.equal(parseLocale(tag), 'zh-CN', tag);
  for (const tag of ['en', 'en-US', 'EN-gb']) assert.equal(parseLocale(tag), 'en', tag);
  for (const tag of ['fr', '', null, undefined, '*']) assert.equal(parseLocale(tag), null, String(tag));
});

test('negotiateLocale honours q-values and order, skipping unsupported languages', () => {
  assert.equal(negotiateLocale('zh-TW,zh;q=0.9,en;q=0.8'), 'zh-CN');
  assert.equal(negotiateLocale('fr-FR, en;q=0.5, zh;q=0.4'), 'en');
  assert.equal(negotiateLocale('en;q=0.3, zh-CN;q=0.7'), 'zh-CN');
  assert.equal(negotiateLocale('zh;q=0, en'), 'en', 'q=0 means "not acceptable"');
  assert.equal(negotiateLocale('fr, de'), null);
  assert.equal(negotiateLocale(''), null);
});

test('resolveLocale: ?lang= beats the cookie, which beats Accept-Language; default English', () => {
  assert.equal(resolveLocale({ param: 'zh-CN', cookie: 'en', acceptLanguage: 'en' }), 'zh-CN');
  assert.equal(resolveLocale({ param: 'nonsense', cookie: 'zh-CN', acceptLanguage: 'en' }), 'zh-CN');
  assert.equal(resolveLocale({ cookie: 'en', acceptLanguage: 'zh-CN' }), 'en');
  assert.equal(resolveLocale({ acceptLanguage: 'zh-HK,zh;q=0.8' }), 'zh-CN');
  assert.equal(resolveLocale({ acceptLanguage: 'ja' }), 'en');
  assert.equal(resolveLocale({}), 'en');
});

test('contentLang tags text by script, so typography follows the content', () => {
  assert.equal(contentLang('第二篇'), 'zh-CN');
  assert.equal(contentLang('Notion 写作指南'), 'zh-CN', 'any Han character makes it Chinese');
  assert.equal(contentLang('First Light'), 'en');
  assert.equal(contentLang('2026 — 42'), undefined, 'no letters: inherit from the page');
  assert.equal(contentLang(''), undefined);
});

test('pages live under a language prefix; APIs and files never do', () => {
  assert.equal(localePath('/articles', 'en'), '/articles', 'the default language keeps the clean URL');
  assert.equal(localePath('/articles', 'zh-CN'), '/zh-CN/articles');
  assert.equal(localePath('/', 'zh-CN'), '/zh-CN');
  assert.equal(localePath('/search?q=x#r', 'zh-CN'), '/zh-CN/search?q=x#r');
  assert.equal(localePath('/?x=1', 'zh-CN'), '/zh-CN?x=1');
  for (const shared of ['/api/articles', '/media/notion/abc', '/uploads/a.png', '/admin', '/rss.xml', '/_astro/x.js', 'https://x.test/a', '//x.test/a', '#top']) {
    assert.equal(localePath(shared, 'zh-CN'), shared, shared);
  }
  assert.equal(localizedPath, localePath);
  assert.ok(isPagePath('/topics/小说') && isPagePath('/') && !isPagePath('/robots.txt') && !isPagePath('/api'));
  assert.deepEqual(splitLocale('/zh-CN'), { locale: 'zh-CN', path: '/' });
  assert.deepEqual(splitLocale('/zh-CN/topics/fiction'), { locale: 'zh-CN', path: '/topics/fiction' });
  assert.deepEqual(splitLocale('/zh-CNx'), { locale: null, path: '/zh-CNx' });
  assert.deepEqual(splitLocale('/articles'), { locale: null, path: '/articles' });
});

test('the switcher links to the other language and asks the server to remember it', () => {
  assert.equal(switchHref('/articles/page/2', '', 'zh-CN'), '/zh-CN/articles/page/2?lang=zh-CN');
  assert.equal(switchHref('/search', '?q=light&lang=en', 'zh-CN'), '/zh-CN/search?q=light&lang=zh-CN', 'the query survives, lang is replaced');
  assert.equal(switchHref('/', '', 'en'), '/?lang=en');
});

test('formatDate is locale-aware and keeps the author\'s wall-clock date and time', () => {
  assert.equal(formatDate('2026-03-04'), '04 Mar 2026');
  assert.equal(formatDate('2026-03-04', 'zh-CN'), '2026年3月4日');
  const late = '2026-10-28T23:30:00.000+08:00';
  assert.equal(formatDate(late, 'en'), '28 Oct 2026', 'not shifted to the 28th 15:30 UTC… nor to the 29th');
  assert.equal(formatDate(late, 'en', { time: true }), '28 Oct 2026, 23:30');
  assert.equal(formatDate(late, 'zh-CN', { time: true }), '2026年10月28日 23:30');
  assert.equal(formatDate('2026-10-28', 'zh-CN', { time: true }), '2026年10月28日', 'no time when Notion has none');
  assert.equal(isoDatetime(late), late);
  assert.equal(isoDatetime('2026-10-28'), '2026-10-28');
});

test('newestFirst orders by Notion date-time as instants, then creation time, then title', () => {
  const posts = [
    { title: 'day-only, created earlier', date: '2026-10-28', created: '2026-10-20T00:00:00.000Z' },
    { title: '09:00 Taipei', date: '2026-10-28T09:00:00.000+08:00', created: '2026-10-01T00:00:00.000Z' },    // 01:00Z
    { title: '07:00 Taipei', date: '2026-10-28T07:00:00.000+08:00', created: '2026-10-01T00:00:00.000Z' },    // 27th 23:00Z
    { title: 'day-only, created later', date: '2026-10-28', created: '2026-10-25T00:00:00.000Z' },
    { title: 'older day', date: '2026-10-27', created: '2026-10-27T00:00:00.000Z' },
  ];
  assert.deepEqual([...posts].sort(newestFirst).map((p) => p.title), [
    '09:00 Taipei', 'day-only, created later', 'day-only, created earlier', '07:00 Taipei', 'older day',
  ]);
  // A plain string sort — what ORDER BY date did — gets this wrong:
  const byString = [...posts].sort((a, b) => b.date.localeCompare(a.date)).map((p) => p.title);
  assert.notDeepEqual(byString.slice(0, 4), ['09:00 Taipei', 'day-only, created later', 'day-only, created earlier', '07:00 Taipei']);
  assert.equal(instant('garbage'), 0);
});

/** Shape of a messages object: nested keys, with functions marked as such. */
const shape = (value) =>
  typeof value === 'function' ? `fn/${value.length}` : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
    : typeof value;

test('the Chinese dictionary has exactly the English keys, and no empty strings', () => {
  const en = messages('en');
  const zh = messages('zh-CN');
  assert.deepEqual(shape(zh), shape(en));
  const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
  for (const text of strings(zh)) assert.ok(text.trim(), 'no blank translation');
  assert.equal(zh.home.latest, '最新');
  assert.equal(zh.nav.latest, '最新');
  assert.equal(en.nav.latest, 'latest');
  assert.equal(zh.article.readingTime(5), '阅读约 5 分钟');
  assert.equal(en.search.results(1, 'x'), '1 result for “x”.');
});

test('site copy exists in both languages with the same facts layout', () => {
  assert.deepEqual(Object.keys(copy['zh-CN']).sort(), Object.keys(copy.en).sort());
  assert.equal(copy['zh-CN'].facts.length, copy.en.facts.length);
});

test('sitemap lists every page in both languages with hreflang alternates', () => {
  const xml = sitemap({ origin: 'https://site.test', articles: [{ href: '/articles/a', updated: '2026-10-01T00:00:00Z', date: '2026-10-01' }] });
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(xml, /<loc>https:\/\/site\.test\/articles\/a<\/loc>/);
  assert.match(xml, /<loc>https:\/\/site\.test\/zh-CN\/articles\/a<\/loc>/);
  assert.match(xml, /<loc>https:\/\/site\.test\/zh-CN<\/loc>/);
  assert.match(xml, /hreflang="zh-CN" href="https:\/\/site\.test\/zh-CN\/articles\/a"/);
  assert.match(xml, /hreflang="x-default" href="https:\/\/site\.test\/articles\/a"/);
});

/* ── Chinese display type ─────────────────────────────────────────────── */

const css = (name) => readFileSync(path.join(root, 'src/ui/styles', name), 'utf8');

test('every condensed (font-stretch: 62%) element uses the display stack with the Chinese cut', () => {
  const base = css('base.css');
  // The selector list may span several lines; it follows a comment, hence no `/` in the capture.
  const listed = /([^{}/]+)\{\s*font-family:\s*var\(--display\);\s*\}/.exec(base);
  assert.ok(listed, 'base.css declares the display selector list');
  const display = new Set(listed[1].split(',').map((s) => s.trim()));
  assert.match(base, /--display:\s*'Archivo Variable',\s*'Red Room Display SC'/);

  const condensed = readdirSync(path.join(root, 'src/ui/styles'))
    .filter((name) => name.endsWith('.css'))
    .flatMap((name) => [...css(name).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^}]*font-stretch:\s*62%[^}]*\}/g)]
      .flatMap((match) => match[1].split(',').map((s) => s.trim()).filter(Boolean).map((selector) => `${name}: ${selector}`)));
  assert.ok(condensed.length >= 8);
  const missing = condensed.filter((entry) => !display.has(entry.split(': ')[1]));
  assert.deepEqual(missing, [], 'add these selectors to the display list in base.css');
});

test('the generated display font: OFL licence, one face per slice, no emoji ranges, size-adjusted', () => {
  const dir = path.join(root, 'public/fonts/display-sc');
  const files = readdirSync(dir);
  assert.ok(files.includes('OFL.txt'));
  const sheet = readFileSync(path.join(dir, 'display-sc.css'), 'utf8');
  const urls = [...sheet.matchAll(/url\('\.\/([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(urls.length > 50);
  for (const url of urls) assert.ok(files.includes(url), `missing ${url}`);
  assert.equal(files.filter((f) => f.endsWith('.woff2')).length, urls.length, 'no orphaned font files');
  const starts = [...sheet.matchAll(/U\+([0-9a-f]+)/gi)].map((m) => parseInt(m[1], 16));
  assert.ok(starts.length > 1000);
  assert.ok(starts.every((code) => code < 0x1f000), 'emoji (U+1F000+) are left to the system colour-emoji font');
  assert.match(sheet, /font-family: 'Red Room Display SC'/);
  assert.match(sheet, /size-adjust: 88%/);
  assert.match(sheet, /font-weight: 700 900/);
});

/* ── /more content ─────────────────────────────────────────────────────── */

test('More prompts, statuses, CTA labels and print-run labels are bilingual', () => {
  const en = messages('en');
  const zh = messages('zh-CN');
  assert.equal(en.home.moreHint, 'Some important works are not available here, for now.');
  assert.equal(zh.home.moreHint, '部分重要作品，暂时不打算放在这里。');
  assert.equal(en.home.moreTopics, 'Print editions · Excerpts · Elsewhere');
  assert.equal(zh.home.moreTopics, '纸本出版物 · 选读 · 联系方式');
  assert.equal(en.more.publications, 'Print editions');
  assert.equal(zh.more.publications, '纸本出版物');
  assert.equal(en.more.elsewhere, 'Elsewhere');
  assert.equal(zh.more.elsewhere, '联系');
  assert.deepEqual(en.more.availability, { 'sold-out': 'Sold out', contact: 'Available by enquiry', preorder: 'In preparation' });
  assert.deepEqual(zh.more.availability, { 'sold-out': '已售罄', contact: '可联系作者', preorder: '整理中' });
  assert.equal(en.more.contactAuthor, 'Contact the author');
  assert.equal(zh.more.contactAuthor, '联系作者');
  assert.equal(en.more.registerInterest, 'Register interest');
  assert.equal(zh.more.registerInterest, '登记预订意向');
  assert.equal(en.more.edition, 'Print run');
  assert.equal(zh.more.edition, '印数');
  assert.equal(en.more.plannedPrintRun, 'Planned print run');
  assert.equal(zh.more.plannedPrintRun, '预计首印');
});

test('/more content: every translated text has both languages; the page resolves per locale', async () => {
  const { more } = await import('../src/content/more.ts');
  const texts = [];
  const walk = (value, where) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && ('en' in value || 'zh-CN' in value)) texts.push([where, value]);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, `${where}.${key}`);
  };
  walk(more, 'more');
  assert.ok(texts.length > 5);
  for (const [where, value] of texts) {
    assert.ok(value.en?.trim() && value['zh-CN']?.trim(), `${where} needs both en and zh-CN`);
  }
  for (const item of more.publications) assert.ok(item.title && item.year && Array.isArray(item.excerpt), 'title, year and excerpt are required');
  assert.equal(more.intro.en, 'I write fiction and poetry, and record dreams in forms I have no need to define. This site holds drafts and experiments; the shorter works I am more satisfied with are collected and printed separately.');
  assert.equal(more.intro['zh-CN'], '写小说和诗，也用一些不必明确定义的形式记录梦。这里放着草稿和小样；相对满意的中短篇，会另行整理成纸本。');
  assert.deepEqual(more.publications.map((item) => [item.title.en, item.title['zh-CN'], item.availability]), [
    ['The Weak Demon', '孱弱的恶', 'sold-out'],
    ['Animal Specimens', '动物标本', 'contact'],
    ['Studies in Nature', '自然研究', 'preorder'],
  ]);
  assert.deepEqual(more.publications.map((item) => item.subtitle), [
    { en: 'A self-published collection of fiction', 'zh-CN': '自印小说集' },
    { en: 'A fiction collection published by 副本制作, an independent press.', 'zh-CN': '独立小说集，由「副本制作」出版。' },
    { en: 'Working title; the final text is being prepared.', 'zh-CN': '暂定名，正在整理定稿。' },
  ]);
  assert.deepEqual(more.publications.map((item) => item.year), [
    { en: '2025.12', 'zh-CN': '2025.12' },
    { en: '2026.03', 'zh-CN': '2026.03' },
    { en: '2026–2027 (planned)', 'zh-CN': '2026–2027（预计）' },
  ]);
  assert.deepEqual(more.publications.map((item) => item.edition), [
    { en: '20 copies', 'zh-CN': '20 本' }, undefined, { en: '20 copies', 'zh-CN': '20 本' },
  ]);
  assert.deepEqual(more.publications.map((item) => item.size), [
    { en: '128 × 198 mm', 'zh-CN': '128 × 198 mm' },
    { en: '130 × 184 mm', 'zh-CN': '130 × 184 mm' }, undefined,
  ]);
  assert.equal(more.publications.every((item) => !item.cover && !item.excerptSource && item.excerpt.length === 0), true);
  assert.equal(more.publications.every((item) => !item.format && item.pages === undefined && !item.link), true);
  assert.deepEqual(more.channels, [], 'no fake social accounts or QR frames');
});
