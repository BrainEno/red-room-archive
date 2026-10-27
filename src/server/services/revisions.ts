/**
 * Post history and trash.
 *
 * - Every saved version of a post is listed newest first.
 * - Restoring a version over a live post is itself an edit, so the version it
 *   replaces lands in history too: a restore can always be undone.
 * - A deleted post is "in the trash" while it still has history; restoring
 *   any of its versions brings it back under the same slug.
 */
import { badRequest, conflict, notFound } from '../../core/errors.ts';
import { transaction } from '../db/connection.ts';
import { postsRepository } from '../db/posts.repository.ts';
import { revisionsRepository, type DeletedRow, type RevisionRow } from '../db/revisions.repository.ts';
import { tagsOf, updatePost } from './posts.ts';

export type { DeletedRow, RevisionRow };

export const revisionTags = tagsOf;

export function listRevisions(slug: string): { exists: boolean; revisions: RevisionRow[] } {
  const exists = postsRepository.exists(slug);
  const revisions = revisionsRepository.list(slug);
  if (!exists && !revisions.length) throw notFound('post not found', { slug });
  return { exists, revisions };
}

export function revisionId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('invalid revision id', { id: raw });
  return id;
}

export function requireRevision(slug: string, id: number): RevisionRow {
  const revision = revisionsRepository.byId(slug, id);
  if (!revision) throw notFound('revision not found', { slug, id });
  return revision;
}

/** Bring a version back. Returns whether the post had to be re-created. */
export function restoreRevision(slug: string, id: number): { slug: string; recreated: boolean } {
  const revision = requireRevision(slug, id);
  if (postsRepository.exists(slug)) {
    updatePost(
      slug,
      {
        title: revision.title,
        body: revision.body,
        tags: tagsOf(revision.tags),
        excerpt: revision.excerpt ?? '',
        published: Boolean(revision.published),
        created: revision.created ?? undefined,
      },
      'restore',
    );
    return { slug, recreated: false };
  }
  transaction(() => {
    postsRepository.insert({
      slug,
      title: revision.title,
      body: revision.body,
      tags: revision.tags ?? '',
      published: revision.published,
      created: revision.created ?? undefined,
      excerpt: revision.excerpt,
    });
  });
  return { slug, recreated: true };
}

export const listTrash = (): DeletedRow[] => revisionsRepository.deleted();

/** Permanently forget a deleted post's history. Live posts cannot be purged. */
export function purgeTrash(slug: string): void {
  if (postsRepository.exists(slug)) throw conflict('post still exists; delete it first', { slug });
  if (!revisionsRepository.purge(slug)) throw notFound('nothing in the trash under this slug', { slug });
}
