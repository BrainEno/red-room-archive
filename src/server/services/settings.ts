/**
 * Settings service — the single place that decides whether a value comes from
 * the admin UI (SQLite) or from the environment.
 *
 * Public pages should read the site profile from here, never from `process.env`
 * directly, so a value edited in /admin takes effect everywhere.
 */
import { randomUUID } from 'node:crypto';
import { readEnv } from '../../core/env.ts';
import { badRequest } from '../../core/errors.ts';
import { copy, site as identity } from '../../content/site.ts';
import { DEFAULT_LOCALE, type Locale } from '../../shared/i18n.ts';
import type { SettingKey, SettingValues } from '../../shared/contracts.ts';
import { settingsRepository } from '../db/settings.repository.ts';
import { transaction } from '../db/connection.ts';
import { metaRepository } from '../db/meta.repository.ts';
import { articlesRepository } from '../db/articles.repository.ts';
import { parseNotionId } from '../notion/mapper.ts';

export const SETTING_KEYS: readonly SettingKey[] = [
  'site_name',
  'site_email',
  'site_about',
  'site_intro',
  'site_about_zh',
  'site_intro_zh',
  'tag_glossary',
  'NOTION_TOKEN',
  'NOTION_DATABASE_ID',
];

/** Stored setting first, environment second. */
export function resolveSetting(key: string): string | undefined {
  const stored = settingsRepository.get(key);
  if (stored) return stored;
  return readEnv(key) || undefined;
}

const first = (...values: (string | undefined)[]) => values.find((value) => value && value.trim())?.trim();

export interface NotionConfig {
  token?: string;
  databaseId?: string;
}

/**
 * Accepted spellings, newest first:
 * - token: `NOTION_TOKEN`, `NOTION_API_SECRET` (astro-notion)
 * - database: `NOTION_DATABASE_ID`, the old per-collection `NOTION_DB_WRITING`
 *   (stored or env), `DATABASE_ID` (astro-notion)
 */
export function notionConfig(): NotionConfig {
  const token = first(resolveSetting('NOTION_TOKEN'), readEnv('NOTION_API_SECRET'));
  const rawDatabase = first(
    resolveSetting('NOTION_DATABASE_ID'),
    settingsRepository.get('NOTION_DB_WRITING'),
    readEnv('DATABASE_ID'),
    readEnv('NOTION_DB_WRITING'),
  );
  return { token, databaseId: parseNotionId(rawDatabase) ?? undefined };
}

export function notionReady(): boolean {
  const { token, databaseId } = notionConfig();
  return Boolean(token && databaseId);
}

export interface SiteProfile {
  name: string;
  email: string;
  about: string;
  intro: string;
}

/**
 * Admin-editable copy per interface language: `site_about` / `site_intro`
 * for English, `site_about_zh` / `site_intro_zh` for Chinese. A language
 * without an override shows its built-in copy (content/site.ts) — never the
 * other language's text, so what /admin shows is exactly what visitors read.
 */
const COPY_KEYS: Record<Locale, { about: SettingKey; intro: SettingKey }> = {
  en: { about: 'site_about', intro: 'site_intro' },
  'zh-CN': { about: 'site_about_zh', intro: 'site_intro_zh' },
};

export function siteProfile(locale: Locale = DEFAULT_LOCALE): SiteProfile {
  const keys = COPY_KEYS[locale];
  return {
    name: resolveSetting('site_name') || identity.name,
    email: resolveSetting('site_email') || identity.email,
    about: resolveSetting(keys.about) || copy[locale].about,
    intro: resolveSetting(keys.intro) || copy[locale].intro,
  };
}

const SITE_DEFAULTS: Partial<Record<SettingKey, string>> = {
  site_name: identity.name,
  site_email: identity.email,
  site_about: copy.en.about,
  site_intro: copy.en.intro,
  site_about_zh: copy['zh-CN'].about,
  site_intro_zh: copy['zh-CN'].intro,
};

const mask = (value: string | undefined) => (value ? `••••${value.slice(-4)}` : '');

/** What /admin sees: real values, token masked, plus a "is a token stored" flag. */
export function adminSettings(): { values: SettingValues & { hasToken: boolean } } {
  const profile = siteProfile('en');
  const zh = siteProfile('zh-CN');
  const notion = notionConfig();
  const values: SettingValues = {
    site_name: profile.name,
    site_email: profile.email,
    site_about: profile.about,
    site_intro: profile.intro,
    site_about_zh: zh.about,
    site_intro_zh: zh.intro,
    tag_glossary: resolveSetting('tag_glossary') ?? '',
    NOTION_TOKEN: mask(notion.token),
    NOTION_DATABASE_ID: notion.databaseId ?? '',
  };
  return { values: { ...values, hasToken: Boolean(notion.token) } };
}

export const notionGeneration = () => metaRepository.get('notion_generation') ?? '0';

type Listener = (previousGeneration: string) => void;
const listeners: Listener[] = [];

/** Called after the Notion credentials change (the article cache is reset). */
export const onNotionChange = (listener: Listener) => listeners.push(listener);

/**
 * Apply a partial settings update.
 *
 * - Omitted keys are untouched.
 * - An empty string clears an override (falls back to `.env`), except the token.
 * - An empty or masked token (`••••xxxx`) means "keep the stored value".
 * - The database accepts an id or a pasted Notion link.
 */
export function updateSettings(patch: Record<string, unknown>): void {
  // Validate before making any changes. A bad database ID must not silently
  // save the token or other fields supplied in the same request.
  const rawId = 'NOTION_DATABASE_ID' in patch ? String(patch.NOTION_DATABASE_ID ?? '').trim() : '';
  const databaseId = rawId ? parseNotionId(rawId) : null;
  if (rawId && !databaseId) throw badRequest('NOTION_DATABASE_ID must be a Notion database id or link', { value: rawId });

  let notionChanged = false;
  let previousGeneration = '0';
  transaction(() => {
    const before = notionConfig();
    previousGeneration = notionGeneration();
    for (const key of SETTING_KEYS) {
      if (!(key in patch)) continue;
      const value = String(patch[key] ?? '').trim();

      if (key === 'NOTION_TOKEN') {
        if (value && !value.startsWith('••••')) settingsRepository.set(key, value);
      } else if (key === 'NOTION_DATABASE_ID') {
        if (databaseId) settingsRepository.set(key, databaseId);
        else {
          settingsRepository.remove(key);
          settingsRepository.remove('NOTION_DB_WRITING');
        }
      } else {
        // Saving the form untouched must not freeze defaults as overrides.
        const fallback = SITE_DEFAULTS[key];
        if (value && value !== fallback) settingsRepository.set(key, value);
        else settingsRepository.remove(key);
      }
    }

    const after = notionConfig();
    notionChanged = before.token !== after.token || before.databaseId !== after.databaseId;
    if (notionChanged) {
      metaRepository.remove('synced');
      metaRepository.remove('sync_error');
      articlesRepository.clear();
      metaRepository.set('notion_generation', randomUUID());
    }
  });
  if (notionChanged) {
    for (const listener of listeners) listener(previousGeneration);
  }
}
