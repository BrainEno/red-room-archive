/**
 * Static-deployment wiring (Netlify Function): the subscriber list is one
 * AES-GCM-sealed document in a site-wide Netlify Blobs store.
 *
 * The key includes the deploy context, so Deploy Previews and branch deploys
 * never write production data; and because the document is encrypted with
 * NEWSLETTER_SECRET, scoping that variable to the Production context keeps
 * untrusted preview code from reading addresses at all.
 */
import { createNewsletterService } from '../services/newsletter.ts';
import { newsletterConfig } from './config.ts';
import { seal, unseal } from './crypto.ts';
import { blobsBackend, createDocumentStore, type BlobStoreLike } from './document-store.ts';
import { createMailer } from './mailer.ts';

export const BLOB_STORE_NAME = 'newsletter';

/** `production`, `deploy-preview`, `branch-deploy`, `dev` → a safe key segment. */
export const documentKey = (deployContext: string | undefined) =>
  `subscribers-${String(deployContext || 'production').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'production'}.json`;

export function netlifyNewsletterService(blobs: BlobStoreLike, deployContext: string | undefined) {
  const config = newsletterConfig();
  const secret = config.secret;
  const store = secret
    ? createDocumentStore(blobsBackend(blobs, documentKey(deployContext)), { encode: (text) => seal(secret, text), decode: (text) => unseal(secret, text) })
    : null;
  return createNewsletterService({ store, storage: 'netlify-blobs', config, mailer: createMailer(config) });
}
