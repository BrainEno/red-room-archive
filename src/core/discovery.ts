/** A concise, factual llms.txt guide built only from existing public DTOs. */
import type { ArticleSummary } from '../shared/contracts.ts';
import { ARCHIVE_PATH, ARTICLES_PATH, COPYRIGHT_PATH, MORE_PATH, TOPICS_PATH } from '../shared/routes.ts';
import { localizedPath } from '../shared/i18n.ts';

const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const label = (value: unknown) => text(value).replaceAll('[', '\\[').replaceAll(']', '\\]');

export function llmsGuide(input: {
  origin: string;
  name: string;
  description: string;
  email?: string;
  articles: ArticleSummary[];
}): string {
  const origin = input.origin.replace(/\/+$/, '');
  const url = (path: string) => `${origin}${path}`;
  const both = (path: string, en: string, zh: string) =>
    `- ${en}: ${url(localizedPath(path, 'en'))}\n- ${zh}: ${url(localizedPath(path, 'zh-CN'))}`;
  const recent = input.articles.map((article) => {
    const detail = [text(article.date).slice(0, 10), text(article.excerpt)].filter(Boolean).join(' — ');
    return `- [${label(article.title)}](${url(article.href)})${detail ? ` — ${detail}` : ''}`;
  }).join('\n');
  return `# ${text(input.name)}

> ${text(input.description)}

## Start here

${both(ARTICLES_PATH, 'Articles (English interface)', '文章（中文界面）')}
${both(TOPICS_PATH, 'Browse by topic', '按主题浏览')}
${both(ARCHIVE_PATH, 'Complete archive by year', '按年份查看完整档案')}
${both(MORE_PATH, 'Print editions, selected excerpts and elsewhere', '出版物、选读与其他渠道')}

## Recent writing

${recent || '- No published articles are currently listed.'}

## Feeds and discovery

- RSS: ${url('/rss.xml')}
- Sitemap: ${url('/sitemap.xml')}
${input.email ? `- Contact: ${text(input.email)}\n` : ''}
## Copyright and reuse

- Terms: ${url(COPYRIGHT_PATH)}
- Chinese terms: ${url(localizedPath(COPYRIGHT_PATH, 'zh-CN'))}
- Text-and-data-mining rights are reserved as stated there and in the site's TDMRep metadata. This guide does not grant an AI-training, republication or other reuse licence.
`;
}
