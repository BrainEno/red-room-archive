/** Storage contract shared by the Node and static deployments. */
import type { AnalyticsDay, Pageview } from '../../core/analytics.ts';
import type { AnalyticsStorage } from '../../shared/contracts.ts';

export interface AnalyticsStore {
  readonly kind: AnalyticsStorage;
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  /** Returns false when collection is disabled. Retention is enforced here atomically. */
  record(day: string, view: Pageview): Promise<boolean>;
  read(from: string, to: string): Promise<AnalyticsDay[]>;
  /** Delete every aggregate but preserve the enabled/disabled choice. */
  clear(): Promise<void>;
}
