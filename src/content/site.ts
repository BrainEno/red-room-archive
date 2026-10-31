/**
 * Site content defaults.
 *
 * Everything a visitor reads that is *not* stored in Notion lives here:
 * identity, editorial copy, the facts column on the intro, section labels and
 * the demo articles shown while Notion is not configured.
 *
 * Keep this module safe to commit: no tokens, no private content. Live values
 * (name, email, about, intro, tagline) can be overridden at runtime from /admin.
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
 * *about you* and that /admin can override (`about`, `intro`, `tagline`).
 */
export interface SiteCopy {
  /**
   * One line: homepage, meta description, RSS description. A trailing
   * attribution after a dash (`…战斗。——作者`, `… dignity. — Author`) is set on
   * its own line on the homepage (core/quote.ts).
   */
  about: string;
  /** Two or three sentences shown in the intro section, revealed word by word ('' = none). */
  intro: string;
  /** Short line in the homepage's bottom meta row. */
  tagline: string;
  /** Homepage facts row ([] = hidden). */
  facts: { key: string; value: string }[];
  /** Lead paragraph of the /articles index. */
  articlesIntro: string;
  /**
   * Small notice beside the neon sign on the first screen of the homepage
   * (`title: ''` hides it). `action` links to the site email with `subject`
   * as the email subject, or to /more when no email is set.
   */
  announce: { kicker: string; title: string; action: string; subject: string };
}

export const site: SiteIdentity = {
  name: 'SureShot Studio',
  email: 'nodeman24@outlook.com',
};

/**
 * An empty `intro` or `facts` hides that part of the homepage: with no intro
 * the `about` line takes the large, word-by-word intro slot instead. Both can
 * be filled in later from /admin (or site-profile.json) without a code change.
 */
export const copy: Record<Locale, SiteCopy> = {
  en: {
    about: 'Writing is nothing less than the artist’s duel with the audience—waged for the sake of one’s own singularity and dignity. — Witold Gombrowicz',
    intro: '',
    tagline: 'Fiction, poetry and other writings',
    facts: [],
    articlesIntro: 'Everything published from the notebook, newest first.',
    announce: { kicker: 'Forthcoming / New print', title: 'A book of fiction is going to print.', action: 'Pre-orders open — write to reserve a copy', subject: 'Pre-order' },
  },
  'zh-CN': {
    about: '写作就是艺术家为了自己的个性和荣誉跟大众进行的一场战斗。——维托尔德·贡布罗维奇',
    intro: '',
    tagline: '小说、诗歌以及其他',
    facts: [],
    articlesIntro: '笔记本里发布的全部文章，按时间由新到旧排列。',
    announce: { kicker: '即将付印 / NEW PRINT', title: '小说集，即将付印。', action: '接受预购，来信预留一册', subject: '预购小说集' },
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
      p(t('A title and a recognized Published column are required. Other columns are optional:')),
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
      h(2, 'Publishing'),
      p(t('Check Published on a page to make it visible. Set a Date to keep its publication date stable.')),
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
      h(2, 'Formulas and links'),
      p(
        t('Notion equations render as native MathML — inline, like '),
        { type: 'equation', plain_text: 'I \\propto 1/r^2', equation: { expression: 'I \\propto 1/r^2' }, annotations: {} } as unknown as ReturnType<typeof t>,
        t(', or as a block:'),
      ),
      { type: 'equation', equation: { expression: 'E = h\\nu = \\frac{hc}{\\lambda}' } },
      p(t('A bookmark becomes a card; with a real Notion database the server also reads the page title and summary.')),
      { type: 'bookmark', bookmark: { url: 'https://en.wikipedia.org/wiki/Photon', caption: [] } },
    ],
  },
];
