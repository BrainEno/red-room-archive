// Bilingual tag topics (src/core/tags.ts): one topic per meaning, labelled per language.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTagIndex, parseGlossary, splitBilingual, tagLang } from '../src/core/tags.ts';
import { BUILTIN_TAG_GLOSSARY } from '../src/content/tags.ts';

test('glossary lines: several names per side, comments and junk ignored', () => {
  assert.deepEqual(parseGlossary('# comment\nPoetry, Poem = 诗歌，诗\n\nlonely\nFiction ＝ 小说'), [
    { key: 'poetry', en: ['Poetry', 'Poem'], zh: ['诗歌', '诗'] },
    { key: 'fiction', en: ['Fiction'], zh: ['小说'] },
  ]);
  assert.equal(tagLang('Notion'), 'en');
  assert.equal(tagLang('写作 2026'), 'zh');
});

test('bilingual names written in Notion split into their halves', () => {
  assert.deepEqual(splitBilingual('Fiction / 小说'), { en: 'Fiction', zh: '小说' });
  assert.deepEqual(splitBilingual('小说｜Fiction'), { en: 'Fiction', zh: '小说' });
  assert.equal(splitBilingual('AC/DC'), null, 'two Latin halves are one name');
  assert.equal(splitBilingual('a / b / 小说'), null);
});

test('the reported bug: Fiction and 小说 are one topic, shown once per language', () => {
  const articles = [{ tags: ['Fiction'] }, { tags: ['小说'] }, { tags: ['小说', 'Fiction'] }, { tags: ['Notion'] }];
  const index = createTagIndex([BUILTIN_TAG_GLOSSARY], articles.map((a) => a.tags));
  assert.deepEqual(index.counts(articles, 'zh'), [
    { key: 'fiction', slug: 'fiction', name: '小说', count: 3 },
    { key: 'notion', slug: 'notion', name: 'Notion', count: 1 },
  ]);
  assert.deepEqual(index.counts(articles, 'en').map((t) => t.name), ['Fiction', 'Notion']);
  assert.deepEqual(index.names(['小说', 'Fiction'], 'en'), ['Fiction'], 'one name per topic on an article');
  assert.ok(index.matches(['Fiction'], '小说'));
  assert.ok(index.matches(['小说'], 'FICTION'));
  assert.ok(!index.matches(['Notion'], '小说'));
});

test('labels follow actual usage, then the glossary, then the other language', () => {
  const index = createTagIndex([BUILTIN_TAG_GLOSSARY], [['Poem'], ['Poem'], ['诗'], ['红房间']]);
  const poem = index.group('诗歌');
  assert.equal(index.label(poem, 'en'), 'Poem', 'used name beats the glossary’s first name');
  assert.equal(index.label(poem, 'zh'), '诗');
  assert.equal(index.label(index.group('Essay'), 'zh'), '随笔', 'unused topic falls back to the glossary');
  assert.equal(index.label(index.group('红房间'), 'en'), '红房间', 'untranslated tags show as written');
});

test('a pair written once in Notion teaches every other article; admin lines override', () => {
  const learned = createTagIndex([], [['Dream Logic / 梦的逻辑'], ['梦的逻辑'], ['Dream logic']]);
  assert.equal(learned.counts([{ tags: ['梦的逻辑'] }, { tags: ['Dream logic'] }], 'en')[0].count, 2);
  assert.equal(learned.label(learned.group('梦的逻辑'), 'en'), 'Dream Logic');

  const custom = createTagIndex([BUILTIN_TAG_GLOSSARY, 'Fiction = 虚构'], [['Fiction']]);
  assert.equal(custom.label(custom.group('Fiction'), 'zh'), '虚构');
  assert.deepEqual(custom.aliases(['Fiction']).sort(), ['Fiction', '虚构'].sort());
});

test('built-in glossary: every line parses and no name belongs to two topics', () => {
  const lines = BUILTIN_TAG_GLOSSARY.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  const groups = parseGlossary(BUILTIN_TAG_GLOSSARY);
  assert.equal(groups.length, lines.length);
  const seen = new Map();
  for (const group of groups) {
    assert.ok(group.en.length && group.zh.length, `${group.key} has both languages`);
    for (const name of [...group.en, ...group.zh]) {
      const key = name.toLowerCase();
      assert.ok(!seen.has(key), `${name} is in both ${seen.get(key)} and ${group.key}`);
      seen.set(key, group.key);
    }
  }
});

test('topic slugs: one per topic, stable, collision-free; every alias resolves to it', () => {
  const articles = [{ tags: ['Fiction'] }, { tags: ['小说'] }, { tags: ['Short Fiction'] }, { tags: ['short-fiction'] }, { tags: ['红房间'] }, { tags: ['★'] }];
  const index = createTagIndex([BUILTIN_TAG_GLOSSARY], articles.map((a) => a.tags));
  assert.equal(index.slug(index.group('小说')), 'fiction', 'a pair has its English key as slug');
  assert.equal(index.slug(index.group('红房间')), '红房间', 'untranslated Chinese keeps its letters');
  assert.match(index.slug(index.group('★')), /^t-[0-9a-f]{8}$/, 'no letters at all: a hash');
  const a = index.slug(index.group('Short Fiction'));
  const b = index.slug(index.group('short-fiction'));
  assert.equal(a, 'short-fiction', 'the key that sorts first keeps the plain slug');
  assert.match(b, /^short-fiction-[0-9a-f]{6}$/);
  assert.deepEqual(index.bySlug('fiction'), { group: index.group('Fiction'), canonical: true });
  assert.equal(index.bySlug('小说').group.key, 'fiction');
  assert.equal(index.bySlug('小说').canonical, false);
  assert.equal(index.bySlug('FICTION').canonical, false);
  assert.equal(index.bySlug(b).group.key, 'short-fiction');
  assert.equal(index.bySlug('nothing-here'), undefined);
  assert.deepEqual(index.topics(['小说', 'Fiction', '红房间'], 'zh'), [{ name: '小说', slug: 'fiction' }, { name: '红房间', slug: '红房间' }]);
  // Usage does not move slugs: the same topics with different counts keep theirs.
  const again = createTagIndex([BUILTIN_TAG_GLOSSARY], [['short-fiction'], ['short-fiction'], ['Short Fiction'], ['Fiction']]);
  assert.equal(again.slug(again.group('short-fiction')), b);
});
