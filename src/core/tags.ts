/**
 * Bilingual tags.
 *
 * Notion has one multi-select for tags, so an archive written in two
 * languages ends up with pairs like `Fiction` and `小说` that mean the same
 * thing. This module groups such names into one topic and picks the name to
 * show for each interface language, so the Chinese interface lists 小说 once
 * and the English one lists Fiction once.
 *
 * A topic is found, in order, from:
 *  1. the glossary — built-in pairs (content/tags.ts) plus the admin's own
 *     lines (`Fiction = 小说`), the admin's taking precedence;
 *  2. a bilingual tag written in Notion itself, e.g. `Fiction / 小说`, which
 *     also teaches the pair to every other article (plain `小说` elsewhere
 *     joins the same topic);
 *  3. otherwise the tag is a topic of its own and shows as written in both
 *     languages (there is nothing to translate it with).
 *
 * Display names prefer what the archive actually uses: if articles are tagged
 * `Poem`, the English label is `Poem` even though the glossary also knows
 * `Poetry`. Pure functions — no I/O.
 *
 * Every topic also has one URL slug (`/topics/<slug>`), derived from its key
 * so it does not move when usage changes. Any other name of the topic
 * resolves to it too (`/topics/小说` finds Fiction and redirects).
 */
import { fnv1a, topicSlug } from '../shared/routes.ts';

export type TagLang = 'en' | 'zh';

/** A set of names that mean the same thing; the first name per language is the preferred label. */
export interface TagGroup {
  key: string;
  en: string[];
  zh: string[];
}

const HAN = /\p{Script=Han}/u;

/** Which language a single tag name is written in. */
export const tagLang = (name: string): TagLang => (HAN.test(name) ? 'zh' : 'en');

const norm = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** `Fiction / 小说`, `小说｜Fiction`, `Fiction | 小说` → both halves, when exactly one half is Chinese. */
export function splitBilingual(name: string): { en: string; zh: string } | null {
  const parts = name.split(/\s*[/|｜／]\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (tagLang(a) === tagLang(b)) return null;
  return tagLang(a) === 'en' ? { en: a, zh: b } : { en: b, zh: a };
}

/**
 * Glossary text, one topic per line: `English names = 中文名`, several names
 * per side separated by commas (the first is the preferred label).
 * Blank lines and lines starting with `#` are ignored.
 *
 *     Fiction = 小说
 *     Poetry, Poem = 诗歌, 诗
 */
export function parseGlossary(text: string): TagGroup[] {
  const groups: TagGroup[] = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const names = line
      .split(/\s*[=＝]\s*|\s*[,，、]\s*/)
      .map((name) => name.trim())
      .filter(Boolean);
    const en = names.filter((name) => tagLang(name) === 'en');
    const zh = names.filter((name) => tagLang(name) === 'zh');
    if (en.length + zh.length < 2) continue;
    groups.push({ key: norm(en[0] ?? zh[0]), en, zh });
  }
  return groups;
}

/** A topic as linked from an article: display name plus URL slug. */
export interface TopicRef {
  name: string;
  slug: string;
}

export interface TagIndex {
  /** The topic a tag name (or a `?tag=` value) belongs to. */
  group(name: string): TagGroup;
  /** Display name of a topic in one language. */
  label(group: TagGroup, lang: TagLang): string;
  /** An article's tags as display names: one per topic, in the article's order. */
  names(tags: string[], lang: TagLang): string[];
  /** An article's tags as links: one per topic, in the article's order. */
  topics(tags: string[], lang: TagLang): TopicRef[];
  /** Topics with article counts, most used first. */
  counts(articles: { tags: string[] }[], lang: TagLang): { key: string; slug: string; name: string; count: number }[];
  /** The topic's URL slug — unique across the index. */
  slug(group: TagGroup): string;
  /**
   * The topic a URL slug points at. `canonical` is false when the slug is
   * another name of the topic (`小说`, `Fiction`) — redirect to `slug(group)`.
   */
  bySlug(slug: string): { group: TagGroup; canonical: boolean } | undefined;
  /** True when any of `tags` belongs to the same topic as `query`. */
  matches(tags: string[], query: string): boolean;
  /** Every name a topic is known by (both languages) — for search. */
  aliases(tags: string[]): string[];
}

/**
 * Build the index for one request.
 * @param glossaries glossary texts, lowest precedence first (built-in, then admin)
 * @param articleTags every article's tags, so labels follow actual usage
 */
export function createTagIndex(glossaries: string[], articleTags: string[][] = []): TagIndex {
  const byName = new Map<string, TagGroup>();
  const register = (group: TagGroup) => {
    for (const name of [...group.en, ...group.zh]) byName.set(norm(name), group);
  };
  for (const text of glossaries) for (const group of parseGlossary(text)) register(group);

  // Pairs written in Notion as `Fiction / 小说` join (or extend) a topic.
  for (const tags of articleTags) {
    for (const tag of tags) {
      const pair = splitBilingual(tag);
      if (!pair || byName.has(norm(tag))) continue;
      const known = byName.get(norm(pair.en)) ?? byName.get(norm(pair.zh));
      const group = known
        ? { ...known, en: known.en.includes(pair.en) ? known.en : [...known.en, pair.en], zh: known.zh.includes(pair.zh) ? known.zh : [...known.zh, pair.zh] }
        : { key: norm(pair.en), en: [pair.en], zh: [pair.zh] };
      register(group);
      byName.set(norm(tag), group);
    }
  }

  const solo = new Map<string, TagGroup>();
  const group = (name: string): TagGroup => {
    const found = byName.get(norm(name));
    if (found) return found;
    const key = norm(name);
    let made = solo.get(key);
    if (!made) {
      const clean = name.trim();
      made = { key, en: tagLang(clean) === 'en' ? [clean] : [], zh: tagLang(clean) === 'zh' ? [clean] : [] };
      solo.set(key, made);
    }
    return made;
  };

  // Usage per topic and language: names as written on articles, most used first.
  const usage = new Map<string, Map<string, number>>();
  const use = (key: string, name: string) => {
    const counts = usage.get(key) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    usage.set(key, counts);
  };
  for (const tags of articleTags) {
    for (const tag of tags) {
      const topic = group(tag);
      const pair = splitBilingual(tag);
      if (pair) {
        use(topic.key, pair.en);
        use(topic.key, pair.zh);
      } else use(topic.key, tag.trim());
    }
  }
  const mostUsed = (topic: TagGroup, lang: TagLang) => {
    let best: string | undefined;
    let bestCount = 0;
    for (const [name, count] of usage.get(topic.key) ?? []) {
      if (tagLang(name) === lang && count > bestCount) [best, bestCount] = [name, count];
    }
    return best;
  };

  const label = (topic: TagGroup, lang: TagLang): string => {
    const other: TagLang = lang === 'en' ? 'zh' : 'en';
    return mostUsed(topic, lang) ?? topic[lang][0] ?? mostUsed(topic, other) ?? topic[other][0] ?? topic.key;
  };

  const names = (tags: string[], lang: TagLang) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of tags) {
      const topic = group(tag);
      if (seen.has(topic.key)) continue;
      seen.add(topic.key);
      out.push(label(topic, lang));
    }
    return out;
  };

  // URL slugs. Every known topic (glossary, Notion pairs, tags in use) gets
  // the slug of its key; on a collision (`Short fiction` / `short-fiction`)
  // the key that sorts first keeps the plain slug, the others get a suffix.
  let slugs: { byKey: Map<string, string>; byGroup: Map<string, TagGroup>; groups: TagGroup[] } | undefined;
  const slugTable = () => {
    if (slugs) return slugs;
    const groups = new Map<string, TagGroup>();
    for (const topic of byName.values()) groups.set(topic.key, topic);
    for (const tags of articleTags) for (const tag of tags) { const topic = group(tag); groups.set(topic.key, topic); }
    const byKey = new Map<string, string>();
    const byGroup = new Map<string, TagGroup>();
    const sorted = [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const topic of sorted) {
      let slug = topicSlug(topic.key);
      if (byGroup.has(slug)) slug = `${slug}-${fnv1a(topic.key).slice(0, 6)}`;
      byKey.set(topic.key, slug);
      byGroup.set(slug, topic);
    }
    slugs = { byKey, byGroup, groups: sorted };
    return slugs;
  };
  const slug = (topic: TagGroup) => slugTable().byKey.get(topic.key) ?? topicSlug(topic.key);

  const bySlug = (value: string) => {
    const table = slugTable();
    const exact = table.byGroup.get(value);
    if (exact) return { group: exact, canonical: true };
    const wanted = topicSlug(value);
    const normalized = table.byGroup.get(wanted);
    if (normalized) return { group: normalized, canonical: false };
    const alias = table.groups.find((topic) => [topic.key, ...topic.en, ...topic.zh].some((name) => topicSlug(name) === wanted));
    return alias ? { group: alias, canonical: false } : undefined;
  };

  const topics = (tags: string[], lang: TagLang) => {
    const seen = new Set<string>();
    const out: TopicRef[] = [];
    for (const tag of tags) {
      const topic = group(tag);
      if (seen.has(topic.key)) continue;
      seen.add(topic.key);
      out.push({ name: label(topic, lang), slug: slug(topic) });
    }
    return out;
  };

  const counts = (articles: { tags: string[] }[], lang: TagLang) => {
    const totals = new Map<string, { topic: TagGroup; count: number }>();
    for (const article of articles) {
      const seen = new Set<string>();
      for (const tag of article.tags) {
        const topic = group(tag);
        if (seen.has(topic.key)) continue; // `Fiction` and `小说` on one article count once
        seen.add(topic.key);
        const entry = totals.get(topic.key) ?? { topic, count: 0 };
        entry.count += 1;
        totals.set(topic.key, entry);
      }
    }
    return [...totals.values()]
      .map(({ topic, count }) => ({ key: topic.key, slug: slug(topic), name: label(topic, lang), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, lang === 'zh' ? 'zh-Hans-CN' : 'en'));
  };

  const matches = (tags: string[], query: string) => {
    const wanted = group(query).key;
    return tags.some((tag) => group(tag).key === wanted);
  };

  const aliases = (tags: string[]) => [...new Set(tags.flatMap((tag) => [tag, ...group(tag).en, ...group(tag).zh]))];

  return { group, label, names, topics, counts, slug, bySlug, matches, aliases };
}
