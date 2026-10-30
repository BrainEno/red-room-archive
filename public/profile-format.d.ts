export type ProfileKey = 'site_name' | 'site_email' | 'site_about' | 'site_intro' | 'site_about_zh' | 'site_intro_zh' | 'site_tagline' | 'site_tagline_zh' | 'tag_glossary';
export type SiteProfileFile = { format: 'red-room-site-profile'; version: 1; settings: Record<ProfileKey, string> };
export const PROFILE_KEYS: readonly ProfileKey[];
export const PROFILE_MAX_BYTES: number;
export function validateProfile(value: unknown): SiteProfileFile;
export function makeProfile(settings: Partial<Record<ProfileKey, string>>): SiteProfileFile;
