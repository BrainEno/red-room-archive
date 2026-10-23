/**
 * Public site defaults and offline fallback content.
 *
 * Keep this module safe to commit: do not put Notion tokens, private content,
 * or local database data here. Configure the live content through environment
 * variables / the admin settings instead.
 */
export const site = {
  name: 'Red Room Archive',
  email: '',
  about: 'An archive of writing, music, and film.',
};

type DemoItem = Record<string, string | number | boolean | null>;

export const demo: Record<'writing' | 'films' | 'music', DemoItem[]> = {
  writing: [],
  films: [],
  music: [],
};
