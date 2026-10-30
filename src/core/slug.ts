// slug 生成与校验。独立于数据库/Notion，方便单元测试直接 import。

/** 把标题转成 URL 片段；保留各语言的字母与数字（中文标题也能得到可读 slug）。 */
export const slugify = (s: string) =>
  String(s ?? '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')          // 去掉分解出来的组合音标
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

/** 用户显式填写的 slug 先规范化，再去掉路径分隔符等危险字符。 */
export function cleanSlug(input: string): string {
  return String(input ?? '').trim().toLowerCase()
    .replace(/[\\/?#%]+/g, '-')          // 不能构成路径或查询串
    .replace(/[^\p{L}\p{N}._~-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/g, '')       // 不能以点开头（避免 ../）
    .slice(0, 80)
    .replace(/-+$/g, '');
}
