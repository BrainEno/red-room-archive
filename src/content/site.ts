/**
 * Site content defaults.
 *
 * Everything a visitor reads that is *not* stored in Notion lives here:
 * identity, editorial copy, the facts column on the intro, section labels and
 * the demo articles shown while Notion is not configured.
 *
 * Keep this module safe to commit: no tokens, no private content. Live values
 * (name, email, about, intro) can be overridden at runtime from /admin.
 */
import type { NotionBlock } from '../core/blocks.ts';
import type { Locale } from '../shared/i18n.ts';

/** Locale-neutral identity. */
export interface SiteIdentity {
  name: string;
  email: string;
}

/**
 * Editorial copy, one set per interface language. Interface chrome (nav,
 * buttons, section titles) lives in ui/i18n.ts; this is the text that is
 * *about you* and that /admin can override (`about`, `intro`).
 */
export interface SiteCopy {
  /** One line: meta description, RSS description. */
  about: string;
  /** Two or three sentences shown in the intro section, revealed word by word. */
  intro: string;
  /** Short line in the homepage's bottom meta row. */
  tagline: string;
  facts: { key: string; value: string }[];
  /** Lead paragraph of the /articles index. */
  articlesIntro: string;
}

export const site: SiteIdentity = {
  name: 'Red Room Archive',
  email: '',
};

export const copy: Record<Locale, SiteCopy> = {
  en: {
    about: 'Writing, published from Notion.',
    intro:
      'Placeholder — replace this with two or three sentences about yourself. Say who you are, what you write about, and what a visitor will find once they step through the curtain.',
    tagline: 'Essays, notes and fiction',
    facts: [
      { key: 'Based in', value: 'Your city' },
      { key: 'Writing', value: 'Essays, notes and fiction' },
      { key: 'Currently', value: 'A short line about what you are working on' },
    ],
    articlesIntro: 'Everything published from the notebook, newest first.',
  },
  'zh-CN': {
    about: '写作，发布自 Notion。',
    intro: '占位文字——请在后台换成两三句关于你自己的话：你是谁，写些什么，访客掀开帷幕之后会看到什么。',
    tagline: '随笔、札记与小说',
    facts: [
      { key: '所在', value: '你的城市' },
      { key: '写作', value: '随笔、札记与小说' },
      { key: '近况', value: '一句话说说你正在写的东西' },
    ],
    articlesIntro: '笔记本里发布的全部文章，按时间由新到旧排列。',
  },
};

/* ── Demo articles ────────────────────────────────────────────────────
 * Shown only while NOTION_TOKEN / NOTION_DATABASE_ID are missing, so a fresh
 * checkout renders a complete site. Bodies use the Notion block format and go
 * through the same renderer as real pages.
 */

export interface DemoArticle {
  id: string;
  slug: string;
  title: string;
  date: string;
  tags: string[];
  excerpt: string;
  rank: number;
  blocks: NotionBlock[];
}

const t = (content: string, annotations: Record<string, unknown> = {}) => ({
  type: 'text',
  plain_text: content,
  text: { content },
  annotations,
});
const p = (...rich: ReturnType<typeof t>[]) => ({ type: 'paragraph', paragraph: { rich_text: rich } });
const h = (level: 1 | 2 | 3, content: string) => ({ type: `heading_${level}`, [`heading_${level}`]: { rich_text: [t(content)] } });
const li = (content: string) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [t(content)] } });

export const demoArticles: DemoArticle[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'connect-notion',
    title: 'Connect your Notion database',
    date: '2026-10-20',
    tags: ['Guide'],
    excerpt: 'This is a demo article. Add a Notion token and database id in /admin to publish your own writing.',
    rank: 1,
    blocks: [
      p(t('This site publishes the pages of '), t('one Notion database', { bold: true }), t('. Until it is connected you are looking at demo content.')),
      { type: 'table_of_contents', table_of_contents: {} },
      h(2, 'Database columns'),
      p(t('Only a title column is required. Everything else is optional and recognised by name:')),
      {
        type: 'table',
        table: { table_width: 3, has_column_header: true, has_row_header: true },
        children: [
          ['Column', 'Type', 'Used for'],
          ['Slug', 'Text', 'The URL; defaults to the title'],
          ['Date', 'Date', 'Publish date; future dates stay hidden'],
          ['Published', 'Checkbox', 'Only checked pages are shown'],
          ['Tags', 'Multi-select', 'Topics and tag filters'],
          ['Excerpt', 'Text', 'Summary in lists and feeds'],
          ['FeaturedImage', 'Files', 'Cover image'],
          ['Rank', 'Number', 'Featured articles on the homepage'],
        ].map((cells) => ({ type: 'table_row', table_row: { cells: cells.map((c) => [t(c)]) } })),
      },
      h(2, 'Connecting'),
      li('Create an internal integration at notion.so/my-integrations and copy its token.'),
      li('Share the database with the integration (••• → Connections).'),
      li('Paste the token and the database link in /admin → Settings, then press “Check columns”.'),
      { type: 'callout', callout: { icon: { type: 'emoji', emoji: '💡' }, color: 'gray_background', rich_text: [t('Notion stays the only source: edit there, the site follows within a few minutes.')] } },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    slug: 'a-room-with-red-curtains',
    title: 'A room with red curtains',
    date: '2026-09-12',
    tags: ['Essay', 'Notes'],
    excerpt: 'A demo essay showing quotes, toggles, code and columns rendered from Notion blocks.',
    rank: 0,
    blocks: [
      p(t('Every archive starts as a room you keep returning to. The curtains are drawn, the floor is patterned, and the clock is a little wrong.')),
      { type: 'quote', quote: { rich_text: [t('The owls are not what they seem.')] } },
      h(2, 'Fragments'),
      {
        type: 'column_list',
        column_list: {},
        children: [
          { type: 'column', column: {}, children: [p(t('Left column: drafts that never became essays.'))] },
          { type: 'column', column: {}, children: [p(t('Right column: notes that should have stayed notes.'))] },
        ],
      },
      { type: 'toggle', toggle: { rich_text: [t('A footnote, folded away')] }, children: [p(t('Toggles in Notion become disclosure widgets here.', { italic: true }))] },
      { type: 'code', code: { language: 'javascript', rich_text: [t("console.log('the red room');")], caption: [] } },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    slug: 'notes-on-light',
    title: 'Notes on light',
    date: '2026-07-03',
    tags: ['Notes'],
    excerpt: 'Short notes, published from the same database.',
    rank: 0,
    blocks: [
      p(t('Light through a curtain is never one colour.')),
      { type: 'to_do', to_do: { checked: true, rich_text: [t('Write it down')] } },
      { type: 'to_do', to_do: { checked: false, rich_text: [t('Publish it')] } },
      { type: 'divider', divider: {} },
      p(t('Red', { color: 'red' }), t(' is the colour this site remembers.')),
    ],
  },
];
