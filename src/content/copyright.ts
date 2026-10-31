/**
 * /copyright — ownership, reuse terms, permissions and third-party credits,
 * in each interface language. The owner's name and email come from the site
 * profile (`site.ts` / settings), so the page follows whatever is set there.
 *
 * Paragraphs are lists of inline segments (plain text or `{ text, href }`),
 * rendered as text — no HTML in this file.
 */
import type { Locale } from '../shared/i18n.ts';

export type Inline = string | { text: string; href: string };
export type Block = { p: Inline[] } | { list: Inline[][] };
export interface CopyrightSection { id: string; title: string; body: Block[] }
export interface CopyrightDoc { title: string; intro: string; sections: CopyrightSection[]; updatedLabel: string }

/** Date of the last change to these terms (shown at the foot of the page). */
export const COPYRIGHT_UPDATED = '2026-10-31';

const REPO = 'https://github.com/BrainEno/red-room-archive';
const VENUS = 'https://sketchfab.com/3d-models/vinus-f834a1829fa240328525ff0292f4015e';
const THUNK3D = 'https://sketchfab.com/Lily.Qin1';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const OFL = 'https://openfontlicense.org/';
const TDMREP = 'https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/';

export function copyrightDoc(locale: Locale, owner: { name: string; email: string; year: number }): CopyrightDoc {
  const { name, email, year } = owner;
  const mail = email ? { text: email, href: `mailto:${email}` } : '';
  const repoFile = (file: string) => ({ text: file, href: `${REPO}/blob/main/${file}` });

  if (locale === 'zh-CN') {
    return {
      title: '版权声明',
      intro: `本站的全部文字、图片、页面设计与源代码均受著作权法保护，归 ${name} 所有，保留所有权利。`,
      updatedLabel: '最后更新',
      sections: [
        {
          id: 'ownership',
          title: '版权归属',
          body: [
            { p: [`© ${year} ${name}。本站发表的小说、诗歌及其他全部文字作品，以及作者拍摄或制作的图片，著作权均归作者所有；网站的视觉设计、版式、动画与源代码，同样归 ${name} 所有。`] },
            { p: ['除下文明确允许的情形外，未经作者事先书面许可，任何个人或机构不得以任何方式使用上述内容。'] },
          ],
        },
        {
          id: 'reuse',
          title: '转载与引用',
          body: [
            { p: ['未经许可，不得转载、摘编、翻译、改编、汇编、朗读或录制本站作品，不得将其用于任何商业用途；不得删改作者署名、歪曲原意，或将作品冒充为自己或他人所作。'] },
            { p: [`为评论、研究或介绍作品而少量引用，属于法律允许的合理使用：请注明作者与“${name}”，并附上原文链接。引用不得替代原作，也不得暗示作者认可引用者的观点。`] },
            { p: ['分享本站文章的链接不受限制，欢迎分享。'] },
          ],
        },
        {
          id: 'permission',
          title: '申请授权',
          body: [
            { p: ['如需转载、出版、翻译、改编或其他使用，请先发邮件至 ', mail, '，说明作品名称、使用方式、发布平台与范围。'] },
            { p: ['在收到作者明确的书面同意之前，不视为已获授权；授权仅限于回复中写明的作品、平台与范围，不可转授他人。'] },
          ],
        },
        {
          id: 'ai',
          title: '人工智能与数据挖掘',
          body: [
            { p: ['作者保留对本站内容进行文本与数据挖掘的权利。未经书面许可，不得抓取本站内容用于训练、微调或评估人工智能模型，也不得将其收入任何数据集。'] },
            { p: ['这一保留已通过 robots.txt 与 ', { text: 'TDMRep', href: TDMREP }, ' 元信息以机器可读的方式声明。'] },
          ],
        },
        {
          id: 'code',
          title: '网站设计与源代码',
          body: [
            { p: ['本站源代码可以在 GitHub 上查看，但它不是开源项目，没有附带任何开源许可。能看到源代码，不代表获得了复制、修改、部署或再分发它的权利；也不得把本站的设计、版式、动画或素材用于其他网站或产品。'] },
            { p: ['完整条款见代码仓库中的 ', repoFile('LICENSE'), ' 文件。如有合作意向，欢迎来信。'] },
          ],
        },
        {
          id: 'third-party',
          title: '第三方素材',
          body: [
            { p: ['以下素材不属于本站版权，按各自的许可使用：'] },
            {
              list: [
                ['首页雕像模型：', { text: '“Vinus”', href: VENUS }, '，作者 ', { text: 'Thunk3D', href: THUNK3D }, '，来自 Sketchfab，按 ', { text: 'CC BY 4.0', href: CC_BY }, ' 许可使用。'],
                ['字体：Archivo、Noto Sans SC，以及由 Noto Sans SC 子集化而来的标题字体 Red Room Display SC，均按 ', { text: 'SIL Open Font License 1.1', href: OFL }, ' 使用。'],
                ['其他开源软件按各自的许可证使用，见 ', repoFile('THIRD_PARTY_NOTICES.md'), '。'],
              ],
            },
          ],
        },
        {
          id: 'report',
          title: '侵权举报',
          body: [{ p: ['如果你在别处看到本站作品被擅自转载、署名被删除或被用于商业用途，欢迎把链接发到 ', mail, '，谢谢。'] }],
        },
      ],
    };
  }

  return {
    title: 'Copyright',
    intro: `All writing, images, design and source code on this site are protected by copyright and owned by ${name}. All rights reserved.`,
    updatedLabel: 'Last updated',
    sections: [
      {
        id: 'ownership',
        title: 'Ownership',
        body: [
          { p: [`© ${year} ${name}. The fiction, poetry and all other writing published here, and the photographs and images made by the author, are the author’s copyright. The site’s visual design, layout, animation and source code also belong to ${name}.`] },
          { p: ['Except where this page expressly allows it, no part of the above may be used in any way without the author’s prior written permission.'] },
        ],
      },
      {
        id: 'reuse',
        title: 'Republishing and quoting',
        body: [
          { p: ['Without permission you may not republish, excerpt, translate, adapt, anthologise, read aloud or record the work here, or use it commercially; nor remove or alter the author’s name, distort the work, or present it as your own or anyone else’s.'] },
          { p: [`Short quotations for criticism, review, research or introduction are fair use: credit the author and “${name}” and link to the original. A quotation must not stand in for the work, or suggest that the author endorses your views.`] },
          { p: ['Sharing links to the articles is always welcome.'] },
        ],
      },
      {
        id: 'permission',
        title: 'Asking for permission',
        body: [
          { p: ['To republish, publish, translate, adapt or otherwise use a work, write first to ', mail, ' — name the work and say how, where and how widely you would like to use it.'] },
          { p: ['Nothing is licensed until the author agrees in writing, and a licence covers only the work, outlet and scope named in that reply; it cannot be passed on to anyone else.'] },
        ],
      },
      {
        id: 'ai',
        title: 'AI and text and data mining',
        body: [
          { p: ['The author reserves the rights of text and data mining. The content of this site may not be scraped to train, fine-tune or evaluate AI models, or included in any dataset, without written permission.'] },
          { p: ['This reservation is also declared in machine-readable form, in robots.txt and in ', { text: 'TDMRep', href: TDMREP }, ' metadata.'] },
        ],
      },
      {
        id: 'code',
        title: 'Site design and source code',
        body: [
          { p: ['The source code of this site can be viewed on GitHub, but it is not open source and comes with no open-source licence. Being able to read it gives no right to copy, modify, deploy or redistribute it, or to use the site’s design, layout, animation or assets for another site or product.'] },
          { p: ['The full terms are in the ', repoFile('LICENSE'), ' file of the repository. For collaborations, get in touch.'] },
        ],
      },
      {
        id: 'third-party',
        title: 'Third-party material',
        body: [
          { p: ['The following are not the site’s copyright and are used under their own licences:'] },
          {
            list: [
              ['Statue model on the homepage: ', { text: '“Vinus”', href: VENUS }, ' by ', { text: 'Thunk3D', href: THUNK3D }, ', from Sketchfab, licensed under ', { text: 'CC BY 4.0', href: CC_BY }, '.'],
              ['Typefaces: Archivo, Noto Sans SC, and Red Room Display SC (a subset of Noto Sans SC), all under the ', { text: 'SIL Open Font License 1.1', href: OFL }, '.'],
              ['Other open-source software is used under its own licence; see ', repoFile('THIRD_PARTY_NOTICES.md'), '.'],
            ],
          },
        ],
      },
      {
        id: 'report',
        title: 'Reporting misuse',
        body: [{ p: ['If you find work from this site republished without permission, stripped of its author’s name or used commercially, please send the link to ', mail, '. Thank you.'] }],
      },
    ],
  };
}
