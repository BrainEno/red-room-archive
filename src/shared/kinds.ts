/**
 * Collection definitions shared by the server and the browser.
 *
 * The API uses stable machine kinds (`writing`, `films`, `music`); the public
 * site exposes them as editorial collections (`works`, `video`, `music`).
 * Keeping both names in one table means routes, links, navigation and API
 * payloads can never drift apart.
 */

export type Kind = 'writing' | 'films' | 'music';

export const KINDS: readonly Kind[] = ['writing', 'films', 'music'];

export const isKind = (value: unknown): value is Kind => KINDS.includes(value as Kind);

export interface Collection {
  /** Machine kind used by the API, the database and Notion. */
  readonly kind: Kind;
  /** Public URL segment, e.g. `works`. */
  readonly slug: string;
  /** Base path of the collection, e.g. `/works`. */
  readonly path: string;
  /** Navigation label. */
  readonly label: string;
  /** One-line description used on collection index pages and in metadata. */
  readonly blurb: string;
  /** Section id on the homepage. */
  readonly section: string;
}

export const COLLECTIONS: readonly Collection[] = [
  {
    kind: 'writing',
    slug: 'works',
    path: '/works',
    label: 'Works',
    blurb: 'Essays, notes and published writing.',
    section: 'works',
  },
  {
    kind: 'music',
    slug: 'music',
    path: '/music',
    label: 'Music',
    blurb: 'Recordings, releases and works in progress.',
    section: 'music',
  },
  {
    kind: 'films',
    slug: 'video',
    path: '/video',
    label: 'Video',
    blurb: 'Films, fragments and moving image.',
    section: 'video',
  },
];

export const collectionOf = (kind: Kind): Collection =>
  COLLECTIONS.find((collection) => collection.kind === kind) ?? COLLECTIONS[0]!;

export const collectionBySlug = (slug: string): Collection | undefined =>
  COLLECTIONS.find((collection) => collection.slug === slug);

/** Public path for one entry, e.g. `/works/on-light`. */
export const itemPath = (kind: Kind, slug: string): string =>
  `${collectionOf(kind).path}/${encodeURIComponent(slug)}`;
