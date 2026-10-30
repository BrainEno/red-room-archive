/**
 * /admin → Overview: one request that says what the site is publishing and
 * what needs attention. Read-only; composed from the same services the
 * public pages and the other admin panels use, so the numbers agree.
 */
import type { OverviewCheck, OverviewResponse } from '../../shared/contracts.ts';
import { articlePath } from '../../shared/routes.ts';
import { config } from '../config.ts';
import { articlesRepository, type ArticleRow } from '../db/articles.repository.ts';
import { usage } from '../storage/uploads.ts';
import { isDemo, listArticles } from './articles.ts';
import { moreDocument } from './more.ts';
import { siteProfile } from './settings.ts';
import { syncStatus } from './status.ts';
import { tagIndex } from './tags.ts';
import { webhookStatus } from './webhook.ts';

/** The cached list even when Notion cannot be reached right now (the sync error is reported separately). */
async function articles(): Promise<ArticleRow[]> {
  try {
    return await listArticles();
  } catch {
    return isDemo() ? [] : articlesRepository.all();
  }
}

export async function overview(): Promise<OverviewResponse> {
  const all = await articles();
  const status = syncStatus();
  const profile = siteProfile('en');
  const more = moreDocument();
  const files = usage();
  const index = tagIndex(all);

  const years = new Map<string, number>();
  for (const article of all) {
    const year = /^\d{4}/.test(article.date) ? article.date.slice(0, 4) : '';
    years.set(year, (years.get(year) ?? 0) + 1);
  }
  const untagged = all.filter((article) => !article.tags.length).length;
  const latest = all[0];

  const checks: OverviewCheck[] = [];
  if (!status.notion) checks.push({ code: 'notion-missing', level: 'warn' });
  else {
    if (status.syncError) checks.push({ code: 'sync-error', level: 'warn' });
    if (!status.syncedAt && !status.syncing) checks.push({ code: 'never-synced', level: 'info' });
    else if (!all.length) checks.push({ code: 'no-articles', level: 'warn' });
    if (all.length && status.bodiesCached < all.length) checks.push({ code: 'bodies-partial', level: 'info', count: all.length - status.bodiesCached });
  }
  if (!config.siteUrl()) checks.push({ code: 'site-url-missing', level: 'warn' });
  if (!profile.email) checks.push({ code: 'email-missing', level: 'info' });
  if (untagged) checks.push({ code: 'untagged', level: 'info', count: untagged });
  if (!more.custom) checks.push({ code: 'more-sample', level: 'info' });
  if (webhookStatus().state === 'pending') checks.push({ code: 'webhook-pending', level: 'warn' });

  return {
    status,
    site: { name: profile.name, email: profile.email, url: config.siteUrl() },
    articles: {
      total: all.length,
      featured: all.filter((article) => article.rank > 0).length,
      topics: index.counts(all, 'en').length,
      untagged,
      latest: latest ? { title: latest.title, href: articlePath(latest.slug), date: latest.date } : null,
      years: [...years]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => (a.year === b.year ? 0 : !a.year ? 1 : !b.year ? -1 : a.year < b.year ? 1 : -1)),
    },
    more: {
      custom: more.custom,
      updated: more.updated,
      publications: more.document.publications.length,
      channels: more.document.channels.length,
    },
    uploads: { count: files.count, bytes: files.bytes },
    checks,
  };
}
