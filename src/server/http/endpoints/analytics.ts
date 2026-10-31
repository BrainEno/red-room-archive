/** /api/analytics/* on Node: SQLite storage and the shared HTTP contract. */
import { handleAnalyticsRequest } from '../../analytics/http.ts';
import { sqliteAnalyticsStore } from '../../db/analytics.repository.ts';
import { config } from '../../config.ts';
import { requestPeer, requireAdmin } from '../../services/auth.ts';
import { route } from '../respond.ts';

export const analytics = route((context) => handleAnalyticsRequest(context.request, {
  store: sqliteAnalyticsStore,
  requireAdmin: (request) => requireAdmin(request, requestPeer(context)),
  siteOrigin: config.siteUrl() || null,
}));
