// HTML/URL 安全工具：所有来自 Notion 或 Markdown 的内容在拼进 HTML 前都要经过这里。
// 公开页面用 `set:html` 输出，因此绝不信任上游文本。

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ALLOWED_PROTOCOLS = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * 只允许相对地址、协议相对地址，以及 http/https/mailto/tel。
 * 检测协议前先去掉空白与控制字符，阻止 `java\tscript:` 这类混淆写法。
 */
export function isSafeUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const compact = value.trim().replace(/[\u0000-\u0020]+/g, '');
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  return !protocol || ALLOWED_PROTOCOLS.has(protocol);
}

/** 安全通过时返回原地址，否则返回 null（调用方据此丢弃属性）。 */
export const safeUrl = (value: unknown): string | null => (isSafeUrl(value) ? String(value) : null);
