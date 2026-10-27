/**
 * Settings service — the single place that decides whether a value comes from
 * the admin UI (SQLite) or from the environment.
 *
 * Public pages should read the site profile from here, never from `process.env`
 * directly, so a value edited in /admin takes effect everywhere.
 */
import { readEnv } from '../../core/env.ts';
import { site as defaults } from '../../content/site.ts';
import type { SettingKey, SettingValues, SiteResponse } from '../../shared/contracts.ts';
import { KINDS, type Kind } from '../../shared/kinds.ts';
import { settingsRepository } from '../db/settings.repository.ts';
import { metaRepository } from '../db/meta.repository.ts';
import { itemsRepository } from '../db/items.repository.ts';

export const SETTING_KEYS: readonly SettingKey[] = [
  'site_name',
  'site_email',
  'site_about',
  'site_intro',
  'NOTION_TOKEN',
  'NOTION_DB_WRITING',
  'NOTION_DB_FILMS',
  'NOTION_DB_MUSIC',
];

const DATABASE_KEYS: Record<Kind, SettingKey> = {
  writing: 'NOTION_DB_WRITING',
  films: 'NOTION_DB_FILMS',
  music: 'NOTION_DB_MUSIC',
};

/** Stored setting first, environment second. */
export function resolveSetting(key: string): string | undefined {
  const stored = settingsRepository.get(key);
  if (stored) return stored;
  return readEnv(key) || undefined;
}

export interface NotionConfig {
  token?: string;
  databases: Record<Kind, string | undefined>;
}

export function notionConfig(): NotionConfig {
  const databases = Object.fromEntries(
    KINDS.map((kind) => [kind, resolveSetting(DATABASE_KEYS[kind])]),
  ) as Record<Kind, string | undefined>;
  return { token: resolveSetting('NOTION_TOKEN'), databases };
}

export function notionReady(kind?: Kind): boolean {
  const { token, databases } = notionConfig();
  if (!token) return false;
  return kind ? Boolean(databases[kind]) : KINDS.some((k) => Boolean(databases[k]));
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

const mask = (value: string | undefined) =>
  value ? `••••${value.slice(-4)}` : '';

/** What /admin sees: real values, token masked, plus a "is a token stored" flag. */
export function adminSettings(): { values: SettingValues & { hasToken: boolean } } {
  // Site fields show the *effective* value (override, else content default).
  const profile = siteProfile();
  const effective: Partial<Record<SettingKey, string>> = {
    site_name: profile.name,
    site_email: profile.email,
    site_about: profile.about,
    site_intro: profile.intro,
  };
  const values = Object.fromEntries(
    SETTING_KEYS.map((key) => {
      if (key === 'NOTION_TOKEN') return [key, mask(resolveSetting(key))];
      return [key, effective[key] ?? resolveSetting(key) ?? ''];
    }),
  ) as SettingValues;
  return { values: { ...values, hasToken: Boolean(resolveSetting('NOTION_TOKEN')) } };
}

/**
 * Apply a partial settings update.
 *
 * - Omitted keys are untouched.
 * - An empty string clears the override (falls back to `.env`).
 * - A masked token (`••••xxxx`) means "keep the stored value".
 */
export function updateSettings(patch: Record<string, unknown>): void {
  let notionChanged = false;

  for (const key of SETTING_KEYS) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();

    if (key === 'NOTION_TOKEN') {
      if (!value || value.startsWith('••••')) continue;
      settingsRepository.set(key, value);
      notionChanged = true;
      continue;
    }

    // Saving the form untouched must not freeze today's defaults as overrides.
    const fallback = SITE_DEFAULTS[key];
    if (value && value !== fallback) settingsRepository.set(key, value);
    else settingsRepository.remove(key);

    if (key.startsWith('NOTION')) notionChanged = true;
  }

  if (notionChanged) {
    // Credentials changed: the cached snapshot is no longer trustworthy.
    metaRepository.remove('synced');
    metaRepository.remove('sync_error');
    for (const kind of KINDS) metaRepository.remove(`synced:${kind}`);
  }
}

export function siteResponse(): SiteResponse {
  return {
    ...siteProfile(),
    notionConfigured: notionReady(),
    counts: itemsRepository.counts(),
  };
}
