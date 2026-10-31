/** Public offline status + service-worker registration. Never used by /admin. */
const note = document.querySelector<HTMLElement>('[data-offline-status]');
if (note) {
  const update = () => { note.hidden = navigator.onLine; };
  update();
  addEventListener('online', update);
  addEventListener('offline', update);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Offline is progressive enhancement; a blocked worker never breaks reading.
      });
    }, { once: true });
  }
}
