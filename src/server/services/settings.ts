/**
 * Settings service — the single place that decides whether a value comes from
 * the admin UI (SQLite) or from the environment.
 *
 * Public pages should read the site profile from here, never from `process.env`
 * directly, so a value edited in /admin takes effect everywhere.
 */
import { validateProfile } from '../../../public/profile-format.js';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { readEnv } from '../../core/env.ts';
import { badRequest } from '../../core/errors.ts';
import { factsError, formatFacts, parseFacts, type Fact } from '../../core/facts.ts';
import { copy, site as identity } from '../../content/site.ts';
import { DEFAULT_LOCALE, type Locale } from '../../shared/i18n.ts';
import type { SettingKey, SettingValues } from '../../shared/contracts.ts';
import { settingsRepository } from '../db/settings.repository.ts';
import { transaction } from '../db/connection.ts';
import { metaRepository } from '../db/meta.repository.ts';
import { articlesRepository } from '../db/articles.repository.ts';
import { parseNotionId } from '../notion/mapper.ts';

const SETTING_KEYS: readonly SettingKey[] = [
  'site_name',
  'site_email',
  'site_about',
  'site_intro',
  'site_about_zh',
  'site_intro_zh',
  'site_tagline',
  'site_tagline_zh',
  'site_facts',
  'site_facts_zh',
  'tag_glossary',
  'newsletter_signup',
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

/**
 * Public newsletter sign-up entries (homepage, article pages, footer, sitemap).
 * Hidden by default; the feature itself — /subscribe, the API, confirmation
 * and unsubscribe links, the admin module — keeps working either way.
 *
 * Stored `newsletter_signup` (`on` / `off`, from /admin → Settings) wins;
 * otherwise `SHOW_NEWSLETTER_SIGNUP=1`. The static build has no saved
 * settings, so on Netlify only the build variable counts (rebuild to apply).
 */
const truthy = (value: string | undefined) => /^(1|true|on|yes)$/i.test((value ?? '').trim());
const signupDefault = () => (truthy(readEnv('SHOW_NEWSLETTER_SIGNUP')) ? 'on' : 'off');
export function newsletterSignupVisible(): boolean {
  const stored = settingsRepository.get('newsletter_signup');
  return (stored === 'on' || stored === 'off' ? stored : signupDefault()) === 'on';
}

/** Public collector tag; the endpoint checks this setting again for old pages/requests. */
export function analyticsCollectionEnabled(): boolean {
  return settingsRepository.get('analytics_enabled') !== '0';
}

export interface SiteProfile {
  name: string;
  email: string;
  about: string;
  intro: string;
  tagline: string;
  /** Homepage facts row; empty when hidden with `-` (see core/facts.ts). */
  facts: Fact[];
}

/**
 * Admin-editable copy per interface language: `site_about` / `site_intro`
 * for English, `site_about_zh` / `site_intro_zh` for Chinese; taglines use
 * `site_tagline` / `site_tagline_zh`, facts `site_facts` / `site_facts_zh`. A language
 * without an override shows its built-in copy (content/site.ts) — never the
 * other language's text, so what /admin shows is exactly what visitors read.
 */
const COPY_KEYS: Record<Locale, { about: SettingKey; intro: SettingKey; tagline: SettingKey; facts: SettingKey }> = {
  en: { about: 'site_about', intro: 'site_intro', tagline: 'site_tagline', facts: 'site_facts' },
  'zh-CN': { about: 'site_about_zh', intro: 'site_intro_zh', tagline: 'site_tagline_zh', facts: 'site_facts_zh' },
};

/** Built-in facts as editable text; Chinese uses the full-width colon. */
const defaultFactsText = (locale: Locale) => formatFacts(copy[locale].facts, locale === 'zh-CN' ? '：' : ': ');
const FACT_KEYS: readonly SettingKey[] = ['site_facts', 'site_facts_zh'];

function assertFacts(key: string, value: string): void {
  const error = factsError(value);
  if (error) throw badRequest(`${key}: ${error}`, { key });
}

export function siteProfile(locale: Locale = DEFAULT_LOCALE): SiteProfile {
  const keys = COPY_KEYS[locale];
  return {
    name: resolveSetting('site_name') || identity.name,
    email: resolveSetting('site_email') || identity.email,
    about: resolveSetting(keys.about) || copy[locale].about,
    intro: resolveSetting(keys.intro) || copy[locale].intro,
    tagline: resolveSetting(keys.tagline) || copy[locale].tagline,
    facts: parseFacts(settingsRepository.get(keys.facts), copy[locale].facts),
  };
}

const SITE_DEFAULTS: Partial<Record<SettingKey, string>> = {
  site_name: identity.name,
  site_email: identity.email,
  site_about: copy.en.about,
  site_intro: copy.en.intro,
  site_about_zh: copy['zh-CN'].about,
  site_intro_zh: copy['zh-CN'].intro,
  site_tagline: copy.en.tagline,
  site_tagline_zh: copy['zh-CN'].tagline,
  site_facts: defaultFactsText('en'),
  site_facts_zh: defaultFactsText('zh-CN'),
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
    site_tagline: profile.tagline,
    site_tagline_zh: zh.tagline,
    site_facts: settingsRepository.get('site_facts') || defaultFactsText('en'),
    site_facts_zh: settingsRepository.get('site_facts_zh') || defaultFactsText('zh-CN'),
    tag_glossary: resolveSetting('tag_glossary') ?? '',
    newsletter_signup: newsletterSignupVisible() ? 'on' : 'off',
    NOTION_TOKEN: mask(notion.token),
    NOTION_DATABASE_ID: notion.databaseId ?? '',
  };
  return { values: { ...values, hasToken: Boolean(notion.token) } };
}

// Source identity is salted and hashed; never persist the effective token itself.
// A policy version also invalidates caches created before fail-closed publishing.
const sourceFingerprint = (salt: string): string => {
  const { token, databaseId } = notionConfig();
  return createHash('sha256').update(JSON.stringify(['publication-v1', salt, token ?? '', databaseId ?? '', config.notionApiBase()])).digest('hex');
};

function recordSource(): void {
  let salt = metaRepository.get('notion_source_salt');
  if (!salt) { salt = randomUUID(); metaRepository.set('notion_source_salt', salt); }
  metaRepository.set('notion_source_fingerprint', sourceFingerprint(salt));
}

/** Detect environment changes, including across restarts, before using cache. */
export function notionGeneration(): string {
  return transaction(() => {
    let salt = metaRepository.get('notion_source_salt');
    if (!salt) { salt = randomUUID(); metaRepository.set('notion_source_salt', salt); }
    const fingerprint = sourceFingerprint(salt);
    if (metaRepository.get('notion_source_fingerprint') !== fingerprint) {
      articlesRepository.clear();
      metaRepository.remove('synced');
      metaRepository.remove('sync_error');
      metaRepository.set('notion_generation', randomUUID());
      metaRepository.set('notion_source_fingerprint', fingerprint);
    }
    return metaRepository.get('notion_generation') ?? '0';
  });
}

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
  for (const key of FACT_KEYS) if (key in patch) assertFacts(key, String(patch[key] ?? ''));

  let notionChanged = false;
  let previousGeneration = '0';
  transaction(() => {
    const before = notionConfig();
    previousGeneration = notionGeneration();
    for (const key of SETTING_KEYS) {
      if (!(key in patch)) continue;
      const value = String(patch[key] ?? '').replace(/\r\n?/g, '\n').trim();

      if (key === 'NOTION_TOKEN') {
        if (value && !value.startsWith('••••')) settingsRepository.set(key, value);
      } else if (key === 'NOTION_DATABASE_ID') {
        if (databaseId) settingsRepository.set(key, databaseId);
        else {
          settingsRepository.remove(key);
          settingsRepository.remove('NOTION_DB_WRITING');
        }
      } else if (key === 'newsletter_signup') {
        // Only `on` / `off`; saving the environment's own default stores nothing.
        const next = truthy(value) ? 'on' : 'off';
        if (next === signupDefault()) settingsRepository.remove(key);
        else settingsRepository.set(key, next);
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
      recordSource();
    }
  });
  if (notionChanged) {
    for (const listener of listeners) listener(previousGeneration);
  }
}

/** Replace only public profile fields; keep Notion credentials and caches intact. */
export function importSiteProfile(input: unknown): void {
  let profile;
  try { profile = validateProfile(input); }
  catch (error) { throw badRequest(error instanceof Error ? error.message : 'Invalid site profile'); }
  for (const key of FACT_KEYS) assertFacts(key, profile.settings[key as keyof typeof profile.settings]);
  transaction(() => {
    for (const [key, raw] of Object.entries(profile.settings)) {
      const value = raw.trim();
      if (value) settingsRepository.set(key, value);
      else settingsRepository.remove(key);
    }
  });
}
