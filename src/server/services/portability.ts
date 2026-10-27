/**
 * Export and import — the archive in open formats, independent of SQLite.
 *
 * Export (`red-room-archive-YYYYMMDD.zip`):
 *   manifest.json          format, version, time, counts
 *   journal/<slug>.md      every post (drafts included) as Markdown + front matter
 *   site.json              site-setting overrides (never the Notion token)
 *   entries/<kind>.json    snapshot of the cached Notion entries, for reference
 *
 * Import accepts that ZIP, any ZIP of `.md` files (Hugo, Jekyll, Obsidian…),
 * or a single Markdown file. Front matter maps to post fields; a missing title
 * falls back to the first `# heading`, then the file name. Overwrites go
 * through `updatePost`, so the replaced text is kept in post history.
 */
import path from 'node:path';
import { badRequest } from '../../core/errors.ts';
import { parseFrontMatter, stringifyFrontMatter, type FrontMatter } from '../../core/frontmatter.ts';
import { cleanSlug, slugify } from '../../core/slug.ts';
import type { ImportConflict, ImportReport, ImportedPost } from '../../shared/contracts.ts';
import { KINDS } from '../../shared/kinds.ts';
import { config } from '../config.ts';
import { transaction } from '../db/connection.ts';
import { itemsRepository } from '../db/items.repository.ts';
import { postsRepository } from '../db/posts.repository.ts';
import { presentItem } from '../presenters.ts';
import { createZip, isZip, readZip, type ZipEntry } from '../storage/zip.ts';
import { createPost, normalizeDate, tagsOf, updatePost } from './posts.ts';
import { PORTABLE_SETTING_KEYS, portableSettings, updateSettings } from './settings.ts';

export const EXPORT_FORMAT = 'red-room-archive';
export const EXPORT_VERSION = 1;

const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

export function exportArchive(now = new Date()): { filename: string; data: Buffer } {
  const total = postsRepository.count(true);
  const posts = postsRepository.list({ includeDrafts: true, limit: Math.max(total, 1), offset: 0 });
  const entries: ZipEntry[] = [];

  for (const post of posts) {
    const markdown = stringifyFrontMatter(
      {
        title: post.title,
        slug: post.slug,
        date: post.created,
        updated: post.updated ?? post.created,
        tags: tagsOf(post.tags),
        published: Boolean(post.published),
        excerpt: post.excerpt || undefined,
      },
      post.body,
    );
    entries.push({ name: `journal/${post.slug}.md`, data: Buffer.from(markdown, 'utf8'), mtime: now });
  }

  const counts: Record<string, number> = { posts: posts.length };
  for (const kind of KINDS) {
    const items = itemsRepository.byKind(kind).map(presentItem);
    counts[kind] = items.length;
    entries.push({ name: `entries/${kind}.json`, data: json({ kind, items }), mtime: now });
  }
  entries.push({ name: 'site.json', data: json({ settings: portableSettings() }), mtime: now });
  entries.unshift({
    name: 'manifest.json',
    data: json({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), counts }),
    mtime: now,
  });

  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return { filename: `red-room-archive-${day}.zip`, data: createZip(entries) };
}

/* ── Import ─────────────────────────────────────────────────────────── */

export interface ImportFile {
  name: string;
  data: Buffer;
}

export interface ImportOptions {
  onConflict?: ImportConflict;
  dryRun?: boolean;
  /** Apply `site.json` overrides (never the Notion token). */
  settings?: boolean;
}

export const CONFLICT_MODES: readonly ImportConflict[] = ['skip', 'overwrite', 'rename'];

const isMarkdown = (name: string) => /\.(md|markdown|mdx)$/i.test(name);
/** macOS resource forks, hidden files and folders. */
const isJunk = (name: string) => name.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');

const text = (value: FrontMatter[string] | undefined): string =>
  value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value);

interface ParsedPost {
  file: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  published: boolean;
  created?: string;
  excerpt: string;
}

/** Markdown file → post fields. Throws AppError on unusable input. */
export function parsePostFile(file: string, source: string): ParsedPost {
  const { data, body } = parseFrontMatter(source);
  const stem = path.posix.basename(file).replace(/\.(md|markdown|mdx)$/i, '');
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
  const title = text(data.title).trim() || heading?.trim() || stem;
  const slug = cleanSlug(text(data.slug)) || cleanSlug(stem) || slugify(title);
  if (!body.trim()) throw badRequest('empty body');
  if (!slug) throw badRequest('could not derive a slug');

  const tags = Array.isArray(data.tags) ? data.tags : text(data.tags).split(',');
  const published =
    typeof data.published === 'boolean' ? data.published : typeof data.draft === 'boolean' ? !data.draft : true;
  return {
    file,
    slug,
    title,
    body,
    tags: tags.map((tag) => tag.trim()).filter(Boolean),
    published,
    created: normalizeDate(text(data.date) || text(data.created) || undefined),
    excerpt: (text(data.excerpt) || text(data.description) || text(data.summary)).trim(),
  };
}

/** Expand uploaded files into Markdown sources (+ an optional site.json). */
function collect(files: ImportFile[]): { posts: { file: string; source: string }[]; site?: unknown; errors: ImportReport['errors'] } {
  const posts: { file: string; source: string }[] = [];
  const errors: ImportReport['errors'] = [];
  let site: unknown;

  const visit = (name: string, data: Buffer) => {
    if (isJunk(name)) return;
    if (isMarkdown(name)) posts.push({ file: name, source: data.toString('utf8') });
    else if (path.posix.basename(name) === 'site.json') {
      try {
        site = JSON.parse(data.toString('utf8'));
      } catch {
        errors.push({ file: name, error: 'invalid JSON' });
      }
    }
  };

  for (const file of files) {
    if (isZip(file.data)) {
      const entries = readZip(file.data, { maxTotalBytes: config.maxImportBytes() * 4 });
      for (const entry of entries) visit(entry.name, entry.data);
    } else if (isMarkdown(file.name) || !path.extname(file.name)) {
      visit(isMarkdown(file.name) ? file.name : `${file.name || 'import'}.md`, file.data);
    } else {
      errors.push({ file: file.name, error: 'unsupported file type (expected .zip or .md)' });
    }
  }
  return { posts, site, errors };
}

export function importArchive(files: ImportFile[], options: ImportOptions = {}): ImportReport {
  const onConflict = options.onConflict ?? 'skip';
  if (!CONFLICT_MODES.includes(onConflict)) throw badRequest('onConflict must be skip, overwrite or rename', { onConflict });
  const dryRun = Boolean(options.dryRun);
  const { posts, site, errors } = collect(files);
  if (!posts.length && !errors.length && !site) throw badRequest('no Markdown files found');

  const report: ImportReport = { dryRun, onConflict, created: [], updated: [], skipped: [], errors, settings: [] };
  /** Slugs written (or, in a dry run, that would be written) by this import. */
  const claimed = new Set<string>();
  const taken = (slug: string) => claimed.has(slug) || postsRepository.exists(slug);
  const freeSlug = (base: string) => {
    let n = 2;
    while (taken(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  };

  const apply = () => {
    for (const { file, source } of posts) {
      let parsed: ParsedPost;
      try {
        parsed = parsePostFile(file, source);
      } catch (error) {
        report.errors.push({ file, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const fields = {
        title: parsed.title,
        body: parsed.body,
        tags: parsed.tags,
        published: parsed.published,
        excerpt: parsed.excerpt,
        created: parsed.created,
      };
      let slug = parsed.slug;
      const result = (s: string): ImportedPost => ({ file, slug: s, title: parsed.title });

      if (taken(slug)) {
        if (onConflict === 'skip' || (onConflict === 'overwrite' && claimed.has(slug))) {
          report.skipped.push(result(slug));
          continue;
        }
        if (onConflict === 'overwrite') {
          claimed.add(slug);
          if (dryRun) report.updated.push(result(slug));
          else if (updatePost(slug, fields, 'import').changed) report.updated.push(result(slug));
          else report.skipped.push(result(slug));
          continue;
        }
        slug = freeSlug(slug);
      }
      claimed.add(slug);
      if (!dryRun) createPost({ ...fields, slug });
      report.created.push(result(slug));
    }

    const overrides = (site as { settings?: Record<string, unknown> } | undefined)?.settings;
    if (options.settings && overrides && typeof overrides === 'object') {
      const patch = Object.fromEntries(
        PORTABLE_SETTING_KEYS.filter((key) => typeof overrides[key] === 'string').map((key) => [key, overrides[key]]),
      );
      report.settings = Object.keys(patch);
      if (!dryRun && report.settings.length) updateSettings(patch);
    }
  };

  // All posts land together or not at all if something unexpected fails.
  if (dryRun) apply();
  else transaction(apply);
  return report;
}
