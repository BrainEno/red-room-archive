/** Browser-local reading annotations. Nothing here requires a server or a database. */
export const PASSAGE_LIMIT = 240;
export const NOTE_LIMIT = 280;
export const ANNOTATION_LIMIT = 50;
export const ANNOTATION_STORAGE_PREFIX = 'rra-article-annotations-v1:';

export interface PassageAnchor {
  start: number;
  end: number;
  text: string;
  prefix: string;
  suffix: string;
}

export interface ArticleAnnotation extends PassageAnchor {
  id: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export const characterCount = (value: string): number => Array.from(value).length;
export const annotationStorageKey = (slug: string): string => `${ANNOTATION_STORAGE_PREFIX}${slug}`;
export const isNearlyWholeArticle = (selected: number, total: number): boolean => total > 0 && selected / total >= .9;

export function parseAnnotations(raw: string | null): ArticleAnnotation[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): ArticleAnnotation[] => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      if (typeof item.id !== 'string' || !item.id || typeof item.text !== 'string' || !item.text) return [];
      if (typeof item.start !== 'number' || typeof item.end !== 'number' || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start) return [];
      if (characterCount(item.text) > PASSAGE_LIMIT || typeof item.note !== 'string' || characterCount(item.note) > NOTE_LIMIT) return [];
      return [{
        id: item.id.slice(0, 80),
        start: item.start as number,
        end: item.end as number,
        text: item.text,
        prefix: typeof item.prefix === 'string' ? item.prefix.slice(-64) : '',
        suffix: typeof item.suffix === 'string' ? item.suffix.slice(0, 64) : '',
        note: item.note,
        createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0,
        updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
      }];
    }).slice(0, ANNOTATION_LIMIT);
  } catch { return []; }
}

/** A visible source notice, not a claim that browser copy events prevent every form of reuse. */
export function watermarkedCopy(text: string, data: {
  title: string;
  siteName: string;
  articleUrl: string;
  copyrightUrl: string;
  year: number;
  locale: string;
}): string {
  const source = text.trimEnd();
  if (data.locale.startsWith('zh')) {
    return `${source}\n\n——《${data.title}》\n来源：${data.siteName} · ${data.articleUrl}\n© ${data.year} ${data.siteName}，保留所有权利。转载请注明出处。\n转载与引用说明：${data.copyrightUrl}`;
  }
  return `${source}\n\n— ${data.title}\n${data.siteName} · ${data.articleUrl}\n© ${data.year} ${data.siteName}. All rights reserved. Please credit the source.\nReuse terms: ${data.copyrightUrl}`;
}
