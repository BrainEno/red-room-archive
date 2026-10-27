// Notion API 里用到的类型片段（只声明我们读取的部分，避免额外依赖）。
export interface RichTextItem {
  type?: 'text' | 'mention' | 'equation' | string;
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
  text?: { content?: string; link?: { url?: string } | null };
  equation?: { expression?: string };
  mention?: {
    type?: string;
    page?: { id?: string };
    database?: { id?: string };
    date?: { start?: string; end?: string | null };
    link_preview?: { url?: string };
    link_mention?: { href?: string; title?: string };
    [key: string]: unknown;
  };
}

export const plainText = (items: RichTextItem[] | undefined | null = []): string =>
  (items ?? []).map((item) => item?.plain_text ?? item?.text?.content ?? '').join('');
