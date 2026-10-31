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
  const status = root.querySelector<HTMLElement>('[data-status]');
  // Optional visual layer: a visible caption and a progress line (the status above is for screen readers).
  const caption = root.querySelector<HTMLElement>('[data-caption]');
  const progress = root.querySelector<HTMLElement>('[data-progress]');
  if (!body || !title || !play || !label || !stopButton || !speed || !status) return false;
  const text = articleSpeechText(body);
  if (!text.trim()) return false;
  const chunks = speechChunks([title.textContent?.trim(), text].filter(Boolean).join('\n'));
  if (!chunks.length) return false;

  const fallbackLang = article?.getAttribute('lang') || document.documentElement.lang || 'en';
  let state: 'idle' | 'playing' | 'paused' = 'idle';
  let generation = 0;
  let current: SpeechSynthesisUtterance | undefined;
  let done = 0;
  let activeIndex = 0;
  // Last spoken boundary within the active chunk (UTF-16, as specified by
  // SpeechSynthesisEvent.charIndex). Engines without boundary events use 0.
  let offset = 0;
  /** Progress as the share of passages already spoken (CSSOM, allowed by the strict CSP). */
  const setProgress = (ratio: number) => {
    progress?.style?.setProperty('--p', String(Math.max(0, Math.min(1, ratio))));
    if (caption && state !== 'idle') {
      caption.textContent = `${state === 'paused' ? root.dataset.paused : root.dataset.listening} · ${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    }
  };
  const showState = (next: typeof state, message = '') => {
    state = next;
    root.dataset.state = next;
    label.textContent = next === 'playing' ? root.dataset.pause! : next === 'paused' ? root.dataset.resume! : root.dataset.listen!;
    stopButton.hidden = next === 'idle';
    status.textContent = message;
    status.classList?.toggle('read-aloud-error', message === root.dataset.error);
    if (caption) caption.textContent = next === 'idle' ? (message && message !== root.dataset.error ? message : root.dataset.hint ?? '') : caption.textContent;
    if (next !== 'idle') setProgress(done / chunks.length);
  };
  const stop = (message = '') => {
    generation++;
    synth.cancel();
    current = undefined;
    done = 0;
    activeIndex = 0;
    offset = 0;
    showState('idle', message);
    setProgress(0);
  };
  const speakChunk = (index: number, run: number, from = 0) => {
    if (run !== generation) return;
    done = index;
    activeIndex = index;
    offset = from;
    setProgress(index / chunks.length);
    if (index >= chunks.length) { current = undefined; done = 0; offset = 0; showState('idle', root.dataset.finished); return; }
    try {
      const source = chunks[index]!;
      if (from >= source.length) { speakChunk(index + 1, run); return; }
      const start = Math.max(0, from);
      const utterance = new SpeechSynthesisUtterance(source.slice(start));
      current = utterance; // retain a reference on browsers that collect queued utterances
      // Keep the passage's original language even when a rate change resumes
      // after a boundary near text in another language.
      utterance.lang = speechLanguage(source, fallbackLang);
      const voice = matchingVoice(synth.getVoices(), utterance.lang);
      if (voice) utterance.voice = voice;
      utterance.rate = Number(speed.value) || 1;
      utterance.onboundary = (event) => {
        if (run === generation && Number.isFinite(event.charIndex)) offset = Math.min(source.length, start + event.charIndex);
      };
      utterance.onend = () => { if (run === generation) { offset = 0; speakChunk(index + 1, run); } };
      utterance.onerror = () => { if (run === generation) stop(root.dataset.error); };
      synth.speak(utterance);
    } catch { if (run === generation) stop(root.dataset.error); }
  };
  play.addEventListener('click', () => {
    if (state === 'playing') { synth.pause(); showState('paused', root.dataset.paused); return; }
    if (state === 'paused') { synth.resume(); showState('playing', root.dataset.listening); return; }
    generation++;
    synth.cancel();
    // cancel() does not clear the synthesis engine's paused state.
    if (synth.paused) synth.resume();
    done = 0;
    showState('playing', root.dataset.listening);
    speakChunk(0, generation);
  });
  speed.addEventListener('change', () => {
    if (state === 'idle' || !current) return;
    // Most engines snapshot utterance.rate when speak() is called. Cancel only
    // the active passage and resume it at the latest boundary so the new speed
    // is audible now instead of taking effect after the next passage.
    const index = activeIndex, from = offset, paused = state === 'paused';
    generation++;
    const run = generation;
    synth.cancel();
    current = undefined;
    speakChunk(index, run, from);
    if (run !== generation) return; // an engine error already showed the stop state
    if (paused && !synth.paused) synth.pause();
    else if (!paused && synth.paused) synth.resume();
    showState(paused ? 'paused' : 'playing');
  });
  stopButton.addEventListener('click', () => stop(root.dataset.stopped));
  window.addEventListener('pagehide', () => { if (state !== 'idle' || current) stop(); });
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
