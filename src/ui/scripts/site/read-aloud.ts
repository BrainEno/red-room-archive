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

export function initReadAloud(root: HTMLElement, synth: SpeechSynthesis): void {
  const article = root.closest('article');
  const body = article?.querySelector('.article-body');
  const title = article?.querySelector('[data-article-title]');
  const play = root.querySelector<HTMLButtonElement>('[data-play]');
  const label = root.querySelector<HTMLElement>('[data-play-label]');
  const stopButton = root.querySelector<HTMLButtonElement>('[data-stop]');
  const speed = root.querySelector<HTMLSelectElement>('[data-speed]');
  const status = root.querySelector<HTMLElement>('[data-status]');
  if (!body || !title || !play || !label || !stopButton || !speed || !status) return;
  const text = articleSpeechText(body);
  if (!text.trim()) return;
  const chunks = speechChunks([title.textContent?.trim(), text].filter(Boolean).join('\n'));
  if (!chunks.length) return;

  const fallbackLang = article?.getAttribute('lang') || document.documentElement.lang || 'en';
  let state: 'idle' | 'playing' | 'paused' = 'idle';
  let generation = 0;
  let current: SpeechSynthesisUtterance | undefined;
  const showState = (next: typeof state, message = '') => {
    state = next;
    root.dataset.state = next;
    label.textContent = next === 'playing' ? root.dataset.pause! : next === 'paused' ? root.dataset.resume! : root.dataset.listen!;
    stopButton.hidden = next === 'idle';
    status.textContent = message;
    status.classList?.toggle('read-aloud-error', message === root.dataset.error);
  };
  const stop = (message = '') => {
    generation++;
    synth.cancel();
    current = undefined;
    showState('idle', message);
  };
  const speakChunk = (index: number, run: number) => {
    if (run !== generation) return;
    if (index >= chunks.length) { current = undefined; showState('idle', root.dataset.finished); return; }
    try {
      const text = chunks[index]!;
      const utterance = new SpeechSynthesisUtterance(text);
      current = utterance; // retain a reference on browsers that collect queued utterances
      utterance.lang = speechLanguage(text, fallbackLang);
      const voice = matchingVoice(synth.getVoices(), utterance.lang);
      if (voice) utterance.voice = voice;
      utterance.rate = Number(speed.value) || 1;
      utterance.onend = () => { if (run === generation) speakChunk(index + 1, run); };
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
    showState('playing', root.dataset.listening);
    speakChunk(0, generation);
  });
  stopButton.addEventListener('click', () => stop(root.dataset.stopped));
  window.addEventListener('pagehide', () => { if (state !== 'idle' || current) stop(); });
  root.hidden = false;
}

if (typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function' && 'speechSynthesis' in window) {
  const synth = window.speechSynthesis;
  const root = document.querySelector<HTMLElement>('[data-read-aloud]');
  if (root && synth && ['speak', 'pause', 'resume', 'cancel', 'getVoices'].every((method) => typeof synth[method as keyof SpeechSynthesis] === 'function')) {
    initReadAloud(root, synth);
  }
}
