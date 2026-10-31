import type { Locale } from '../shared/i18n.ts';
import type { MorePublication } from '../shared/contracts.ts';
import { messages } from './i18n.ts';

export interface MoreAction {
  href: string;
  label: string;
  external: boolean;
}

/** Resolve a publication CTA without inventing contact details or overriding sold-out. */
export function moreAction(publication: MorePublication, locale: Locale, siteEmail: string): MoreAction | undefined {
  const t = messages(locale).more;
  if (publication.availability === 'sold-out') return undefined;
  if (publication.link) {
    const fallback = publication.availability === 'contact'
      ? t.contactAuthor
      : publication.availability === 'preorder'
        ? t.registerInterest
        : t.order;
    return {
      href: publication.link.href,
      label: publication.link.label || fallback,
      external: /^https?:/i.test(publication.link.href),
    };
  }

  const email = siteEmail.trim();
  if (!email) return undefined;
  if (publication.availability === 'contact') {
    return { href: `mailto:${email}?subject=${encodeURIComponent(t.askSubject(publication.title))}`, label: t.contactAuthor, external: false };
  }
  if (publication.availability === 'preorder') {
    return { href: `mailto:${email}?subject=${encodeURIComponent(t.preorderSubject(publication.title))}`, label: t.registerInterest, external: false };
  }
  // No status is the legacy behaviour: keep the original email CTA.
  return { href: `mailto:${email}?subject=${encodeURIComponent(t.askSubject(publication.title))}`, label: t.ask, external: false };
}
