// Settings are saved on /admin in another tab. Reload same-origin pages so
// SSR, metadata and animated homepage copy all agree with the saved profile.
// localStorage may be unavailable in private browsing; navigation/reload still
// reads the current settings normally.
window.addEventListener('storage', (event) => {
  if (/^\/admin\/?$/.test(location.pathname) || event.key !== 'rra:settings-changed' || !event.newValue) return;
  if (location.pathname === '/') {
    try { sessionStorage.setItem('rra:resume', JSON.stringify({ y: scrollY, at: Date.now() })); } catch { /* best effort */ }
  }
  location.reload();
});
