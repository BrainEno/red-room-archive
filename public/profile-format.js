// Shared by the browser editors, the API and the static snapshot builder.
// This is an allowlist, not a serialization of the settings API response.
//
// Version 2 added the homepage facts (`site_facts`, `site_facts_zh`). Version 1
// files are still accepted; their missing facts become '' (= built-in facts).
export const PROFILE_VERSION = 2;
const V1_KEYS = Object.freeze([
  'site_name', 'site_email', 'site_about', 'site_intro', 'site_about_zh',
  'site_intro_zh', 'site_tagline', 'site_tagline_zh', 'tag_glossary',
]);
export const PROFILE_KEYS = Object.freeze([...V1_KEYS, 'site_facts', 'site_facts_zh']);
export const PROFILE_MAX_BYTES = 128 * 1024;
export function validateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'format,settings,version' ||
      value.format !== 'red-room-site-profile' || (value.version !== 1 && value.version !== PROFILE_VERSION) ||
      !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) {
    throw new Error('Invalid site profile format or version');
  }
  const expected = value.version === 1 ? V1_KEYS : PROFILE_KEYS;
  const keys = Object.keys(value.settings);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error('Site profile must contain exactly the supported public fields');
  }
  const settings = {};
  for (const key of PROFILE_KEYS) {
    const field = expected.includes(key) ? value.settings[key] : '';
    if (typeof field !== 'string' || field.length > 10000) throw new Error(`Invalid or oversized profile field: ${key}`);
    settings[key] = field;
  }
  const result = { format: 'red-room-site-profile', version: PROFILE_VERSION, settings };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PROFILE_MAX_BYTES) throw new Error('Site profile is too large');
  return result;
}
export function makeProfile(settings) {
  return validateProfile({ format: 'red-room-site-profile', version: PROFILE_VERSION, settings: Object.fromEntries(PROFILE_KEYS.map((key) => [key, settings[key]])) });
}
