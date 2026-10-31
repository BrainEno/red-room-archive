/**
 * One anonymous pageview per full navigation. No cookie, storage, visitor id,
 * query string, title, viewport or full referrer URL is collected.
 */
import { isGitHubPages, publicPath } from '../lib/public-path.ts';
const privacyRequested = () => {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || win.doNotTrack === '1';
};

const referrer = () => {
  if (!document.referrer) return '';
  try {
    const source = new URL(document.referrer);
    return source.origin === location.origin ? '(internal)' : source.hostname;
  } catch { return ''; }
};

let sent = false;
const collect = () => {
  if (sent || isGitHubPages() || privacyRequested() || document.visibilityState === 'hidden') return;
  sent = true;
  const body = JSON.stringify({ path: location.pathname, referrer: referrer() });
  // A string body with keepalive avoids engine-specific Blob/sendBeacon
  // behaviour and can finish even when the reader immediately navigates away.
  void fetch(publicPath('/api/analytics/collect'), { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => undefined);
};

if (document.visibilityState === 'visible') collect();
else {
  document.addEventListener('visibilitychange', function visible() {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', visible);
    collect();
  });
}
