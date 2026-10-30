export type ProfileKey = 'site_name' | 'site_email' | 'site_about' | 'site_intro' | 'site_about_zh' | 'site_intro_zh' | 'site_tagline' | 'site_tagline_zh' | 'tag_glossary' | 'site_facts' | 'site_facts_zh';
/** Always written as version 2; version 1 files (without facts) are still read. */
export type SiteProfileFile = { format: 'red-room-site-profile'; version: 2; settings: Record<ProfileKey, string> };
export const PROFILE_VERSION: 2;
export const PROFILE_KEYS: readonly ProfileKey[];
export const PROFILE_MAX_BYTES: number;
export function validateProfile(value: unknown): SiteProfileFile;
export function makeProfile(settings: Partial<Record<ProfileKey, string>>): SiteProfileFile;
