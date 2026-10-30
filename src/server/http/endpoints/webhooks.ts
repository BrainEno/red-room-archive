/**
 * Notion webhook endpoint (logic in services/webhook.ts).
 * POST is called by Notion and authenticated by the request signature;
 * GET (status) and DELETE (reset) are for /admin and need the admin token.
 */
import type { WebhookStatusResponse } from '../../../shared/contracts.ts';
import { requestPeer, requireAdmin } from '../../services/auth.ts';
import { receiveWebhook, resetWebhook, webhookStatus } from '../../services/webhook.ts';
import { NO_STORE, json, readLimited, route } from '../respond.ts';

/** Notion payloads are small; anything bigger is not from Notion. */
const MAX_WEBHOOK_BYTES = 64 * 1024;

/** POST /api/webhooks/notion — verification handshake or signed event. */
export const notionWebhook = route(async (context) => {
  const raw = await readLimited(context.request, MAX_WEBHOOK_BYTES);
  const outcome = receiveWebhook(raw, context.request.headers.get('x-notion-signature'));
  return json({ ok: true, outcome }, { headers: NO_STORE });
});

/** GET /api/webhooks/notion — subscription state for /admin. */
export const readWebhook = route((context) => {
  requireAdmin(context.request, requestPeer(context));
  return json<WebhookStatusResponse>({ webhook: webhookStatus() }, { headers: NO_STORE });
});

/** DELETE /api/webhooks/notion — forget the token so a new subscription can verify. */
export const clearWebhook = route((context) => {
  requireAdmin(context.request, requestPeer(context));
  return json<WebhookStatusResponse>({ webhook: resetWebhook() }, { headers: NO_STORE });
});
