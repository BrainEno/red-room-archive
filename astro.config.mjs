import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

/** Long-lived vendor chunks: a content change should not invalidate three.js. */
const vendorChunk = (id) => {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('/three/')) return 'vendor-three';
  if (id.includes('/gsap/') || id.includes('/lenis/')) return 'vendor-motion';
  return undefined;
};

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // The dev server is exposed with --host; allow preview hostnames (dev only).
  server: { allowedHosts: true },
  // Astro's origin check guards cookie-authenticated form posts. This app has
  // no cookies: every write needs an `Authorization: Bearer` header, which a
  // cross-site page cannot attach, so CSRF does not apply. Leaving the check on
  // breaks multipart uploads and DELETEs from scripts and from behind reverse
  // proxies whose public Origin differs from the internal URL.
  security: { checkOrigin: false },
  vite: {
    ssr: { external: ['better-sqlite3'] },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: { output: { manualChunks: vendorChunk } },
    },
  },
});
