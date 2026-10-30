/**
 * `/…/page/N` segments. Page 1 has no segment (its canonical URL is the
 * list itself), so `page/1` redirects there; anything that is not a plain
 * integer ≥ 2 (`page/0`, `page/02`, `page/x`) is a 404.
 */
export type PageParam = { ok: true; page: number } | { ok: false; redirectToFirst: boolean };

export function parsePageParam(value: string | undefined): PageParam {
  if (value === '1') return { ok: false, redirectToFirst: true };
  if (!value || !/^[1-9]\d{0,5}$/.test(value)) return { ok: false, redirectToFirst: false };
  return { ok: true, page: Number(value) };
}
