/**
 * Post history and trash (admin only).
 *
 *   GET    /api/posts/:slug/revisions                 saved versions, newest first
 *   GET    /api/posts/:slug/revisions/:id             one version with its Markdown
 *   POST   /api/posts/:slug/revisions/:id/restore     bring it back → PostDetail
 *                                                     (200, or 201 if the post was deleted)
 *   GET    /api/trash                                 deleted posts that can be restored
 *   DELETE /api/trash/:slug                           forget a deleted post's history → 204
 */
import type { PostDetail, RevisionDetail, RevisionListResponse, TrashResponse } from '../../../shared/contracts.ts';
import {
  postHref,
  presentPostDetail,
  presentRevision,
  presentRevisionDetail,
  presentTrashEntry,
} from '../../presenters.ts';
import { requireAdmin } from '../../services/auth.ts';
import { requirePost } from '../../services/posts.ts';
import {
  listRevisions,
  listTrash,
  purgeTrash,
  requireRevision,
  restoreRevision,
  revisionId,
} from '../../services/revisions.ts';
import { NO_STORE, created, json, param, route } from '../respond.ts';

export const list = route((context) => {
  requireAdmin(context.request);
  const slug = param(context, 'slug');
  const { exists, revisions } = listRevisions(slug);
  return json<RevisionListResponse>({ slug, exists, revisions: revisions.map(presentRevision) }, { headers: NO_STORE });
});

export const read = route((context) => {
  requireAdmin(context.request);
  const revision = requireRevision(param(context, 'slug'), revisionId(param(context, 'id')));
  return json<RevisionDetail>(presentRevisionDetail(revision), { headers: NO_STORE });
});

export const restore = route((context) => {
  requireAdmin(context.request);
  const { slug, recreated } = restoreRevision(param(context, 'slug'), revisionId(param(context, 'id')));
  const post = presentPostDetail(requirePost(slug, { includeDrafts: true }));
  return recreated ? created<PostDetail>(post, postHref(slug)) : json<PostDetail>(post, { headers: NO_STORE });
});

export const trash = route((context) => {
  requireAdmin(context.request);
  return json<TrashResponse>({ posts: listTrash().map(presentTrashEntry) }, { headers: NO_STORE });
});

export const purge = route((context) => {
  requireAdmin(context.request);
  purgeTrash(param(context, 'slug'));
  return new Response(null, { status: 204, headers: NO_STORE });
});
