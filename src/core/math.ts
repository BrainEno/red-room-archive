/**
 * Notion equations (LaTeX) → MathML, rendered once on the server.
 *
 * MathML Core is native in every current browser, so readers download no
 * script, stylesheet or font for maths. Temml runs with `trust: false`
 * (no \href, \url, \includegraphics…). Two post-processing rules keep the
 * output inside the site's CSP and sanitiser:
 *   - `style="…"` attributes are removed (the CSP would block them anyway);
 *     matrix spacing is restored in pages.css instead. Colours set with
 *     \color are therefore dropped.
 *   - only the MathML element/attribute vocabulary Temml produces survives;
 *     anything else turns the formula back into escaped source text.
 * A formula that fails to parse is shown as its source, never as an error.
 */
import temml from 'temml';
import { esc } from './safety.ts';

/** Longest LaTeX source that is typeset (anything longer is shown as code). */
const MAX_TEX = 4000;

const ALLOWED_TAG = /^\/?(math|semantics|annotation|mrow|mi|mn|mo|ms|mtext|mspace|msup|msub|msubsup|munder|mover|munderover|mfrac|msqrt|mroot|mtable|mtr|mtd|mpadded|mphantom|menclose|mstyle|merror|mlabeledtr|mprescripts|mmultiscripts|none)$/;

const source = (tex: string, display: boolean) =>
  display ? `<code class="math" data-math-source>${esc(tex)}</code>` : `<code class="math">${esc(tex)}</code>`;

/** Strip style attributes; reject markup outside the MathML vocabulary or with event/link attributes. */
function clean(markup: string): string | null {
  const html = markup.replace(/\sstyle="[^"]*"/g, '');
  for (const match of html.matchAll(/<\s*(\/?[a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (!ALLOWED_TAG.test(match[1]!)) return null;
    if (/\s(on\w+|href|src|xlink:href)\s*=/i.test(match[2]!)) return null;
  }
  // Browsers draw single-letter variables with Unicode mathematical-italic
  // characters (U+1D400…), which only math fonts contain — on devices without
  // one the letter vanishes. Mark them so CSS italicises the ordinary letter.
  return html.replace(/<mi>([A-Za-z\u03b1-\u03c9\u03d1\u03d5\u03f5])<\/mi>/g, '<mi class="tml-v">$1</mi>');
}

/** Typeset one formula. `display` = a block equation (centred, own line). */
export function renderMath(tex: string, display = false): string {
  const input = String(tex ?? '').trim();
  if (!input) return '';
  if (input.length > MAX_TEX) return source(input, display);
  try {
    const markup = temml.renderToString(input, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      annotate: true, // keeps the LaTeX inside <annotation> for copy/paste and assistive tech
      xml: false,
      maxExpand: 500, // macro-expansion bomb guard
      maxSize: [-50, 50], // em; caps \rule and \kern
    });
    return clean(markup) ?? source(input, display);
  } catch {
    return source(input, display);
  }
}
