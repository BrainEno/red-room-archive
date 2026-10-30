/** Node server wiring: SQLite storage (migration 11) + the configured mailer. */
import { sqliteNewsletterStore } from '../db/newsletter.repository.ts';
import { createNewsletterService } from '../services/newsletter.ts';
import { newsletterConfig } from './config.ts';
import { createMailer } from './mailer.ts';

export function nodeNewsletterService() {
  const config = newsletterConfig();
  return createNewsletterService({ store: sqliteNewsletterStore, storage: 'sqlite', config, mailer: createMailer(config) });
}
