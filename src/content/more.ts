/**
 * Built-in /more content. The admin can replace this whole bilingual document;
 * a saved MoreDocument always takes precedence over these defaults.
 *
 * Only supplied bibliographic facts belong here. Unknown specifications,
 * covers, excerpts and contact channels stay empty rather than becoming demo
 * content. English titles are working website translations, not claims of
 * published English editions.
 */
import type { MoreAvailability } from '../shared/contracts.ts';
import type { Locale } from '../shared/i18n.ts';

export type Text = string | Record<Locale, string>;
export type Paragraph = Text;

export interface Publication {
  title: Text;
  subtitle?: Text;
  /** Publication note shown below the subtitle; never treated as an excerpt. */
  description?: Text;
  /** Year or short date; a plain string in historical documents applies to both languages. */
  year: Text;
  availability?: MoreAvailability;
  /** Printing / binding, when known. */
  format?: Text;
  pages?: number;
  /** Print run; the view uses a planned-run label for preorder entries. */
  edition?: Text;
  size?: Text;
  /** Image URL; empty or omitted keeps the typographic cover. */
  cover?: string;
  /** Selected passages, deliberately empty until the author supplies them. */
  excerpt: Paragraph[];
  excerptSource?: Text;
  /** Optional external link. Status-specific CTA behaviour lives in ui/more-action.ts. */
  link?: string | { href: string; label?: Text };
  linkLabel?: Text;
}

export interface Channel {
  name: Text;
  handle?: string;
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
    en: 'I write fiction and poetry, and record dreams in forms I have no need to define. This site holds drafts and experiments; the shorter works I am more satisfied with are collected and printed separately.',
    'zh-CN': '写小说和诗，也用一些不必明确定义的形式记录梦。这里放着草稿和小样；相对满意的中短篇，会另行整理成纸本。',
  },
  publications: [
    {
      title: { en: 'The Weak Demon', 'zh-CN': '孱弱的恶' },
      subtitle: {
        en: 'A self-published collection of fiction',
        'zh-CN': '自印小说集',
      },
      year: { en: '2025.12', 'zh-CN': '2025.12' },
      availability: 'sold-out',
      edition: { en: '20 copies', 'zh-CN': '20 本' },
      size: { en: '128 × 198 mm', 'zh-CN': '128 × 198 mm' },
      excerpt: [],
    },
    {
      title: { en: 'Animal Specimens', 'zh-CN': '动物标本' },
      subtitle: {
        en: 'A fiction collection published by 副本制作, an independent press.',
        'zh-CN': '独立小说集，由「副本制作」出版。',
      },
      description: {
        en: 'Contact me to arrange a copy by post. The price is set by the publisher; I can help put you in touch with the sales channel.',
        'zh-CN': '可联系我安排邮寄。定价由出版方制定，我可以协助联系购买渠道。',
      },
      year: { en: '2026.03', 'zh-CN': '2026.03' },
      availability: 'contact',
      size: { en: '130 × 184 mm', 'zh-CN': '130 × 184 mm' },
      excerpt: [],
    },
    {
      title: { en: 'Studies in Nature', 'zh-CN': '自然研究' },
      subtitle: {
        en: 'Working title; the final text is being prepared.',
        'zh-CN': '暂定名，正在整理定稿。',
      },
      description: {
        en: 'Printing is tentatively planned for late 2026 or early 2027, with an initial run of 20 copies. You can contact me to register your interest; the schedule and quantity may change.',
        'zh-CN': '预计于 2026 年底至 2027 年初印刷，首印暂定 20 本。现可提前联系登记预订意向；印刷时间和数量仍可能调整。',
      },
      year: { en: '2026–2027 (planned)', 'zh-CN': '2026–2027（预计）' },
      availability: 'preorder',
      edition: { en: '20 copies', 'zh-CN': '20 本' },
      excerpt: [],
    },
  ],
  channels: [],
};
