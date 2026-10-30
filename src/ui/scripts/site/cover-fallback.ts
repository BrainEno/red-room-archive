/**
 * A cover that fails to load (an external host gone, an expired link) is
 * removed, and the layout falls back to the text-only design instead of a
 * broken-image box: list entries lose `has-cover`, the article body becomes
 * `text-only`. Listens in the capture phase because `error` does not bubble,
 * and checks images that failed before this module ran.
 */
const COVERS = 'img.cover, img.article-cover';

function drop(image: HTMLImageElement) {
  image.closest('.article-entry')?.classList.remove('has-cover');
  if (image.classList.contains('cover')) image.closest('.prose')?.querySelector('.article-body')?.classList.add('text-only');
  image.remove();
}

document.addEventListener(
  'error',
  (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.matches(COVERS)) drop(target);
  },
  true,
);
for (const image of document.querySelectorAll<HTMLImageElement>(COVERS)) {
  if (image.complete && image.naturalWidth === 0 && image.getAttribute('src')) drop(image);
}
