/* Red Room public offline worker. Never intercept admin, APIs or token pages. */
const VERSION = 'v1';
const PAGES = `rra-pages-${VERSION}`;
const ASSETS = `rra-assets-${VERSION}`;
const CORE = ['/offline', '/zh-CN/offline', '/manifest.webmanifest'];
const MAX_PAGES = 60;
const MAX_ASSETS = 140;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    await cache.addAll(CORE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([PAGES, ASSETS]);
    await Promise.all((await caches.keys()).filter((key) => key.startsWith('rra-') && !keep.has(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

const trim = async (cache, maximum) => {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maximum)).map((key) => cache.delete(key)));
};
const match = (request) => caches.match(request, { ignoreVary: true });
const cacheable = (response) => response.ok && response.type === 'basic' && !/no-store/i.test(response.headers.get('Cache-Control') || '');
const save = async (name, request, response, maximum) => {
  if (!cacheable(response)) return;
  const cache = await caches.open(name);
  await cache.put(request, response);
  await trim(cache, maximum);
};

const networkPage = async (request) => {
  const url = new URL(request.url);
  try {
    // Some Chromium versions still let a worker fetch succeed under emulated
    // offline mode. When the browser explicitly says it is offline, go straight
    // to the saved copy instead of waiting for a network timeout.
    if (self.navigator.onLine === false) throw new Error('offline');
    const response = await fetch(request);
    // A temporary origin/server failure must not replace a good saved page or
    // hide it behind an error response. Real 404s and 429s still pass through.
    if (response.status >= 500) throw new Error(`origin ${response.status}`);
    // Query URLs (including search terms) are never written to Cache Storage.
    if (!url.search) await save(PAGES, request, response.clone(), MAX_PAGES);
    return response;
  } catch (error) {
    if (!url.search) {
      const cached = await match(request);
      if (cached) return cached;
    }
    const language = url.pathname === '/zh-CN' || url.pathname.startsWith('/zh-CN/') ? '/zh-CN/offline' : '/offline';
    return (await match(language)) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
};

const cacheAsset = async (request, immutable) => {
  if (immutable) {
    const cached = await match(request);
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    await save(ASSETS, request, response.clone(), MAX_ASSETS);
    return response;
  } catch (error) {
    const cached = await match(request);
    if (cached) return cached;
    throw error;
  }
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // No private response, newsletter token, JSON, CSV or collection payload enters a cache.
  if (/^\/(?:api|admin)(?:\/|$)/.test(url.pathname) || /^\/(?:zh-CN\/)?newsletter(?:\/|$)/.test(url.pathname) || url.pathname === '/profile-editor.html') return;
  if (request.mode === 'navigate') {
    event.respondWith(networkPage(request));
    return;
  }
  const immutable = url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/models/') || /^\/(?:icon-|apple-touch-icon|favicon)/.test(url.pathname);
  const asset = immutable || ['style', 'script', 'font', 'image'].includes(request.destination);
  if (asset && url.pathname !== '/sw.js') event.respondWith(cacheAsset(request, immutable));
});
