import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { isSafeUrl } from './safety.ts';

/**
 * Preserve single newlines inside Markdown text, which matters for poems and
 * lineated prose. Code blocks are represented by code nodes and are unchanged.
 */
function preserveSoftBreaks() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!Array.isArray(node.children)) return;

      const children: any[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && typeof child.value === 'string' && /\r?\n/.test(child.value)) {
          const parts = child.value.split(/\r?\n/);
          parts.forEach((value: string, index: number) => {
            if (value) children.push({ ...child, value });
            if (index < parts.length - 1) children.push({ type: 'break' });
          });
        } else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children;
    };

    visit(tree);
  };
}

/**
 * Sanitize navigation and image URLs emitted from Markdown before stringifying.
 * Protocol-relative and relative URLs are allowed; explicit schemes are limited
 * to web links and common contact links. Whitespace/control characters are
 * removed only for protocol detection, preventing obfuscated javascript: URLs.
 */
function sanitizeUrls() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.type === 'element' && node.properties) {
        for (const property of ['href', 'src']) {
          const value = node.properties[property];
          if (typeof value === 'string' && !isSafeUrl(value)) delete node.properties[property];
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Render CommonMark + GitHub-Flavored Markdown to HTML for public articles.
 * Raw HTML is deliberately not enabled in remark-rehype, and generated URLs
 * are checked explicitly rather than trusting parser defaults.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(preserveSoftBreaks)
  .use(remarkRehype)
  .use(sanitizeUrls)
  .use(rehypeStringify);

export async function renderMarkdown(source: string): Promise<string> {
  const result = await processor.process(source ?? '');
  return String(result);
}
