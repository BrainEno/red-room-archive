// Route adapter only — logic lives in src/server/http/endpoints.
export { clearWebhook as DELETE, readWebhook as GET, notionWebhook as POST } from '../../../server/http/endpoints/webhooks.ts';
