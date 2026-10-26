import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

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
 * Render CommonMark + GitHub-Flavored Markdown to HTML for public articles.
 * Raw HTML is deliberately not enabled in remark-rehype, and its default URL
 * transform rejects unsafe protocols such as javascript:.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(preserveSoftBreaks)
  .use(remarkRehype)
  .use(rehypeStringify);

export async function renderMarkdown(source: string): Promise<string> {
  const result = await processor.process(source ?? '');
  return String(result);
}
