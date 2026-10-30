/**
 * The three messages the subscription flow sends, in English and Chinese.
 * Plain text first; the HTML is a small, image-free, tracker-free version of
 * the same words (inline styles only — email clients ignore stylesheets).
 */
import { escapeHtml } from '../../core/text.ts';
import type { Locale } from '../../shared/i18n.ts';

interface Copy {
  confirmSubject: (site: string) => string;
  confirmLead: (site: string) => string;
  confirmButton: string;
  confirmExpiry: (hours: number) => string;
  confirmIgnore: string;
  welcomeSubject: (site: string) => string;
  welcomeLead: (site: string) => string;
  alreadySubject: (site: string) => string;
  alreadyLead: (site: string) => string;
  unsubscribe: string;
  unsubscribeLead: string;
  visit: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    confirmSubject: (site) => `Confirm your subscription to ${site}`,
    confirmLead: (site) => `Someone — hopefully you — asked to receive new writing from ${site} by email. Nothing is sent until you confirm.`,
    confirmButton: 'Confirm subscription',
    confirmExpiry: (hours) => `The link works once and expires in ${hours} hours.`,
    confirmIgnore: 'If this wasn’t you, ignore this message: the address will not be subscribed.',
    welcomeSubject: (site) => `You are subscribed to ${site}`,
    welcomeLead: (site) => `Thank you. New writing from ${site} will arrive at this address.`,
    alreadySubject: (site) => `You are already subscribed to ${site}`,
    alreadyLead: (site) => `Someone asked to subscribe this address to ${site}. It is already subscribed, so nothing changed.`,
    unsubscribe: 'Unsubscribe',
    unsubscribeLead: 'You can stop these emails at any time:',
    visit: 'Visit the archive',
  },
  'zh-CN': {
    confirmSubject: (site) => `请确认订阅 ${site}`,
    confirmLead: (site) => `有人（希望是你）申请通过邮件接收 ${site} 的新文章。确认之前，我们不会寄出任何内容。`,
    confirmButton: '确认订阅',
    confirmExpiry: (hours) => `此链接只能使用一次，${hours} 小时后失效。`,
    confirmIgnore: '如果不是你本人操作，请忽略这封邮件：该地址不会被订阅。',
    welcomeSubject: (site) => `已订阅 ${site}`,
    welcomeLead: (site) => `谢谢。${site} 的新文章会寄到这个地址。`,
    alreadySubject: (site) => `你已订阅 ${site}`,
    alreadyLead: (site) => `有人申请用这个地址订阅 ${site}。该地址已在订阅中，因此没有任何变化。`,
    unsubscribe: '退订',
    unsubscribeLead: '你可以随时停止接收：',
    visit: '前往档案馆',
  },
};

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function html(locale: Locale, site: string, paragraphs: string[], action?: { href: string; label: string }, footer?: string): string {
  const p = (text: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${escapeHtml(text)}</p>`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(site)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#1a1414;font-family:Georgia,'Times New Roman','Songti SC',serif;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;">
<p style="margin:0 0 32px;font:700 12px/1 Arial,Helvetica,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#a3141e;">${escapeHtml(site)}</p>
${paragraphs.map(p).join('\n')}
${action ? `<p style="margin:28px 0;"><a href="${escapeHtml(action.href)}" style="display:inline-block;padding:12px 20px;background:#a3141e;color:#ffffff;text-decoration:none;font:700 14px/1 Arial,Helvetica,sans-serif;letter-spacing:.06em;">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5a4f4f;word-break:break-all;">${escapeHtml(action.href)}</p>` : ''}
${footer ? `<hr style="border:0;border-top:1px solid #d8d0c4;margin:32px 0 16px;"><p style="margin:0;font-size:13px;line-height:1.5;color:#5a4f4f;">${footer}</p>` : ''}
</div></body></html>`;
}

export function confirmationEmail(locale: Locale, site: string, confirmUrl: string, ttlHours: number): RenderedEmail {
  const c = COPY[locale];
  return {
    subject: c.confirmSubject(site),
    text: [c.confirmLead(site), '', `${c.confirmButton}: ${confirmUrl}`, '', c.confirmExpiry(ttlHours), c.confirmIgnore, ''].join('\n'),
    html: html(locale, site, [c.confirmLead(site)], { href: confirmUrl, label: c.confirmButton }, `${escapeHtml(c.confirmExpiry(ttlHours))}<br>${escapeHtml(c.confirmIgnore)}`),
  };
}

function withUnsubscribe(locale: Locale, site: string, subject: string, lead: string, siteUrl: string, unsubscribeUrl: string): RenderedEmail {
  const c = COPY[locale];
  return {
    subject,
    text: [lead, '', `${c.visit}: ${siteUrl}`, '', `${c.unsubscribeLead} ${unsubscribeUrl}`, ''].join('\n'),
    html: html(locale, site, [lead], { href: siteUrl, label: c.visit },
      `${escapeHtml(c.unsubscribeLead)} <a href="${escapeHtml(unsubscribeUrl)}" style="color:#a3141e;">${escapeHtml(c.unsubscribe)}</a>`),
  };
}

export const welcomeEmail = (locale: Locale, site: string, siteUrl: string, unsubscribeUrl: string): RenderedEmail =>
  withUnsubscribe(locale, site, COPY[locale].welcomeSubject(site), COPY[locale].welcomeLead(site), siteUrl, unsubscribeUrl);

export const alreadySubscribedEmail = (locale: Locale, site: string, siteUrl: string, unsubscribeUrl: string): RenderedEmail =>
  withUnsubscribe(locale, site, COPY[locale].alreadySubject(site), COPY[locale].alreadyLead(site), siteUrl, unsubscribeUrl);
