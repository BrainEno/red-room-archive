/**
 * Non-blocking stylesheets: `<link media="print" data-async-css>` downloads
 * without blocking render; switch it on once this module runs. Replaces the
 * classic `onload="this.media='all'"`, which a strict CSP would block.
 * Without JavaScript, a <noscript> copy of the link applies instead.
 */
for (const link of document.querySelectorAll<HTMLLinkElement>('link[data-async-css]')) link.media = 'all';
