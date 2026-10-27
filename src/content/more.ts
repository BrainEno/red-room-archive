/**
 * The “More / 更多” page (/more): self-published books with excerpts, and
 * ways to reach you. Edit this file to change the page — no Notion or admin
 * involved. Every text can be one string (shown in both interface languages)
 * or `{ en, 'zh-CN' }`.
 *
 * Images: put files in `public/more/` and reference them as `/more/<file>`
 * (or upload in /admin → Files and use `/uploads/<file>`).
 *   - cover: any ratio works; about 1200 px on the long side is plenty.
 *     Leave it out and the page draws a typographic cover in the site style.
 *   - qr: a square PNG/SVG of the QR code (WeChat, Xiaohongshu, …). Leave it
 *     out to show the account as text only; `qr: ''` shows an empty frame
 *     (useful while you are still collecting the codes).
 *
 * ⚠ The entries below are SAMPLES so the layout can be previewed — replace them.
 */
import type { Locale } from '../shared/i18n.ts';

export type Text = string | Record<Locale, string>;

export interface Publication {
  title: Text;
  subtitle?: Text;
  year: string;
  /** Printing / binding, e.g. “Risograph, two colours”. */
  format?: Text;
  pages?: number;
  /** Print run, e.g. “Edition of 100”. */
  edition?: Text;
  size?: Text;
  cover?: string;
  /** Selected passage, one string per paragraph. */
  excerpt: Text[];
  /** Where the passage is from, e.g. “from chapter three”. */
  excerptSource?: Text;
  /** Shop or order page; without it the page offers an email link instead. */
  link?: { href: string; label?: Text };
}

export interface Channel {
  /** Platform, e.g. “微信公众号 / WeChat”. */
  name: Text;
  handle: string;
  href?: string;
  qr?: string;
  note?: Text;
}

export interface MoreContent {
  intro: Text;
  publications: Publication[];
  channels: Channel[];
}

export const more: MoreContent = {
  intro: {
    en: 'Placeholder — a line or two about the books you print yourself: why you make them, how to get a copy.',
    'zh-CN': '占位文字——用一两句话介绍你的自印出版物：为什么做书，怎样得到一本。',
  },

  publications: [
    {
      title: { en: 'Zine No. 01', 'zh-CN': '自印本 01' },
      subtitle: { en: 'Sample entry — one line about the book', 'zh-CN': '示例条目——一句话介绍这本书' },
      year: '2026',
      format: { en: 'Risograph, two colours', 'zh-CN': 'Risograph 双色印刷' },
      pages: 48,
      edition: { en: 'Edition of 100', 'zh-CN': '限量 100 册' },
      size: 'A5 · 148 × 210 mm',
      excerpt: [
        {
          en: 'Put a passage from the book here. Pick one that stands on its own — a few hundred words that make a reader want the rest. Paragraph breaks are kept as written.',
          'zh-CN': '这里放一段书中的选读。挑一段能够独立成立的文字——两三百字，让读的人想要读完整本。段落会按照你写下的样子分开。',
        },
        {
          en: 'A second paragraph is fine too. Longer excerpts work, but the page reads best when each book gets about the same space.',
          'zh-CN': '也可以有第二段。更长的选读同样可以，不过每本书篇幅相近时，整页读起来最舒服。',
        },
      ],
      excerptSource: { en: 'from the opening chapter', 'zh-CN': '选自第一章' },
    },
    {
      title: { en: 'Zine No. 02', 'zh-CN': '自印本 02' },
      subtitle: { en: 'Sample entry — poems and photographs', 'zh-CN': '示例条目——诗与照片' },
      year: '2025',
      format: { en: 'Digital print, saddle-stitched', 'zh-CN': '数码印刷，骑马钉' },
      pages: 32,
      edition: { en: 'Edition of 60', 'zh-CN': '限量 60 册' },
      size: '170 × 240 mm',
      excerpt: [
        {
          en: 'Short excerpts look good as well: a single stanza, or the first lines of the book.',
          'zh-CN': '短一点的选读也很好看：一节诗，或者书的开头几行。',
        },
      ],
    },
    {
      title: { en: 'Zine No. 03', 'zh-CN': '自印本 03' },
      subtitle: { en: 'Sample entry — sold out', 'zh-CN': '示例条目——已售完' },
      year: '2024',
      format: { en: 'Photocopy, hand-bound', 'zh-CN': '复印，手工装订' },
      pages: 24,
      edition: { en: 'Edition of 30 (sold out)', 'zh-CN': '限量 30 册（已售完）' },
      excerpt: [
        {
          en: 'Add a shop link and the button below points to it; without one, it opens an email to you with the book’s title as the subject.',
          'zh-CN': '填上购买链接，下面的按钮就会指向它；没有的话，按钮会打开一封以书名为主题、写给你的邮件。',
        },
      ],
    },
  ],

  channels: [
    { name: { en: 'WeChat Official Account', 'zh-CN': '微信公众号' }, handle: 'your-account', qr: '' },
    { name: { en: 'Xiaohongshu', 'zh-CN': '小红书' }, handle: 'your-handle', qr: '' },
    { name: 'Instagram', handle: '@your-handle', href: 'https://instagram.com/', qr: '' },
  ],
};
