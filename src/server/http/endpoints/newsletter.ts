/** /api/newsletter/* on the Node server — same handler as the Netlify Function. */
import { handleNewsletterRequest } from '../../newsletter/http.ts';
import { nodeNewsletterService } from '../../newsletter/node.ts';
import { newsletterConfig } from '../../newsletter/config.ts';
import { clientIp, requestPeer, requireAdmin } from '../../services/auth.ts';
import { route } from '../respond.ts';

export const newsletter = route((context) => {
  const peer = requestPeer(context);
  const ip = clientIp(context.request, peer);
  return handleNewsletterRequest(context.request, {
    service: nodeNewsletterService(),
    // Forwarded headers are not trusted here (see services/auth.ts): such clients share a bucket.
    client: { ip, shared: ip === 'forwarded-shared' || ip === 'unknown' },
    requireAdmin: (request) => requireAdmin(request, peer),
    siteOrigin: newsletterConfig().siteUrl,
  });
});
