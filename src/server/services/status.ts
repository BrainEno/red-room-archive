/**
 * Aggregate status used by the admin dashboard, /api/sync and /api/settings.
 * Composed here so every surface reports the same numbers.
 */
import { demoArticles } from '../../content/site.ts';
import type { SiteResponse, SyncStatus } from '../../shared/contracts.ts';
import { DEFAULT_LOCALE, type Locale } from '../../shared/i18n.ts';
import { articlesRepository } from '../db/articles.repository.ts';
import { isDemo, syncState } from './articles.ts';
import { notionReady, siteProfile } from './settings.ts';

export function syncStatus(): SyncStatus {
  const demo = isDemo();
  return {
    notion: notionReady(),
    demo,
    ...syncState(),
    articles: demo ? demoArticles.length : articlesRepository.count(),
    bodiesCached: demo ? demoArticles.length : articlesRepository.countBodies(),
  };
}

export function siteResponse(locale: Locale = DEFAULT_LOCALE): SiteResponse {
  const demo = isDemo();
  return {
    ...siteProfile(locale),
    locale,
    notionConfigured: notionReady(),
    demo,
    articles: demo ? demoArticles.length : articlesRepository.count(),
  };
}
