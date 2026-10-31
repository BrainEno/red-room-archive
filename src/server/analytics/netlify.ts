/** Static-deployment analytics wiring: bounded aggregates in Netlify Blobs. */
import { blobsBackend, type BlobStoreLike } from '../newsletter/document-store.ts';
import { createAnalyticsDocumentStore } from './document-store.ts';

export const ANALYTICS_BLOB_STORE = 'site-analytics';

/** Production and previews never share pageview counters. */
export const analyticsDocumentKey = (deployContext: string | undefined) =>
  `pageviews-${String(deployContext || 'production').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'production'}.json`;

export function netlifyAnalyticsStore(blobs: BlobStoreLike, deployContext: string | undefined) {
  return createAnalyticsDocumentStore(blobsBackend(blobs, analyticsDocumentKey(deployContext)));
}
