// Notion API 里用到的类型片段（只声明我们读取的部分，避免额外依赖）。
export interface RichTextItem {
  type?: string;
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
  text?: { content?: string; link?: { url?: string } | null };
  equation?: { expression?: string };
}
