/**
 * Settings service — the single place that decides whether a value comes from
 * the admin UI (SQLite) or from the environment.
 *
 * Public pages should read the site profile from here, never from `process.env`
 * directly, so a value edited in /admin takes effect everywhere.
 */
import { readEnv } from '../../core/env.ts';
import { badRequest } from '../../core/errors.ts';
import { site as defaults } from '../../content/site.ts';
import type { SettingKey, SettingValues } from '../../shared/contracts.ts';
import { settingsRepository } from '../db/settings.repository.ts';
import { metaRepository } from '../db/meta.repository.ts';
import { parseNotionId } from '../notion/mapper.ts';

export const SETTING_KEYS: readonly SettingKey[] = [
  'site_name',
  'site_email',
  'site_about',
  'site_intro',
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

export function siteProfile(): SiteProfile {
  return {
    name: resolveSetting('site_name') || defaults.name,
    email: resolveSetting('site_email') || defaults.email,
    about: resolveSetting('site_about') || defaults.about,
    intro: resolveSetting('site_intro') || defaults.intro,
  };
}

const SITE_DEFAULTS: Partial<Record<SettingKey, string>> = {
  site_name: defaults.name,
  site_email: defaults.email,
  site_about: defaults.about,
  site_intro: defaults.intro,
};

const mask = (value: string | undefined) => (value ? `••••${value.slice(-4)}` : '');

/** What /admin sees: real values, token masked, plus a "is a token stored" flag. */
export function adminSettings(): { values: SettingValues & { hasToken: boolean } } {
  const profile = siteProfile();
  const notion = notionConfig();
  const values: SettingValues = {
    site_name: profile.name,
    site_email: profile.email,
    site_about: profile.about,
    site_intro: profile.intro,
    NOTION_TOKEN: mask(notion.token),
    NOTION_DATABASE_ID: notion.databaseId ?? '',
  };
  return { values: { ...values, hasToken: Boolean(notion.token) } };
}

type Listener = () => void;
const listeners: Listener[] = [];

/** Called after the Notion credentials change (the article cache is reset). */
export const onNotionChange = (listener: Listener) => listeners.push(listener);

/**
 * Apply a partial settings update.
 *
 * - Omitted keys are untouched.
 * - An empty string clears the override (falls back to `.env`).
 * - A masked token (`••••xxxx`) means "keep the stored value".
 * - The database accepts an id or a pasted Notion link.
 */
export function updateSettings(patch: Record<string, unknown>): void {
  let notionChanged = false;
  const before = notionConfig();

  for (const key of SETTING_KEYS) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();

    if (key === 'NOTION_TOKEN') {
      if (!value || value.startsWith('••••')) continue;
      settingsRepository.set(key, value);
      continue;
    }

    if (key === 'NOTION_DATABASE_ID') {
      if (!value) {
        settingsRepository.remove(key);
        settingsRepository.remove('NOTION_DB_WRITING');
        continue;
      }
      const id = parseNotionId(value);
      if (!id) throw badRequest('NOTION_DATABASE_ID must be a Notion database id or link', { value });
      settingsRepository.set(key, id);
      continue;
    }

    // Saving the form untouched must not freeze today's defaults as overrides.
    const fallback = SITE_DEFAULTS[key];
    if (value && value !== fallback) settingsRepository.set(key, value);
    else settingsRepository.remove(key);
  }

  const after = notionConfig();
  notionChanged = before.token !== after.token || before.databaseId !== after.databaseId;
  if (notionChanged) {
    // Different credentials or database: the cached articles are no longer trustworthy.
    metaRepository.remove('synced');
    metaRepository.remove('sync_error');
    for (const listener of listeners) listener();
  }
}
