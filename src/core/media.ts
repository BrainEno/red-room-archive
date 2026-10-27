/**
 * Classify an entry URL so pages can choose the right player.
 * Pure function — unit tested in tests/media.test.mjs.
 */
import { isSafeUrl } from './safety.ts';

export type Media =
  | { kind: 'audio'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'embed'; src: string; provider: 'youtube' | 'vimeo' | 'bandcamp' | 'soundcloud' }
  | { kind: 'link'; href: string }
  | { kind: 'none' };

const AUDIO = /\.(mp3|m4a|wav|ogg|flac|aac)(\?|#|$)/i;
const VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

export const isAudioUrl = (url: unknown): url is string => typeof url === 'string' && AUDIO.test(url);

export function classifyMedia(url: unknown): Media {
  if (typeof url !== 'string' || !url.trim() || !isSafeUrl(url)) return { kind: 'none' };
  const src = url.trim();
  if (AUDIO.test(src)) return { kind: 'audio', src };
  if (VIDEO.test(src)) return { kind: 'video', src };

  let parsed: URL;
  try {
    parsed = new URL(src, 'https://relative.invalid');
  } catch {
    return { kind: 'link', href: src };
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, '');

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id =
      host === 'youtu.be'
        ? parsed.pathname.slice(1)
        : parsed.searchParams.get('v') ?? /^\/(?:embed|shorts|live)\/([\w-]+)/.exec(parsed.pathname)?.[1];
    if (id && /^[\w-]{6,20}$/.test(id)) {
      return { kind: 'embed', provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = /\/(\d{5,12})(?:\/|$)/.exec(parsed.pathname)?.[1];
    if (id) return { kind: 'embed', provider: 'vimeo', src: `https://player.vimeo.com/video/${id}` };
  }
  if (host === 'soundcloud.com') {
    return {
      kind: 'embed',
      provider: 'soundcloud',
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(parsed.toString())}&visual=false&color=%23b01022`,
    };
  }
  if (host === 'bandcamp.com' && parsed.pathname.startsWith('/EmbeddedPlayer')) {
    return { kind: 'embed', provider: 'bandcamp', src: parsed.toString() };
  }
  return { kind: 'link', href: src };
}
