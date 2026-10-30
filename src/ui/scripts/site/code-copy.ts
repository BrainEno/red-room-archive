/**
 * Article pages: block formulas wider than the column scroll sideways; make
 * those scroll areas reachable by keyboard (WCAG 2.1.1).
 */
for (const equation of document.querySelectorAll<HTMLElement>('.article-body .equation')) {
  if (equation.scrollWidth > equation.clientWidth + 1) {
    equation.tabIndex = 0;
    equation.setAttribute('role', 'group');
    equation.setAttribute('aria-label', equation.querySelector('annotation')?.textContent?.slice(0, 200) || 'formula');
  }
}

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
