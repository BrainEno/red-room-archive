/**
 * Site content defaults.
 *
 * Everything a visitor reads that is *not* stored in Notion or SQLite lives
 * here: identity, editorial copy, the facts column on the intro, navigation
 * labels and the seeded demo entries used when Notion is not configured.
 *
 * Keep this module safe to commit: no tokens, no private content, no local
 * database data. Live values (name, email, about, intro) can be overridden at
 * runtime from /admin → Settings.
 */

export interface SiteContent {
  name: string;
  email: string;
  about: string;
  /** Two or three sentences shown in the intro section, revealed word by word. */
  intro: string;
  /** Short kicker above the collection sections. */
  tagline: string;
  facts: { key: string; value: string }[];
  journal: { label: string; intro: string };
  contact: { heading: string; note: string };
}

export const site: SiteContent = {
  name: 'Red Room Archive',
  email: '',
  about: 'An archive of writing, music, and film.',
  intro:
    'Placeholder — replace this with two or three sentences about yourself. Say who you are, what you make, and what a visitor will find once they step through the curtain.',
  tagline: 'Audio, film and writing',
  facts: [
    { key: 'Based in', value: 'Your city' },
    { key: 'Working in', value: 'Audio, film and writing' },
    { key: 'Currently', value: 'A short line about what you are making now' },
  ],
  journal: {
    label: 'Journal',
    intro: 'Notes, fragments, and longer pieces from the archive.',
  },
  contact: {
    heading: 'Contact',
    note: 'For commissions, screenings and collaborations.',
  },
};

type DemoItem = Record<string, string | number | boolean | null>;

/** Offline seed content, used only while Notion is not configured. */
export const demo: Record<'writing' | 'films' | 'music', DemoItem[]> = {
  writing: [],
  films: [],
  music: [],
};
