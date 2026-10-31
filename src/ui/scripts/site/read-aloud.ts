/** Browser-native article narration. No article text is sent to this server. */

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'SUMMARY', 'ASIDE', 'DIV']);
const SKIP = 'nav.toc, .bookmark-url, .code-copy, annotation, script, style, iframe, audio, video, input, [aria-hidden="true"]';

/** Extract in document order, without repeating nested list text or the TOC. */
export function articleSpeechText(root: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) { parts.push(node.textContent ?? ''); return; }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.matches(SKIP)) return;
    const block = BLOCKS.has(el.tagName);
    if (block || el.tagName === 'BR') parts.push('\n');
    for (const child of el.childNodes) walk(child);
    if (block) parts.push('\n');
  };
  walk(root);
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/** Keep utterances short enough for browser speech engines and avoid splitting surrogate pairs. */
export function speechChunks(text: string, maxLength = 220): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let chars = Array.from(paragraph.trim());
    while (chars.length > maxLength) {
      const head = chars.slice(0, maxLength);
      let cut = -1;
      for (let i = head.length - 1; i >= Math.floor(maxLength / 2); i--) {
        if (/[。！？.!?；;\s]/u.test(head[i]!)) { cut = i + 1; break; }
      }
      if (cut < 0) cut = maxLength;
      const chunk = head.slice(0, cut).join('').trim();
      if (chunk) chunks.push(chunk);
      chars = chars.slice(cut);
    }
    const rest = chars.join('').trim();
    if (rest) chunks.push(rest);
  }
  return chunks;
}

/** Pick a voice for the content of each passage, not the interface language. */
export function speechLanguage(text: string, fallback: string): string {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  if (han || latin) return han * 2 >= latin ? 'zh-CN' : 'en';
  return fallback;
}

export function matchingVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const desired = lang.toLowerCase();
  return voices.find((voice) => voice.lang.toLowerCase() === desired)
    ?? voices.find((voice) => voice.lang.toLowerCase().split('-')[0] === desired.split('-')[0]);
}

/** Returns false (and leaves the control unusable) when there is nothing to read. */
export function initReadAloud(root: HTMLElement, synth: SpeechSynthesis): boolean {
  const article = root.closest('article');
  const body = article?.querySelector('.article-body');
  const title = article?.querySelector('[data-article-title]');
  const play = root.querySelector<HTMLButtonElement>('[data-play]');
  const label = root.querySelector<HTMLElement>('[data-play-label]');
  const stopButton = root.querySelector<HTMLButtonElement>('[data-stop]');
  const speed = root.querySelector<HTMLSelectElement>('[data-speed]');
  const seek = root.querySelector<HTMLInputElement>('[data-seek]');
  const status = root.querySelector<HTMLElement>('[data-status]');
  const caption = root.querySelector<HTMLElement>('[data-caption]');
  if (!body || !title || !play || !label || !stopButton || !speed || !seek || !status) return false;
  const text = articleSpeechText(body);
  if (!text.trim()) return false;
  const chunks = speechChunks([title.textContent?.trim(), text].filter(Boolean).join('\n'));
  if (!chunks.length) return false;
  const starts: number[] = [];
  let total = 0;
  for (const chunk of chunks) { starts.push(total); total += chunk.length; }

  const fallbackLang = article?.getAttribute('lang') || document.documentElement.lang || 'en';
  let state: 'idle' | 'playing' | 'paused' = 'idle';
  let generation = 0;
  let current: SpeechSynthesisUtterance | undefined;
  let activeIndex = 0;
  // UTF-16 offsets match SpeechSynthesisEvent.charIndex. Engines without
  // boundary events stay at the beginning of the active passage.
  let offset = 0;
  let progressRatio = 0;
  let scrubbing = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const positionRatio = () => activeIndex >= chunks.length ? 1 : clamp(((starts[activeIndex] ?? 0) + offset) / total);
  const setProgress = (ratio: number) => {
    progressRatio = clamp(ratio);
    const percent = Math.round(progressRatio * 100);
    seek.style.setProperty('--p', `${progressRatio * 100}%`);
    if (!scrubbing) seek.value = String(Math.round(progressRatio * 1000));
    seek.setAttribute('aria-valuetext', `${percent}%`);
    if (caption && state !== 'idle') caption.textContent = `${state === 'paused' ? root.dataset.paused : root.dataset.listening} · ${percent}%`;
  };
  const showState = (next: typeof state, message = '') => {
    state = next;
    root.dataset.state = next;
    label.textContent = next === 'playing' ? root.dataset.pause! : next === 'paused' ? root.dataset.resume! : root.dataset.listen!;
    stopButton.hidden = next === 'idle';
    seek.disabled = next === 'idle';
    status.textContent = message;
    status.classList?.toggle('read-aloud-error', message === root.dataset.error);
    if (next === 'idle' && caption) caption.textContent = message && message !== root.dataset.error ? message : root.dataset.hint ?? '';
    else if (next !== 'idle') setProgress(progressRatio);
  };
  const clearRestart = () => { if (restartTimer !== undefined) clearTimeout(restartTimer); restartTimer = undefined; };
  const stop = (message = '') => {
    generation++;
    clearRestart();
    synth.cancel();
    current = undefined;
    activeIndex = 0;
    offset = 0;
    scrubbing = false;
    showState('idle', message);
    setProgress(0);
  };
  const finish = () => {
    current = undefined;
    activeIndex = chunks.length;
    offset = 0;
    scrubbing = false;
    showState('idle', root.dataset.finished);
    setProgress(1);
  };
  const speakChunk = (index: number, run: number, from = 0) => {
    if (run !== generation) return;
    if (index >= chunks.length) { finish(); return; }
    activeIndex = index;
    offset = from;
    if (!scrubbing) setProgress(((starts[index] ?? 0) + from) / total);
    try {
      const source = chunks[index]!;
      if (from >= source.length) { speakChunk(index + 1, run); return; }
      const start = Math.max(0, from);
      const utterance = new SpeechSynthesisUtterance(source.slice(start));
      current = utterance; // retain a reference on browsers that collect queued utterances
      // Keep the passage's original language even after seeking or changing rate.
      utterance.lang = speechLanguage(source, fallbackLang);
      const voice = matchingVoice(synth.getVoices(), utterance.lang);
      if (voice) utterance.voice = voice;
      utterance.rate = Number(speed.value) || 1;
      utterance.onboundary = (event) => {
        if (run !== generation || !Number.isFinite(event.charIndex)) return;
        offset = Math.min(source.length, start + event.charIndex);
        if (!scrubbing) setProgress(((starts[index] ?? 0) + offset) / total);
      };
      utterance.onend = () => { if (run === generation) { offset = 0; speakChunk(index + 1, run); } };
      utterance.onerror = () => { if (run === generation) stop(root.dataset.error); };
      synth.speak(utterance);
    } catch { if (run === generation) stop(root.dataset.error); }
  };
  const restartSpeech = (index: number, from: number) => {
    const run = ++generation;
    clearRestart();
    current = undefined;
    synth.cancel();
    // Some Chromium/WebKit voices drop speak() when it is called in the same
    // task as cancel(). A short task boundary makes the replacement audible;
    // generation still isolates every late callback from the cancelled voice.
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (run !== generation || state === 'idle') return;
      speakChunk(index, run, from);
      if (run !== generation) return;
      if (state === 'paused' && !synth.paused) synth.pause();
      else if (state === 'playing' && synth.paused) synth.resume();
    }, 40);
  };
  const safeSeekOffset = (source: string, desired: number) => {
    let from = Math.max(0, Math.min(source.length, desired));
    // Never split a surrogate pair; start Latin words at their beginning rather
    // than making the voice pronounce a fragment after a seek.
    if (from > 0 && from < source.length && /[\uDC00-\uDFFF]/.test(source[from]!) && /[\uD800-\uDBFF]/.test(source[from - 1]!)) from--;
    const word = (char: string | undefined) => Boolean(char && /[\p{Script=Latin}\p{Number}'’-]/u.test(char));
    if (from > 0 && from < source.length && word(source[from]) && word(source[from - 1])) {
      while (from > 0 && word(source[from - 1])) from--;
    }
    return from;
  };
  const seekTo = (ratio: number) => {
    const target = ratio >= 1 ? total : Math.floor(clamp(ratio) * total);
    let index = chunks.length - 1;
    for (let i = 0; i < chunks.length; i++) {
      if (target < (starts[i] ?? 0) + chunks[i]!.length) { index = i; break; }
    }
    const source = chunks[index]!;
    const from = safeSeekOffset(source, target - (starts[index] ?? 0));
    setProgress(((starts[index] ?? 0) + from) / total);
    restartSpeech(index, from);
  };
  play.addEventListener('click', () => {
    if (state === 'playing') { synth.pause(); showState('paused', root.dataset.paused); return; }
    if (state === 'paused') { synth.resume(); showState('playing', root.dataset.listening); return; }
    generation++;
    clearRestart();
    synth.cancel();
    // cancel() does not clear the synthesis engine's paused state.
    if (synth.paused) synth.resume();
    activeIndex = 0;
    offset = 0;
    scrubbing = false;
    showState('playing', root.dataset.listening);
    speakChunk(0, generation);
  });
  speed.addEventListener('change', () => {
    if (state === 'idle') return;
    // utterance.rate is normally snapshotted by speak(), so replacing only a
    // future chunk is not enough. Restart the active position at the new rate.
    restartSpeech(activeIndex, offset);
  });
  seek.addEventListener('input', () => {
    if (state === 'idle') return;
    scrubbing = true;
    setProgress(Number(seek.value) / 1000);
  });
  seek.addEventListener('change', () => {
    if (state === 'idle') return;
    const ratio = Number(seek.value) / 1000;
    scrubbing = false;
    seekTo(ratio);
  });
  seek.addEventListener('pointercancel', () => {
    if (!scrubbing) return;
    scrubbing = false;
    setProgress(positionRatio());
  });
  stopButton.addEventListener('click', () => stop(root.dataset.stopped));
  window.addEventListener('pagehide', () => { if (state !== 'idle' || current || restartTimer !== undefined) stop(); });
  root.hidden = false;
  delete root.dataset.pending;
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const root = document.querySelector<HTMLElement>('[data-read-aloud]');
  const synth = typeof window.SpeechSynthesisUtterance === 'function' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
  const usable = Boolean(synth && ['speak', 'pause', 'resume', 'cancel', 'getVoices'].every((method) => typeof synth[method as keyof SpeechSynthesis] === 'function'));
  // The control holds its place from the first paint; remove it only where it cannot work.
  if (root && !(usable && initReadAloud(root, synth!))) root.hidden = true;
}
