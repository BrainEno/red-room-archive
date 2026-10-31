/**
 * Root-relative public URL for a static site mounted below an origin.
 * The snapshot writer owns data-base-path; ordinary Node/Netlify builds have
 * no attribute and therefore keep the existing root URLs unchanged.
 */
export const publicBasePath = (): string => document.documentElement.dataset?.basePath || '';

export const publicPath = (path: string): string => {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${publicBasePath()}${path}` || '/';
};

/** GitHub Pages has no server endpoints; do not emit known-404 analytics writes. */
export const isGitHubPages = (): boolean => document.documentElement.dataset?.staticHost === 'github-pages';
