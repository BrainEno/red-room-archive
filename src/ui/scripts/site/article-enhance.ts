/**
 * Article pages: code blocks, wide formulas and tables scroll sideways when
 * they do not fit the column. Scroll areas must be reachable by keyboard
 * (WCAG 2.1.1), so those that actually overflow become focusable — re-checked
 * when the viewport changes, so narrow screens get it and wide ones do not.
 */
const SCROLLERS = '.article-body pre, .article-body .equation, .article-body .table-wrap';

function markScrollable() {
  for (const area of document.querySelectorAll<HTMLElement>(SCROLLERS)) {
    const scrolls = area.scrollWidth > area.clientWidth + 1;
    if (scrolls && area.tabIndex < 0) {
      area.tabIndex = 0;
      area.dataset.scrollFocus = '';
    } else if (!scrolls && area.dataset.scrollFocus !== undefined) {
      area.removeAttribute('tabindex');
      delete area.dataset.scrollFocus;
    }
  }
}
markScrollable();
if ('ResizeObserver' in window) {
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(markScrollable);
  }).observe(document.documentElement);
}
document.fonts?.ready.then(markScrollable);

/**
 * Article pages: a “Copy” button on every code block. Labels come from the
 * page (data-copy-label / data-copied-label on .article-body), so the
 * button speaks the interface language. Without clipboard access nothing is added.
 */
const body = document.querySelector<HTMLElement>('.article-body');
if (body && navigator.clipboard) {
  const label = body.dataset.copyLabel || 'Copy';
  const done = body.dataset.copiedLabel || 'Copied';
  for (const figure of body.querySelectorAll<HTMLElement>('figure.code')) {
    const code = figure.querySelector('pre code');
    if (!code) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = label;
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        button.textContent = done;
        button.dataset.copied = '';
        clearTimeout(timer);
        timer = setTimeout(() => {
          button.textContent = label;
          delete button.dataset.copied;
        }, 1600);
      } catch {
        /* permission denied: leave the text selectable as before */
      }
    });
    figure.classList.add('has-copy');
    figure.prepend(button);
  }
}
