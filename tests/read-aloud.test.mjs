import test from 'node:test';
import assert from 'node:assert/strict';
import { articleSpeechText, speechChunks, speechLanguage, matchingVoice, initReadAloud } from '../src/ui/scripts/site/read-aloud.ts';

const text = (value) => ({ nodeType: 3, textContent: value });
const element = (tag, children = [], excluded = false) => ({
  nodeType: 1, tagName: tag.toUpperCase(), childNodes: children,
  matches: () => excluded,
});

test('speech extracts article blocks in order without duplicating nested text or navigation', () => {
  const body = element('div', [
    element('p', [text('第一行\n第二行 '), element('strong', [text('强调')])]),
    element('nav', [text('Do not read the table of contents')], true),
    element('ul', [element('li', [text('One'), element('ul', [element('li', [text('Nested')])])]), element('li', [text('Two')])]),
    element('div', [text('bookmark title'), element('span', [text('https://unnecessary.example')], true)]),
    element('figure', [element('figcaption', [text('A caption')])]),
  ]);
  assert.equal(articleSpeechText(body), '第一行\n第二行 强调\nOne\nNested\nTwo\nbookmark title\nA caption');
});

test('speech skips the TeX source of formulas and the code copy button', () => {
  const tagged = (tag, cls, children) => ({
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: children,
    matches: (selector) => selector.split(',').map((part) => part.trim()).some((part) => part === tag || part === `.${cls}`),
  });
  const body = element('div', [
    element('p', [text('Energy '), tagged('math', '', [tagged('mi', '', [text('E')]), tagged('annotation', '', [text('E = mc^2')])]), text(' grows.')]),
    element('figure', [tagged('button', 'code-copy', [text('Copy')]), element('pre', [text('const x = 1;')])]),
  ]);
  assert.equal(articleSpeechText(body), 'Energy E grows.\nconst x = 1;');
});

test('speech chunks preserve words and Unicode, choose content language and matching voices', () => {
  assert.deepEqual(speechChunks('One. Two. Three.\n你好，世界。', 10), ['One. Two.', 'Three.', '你好，世界。']);
  const long = '甲'.repeat(230) + '😀' + '乙'.repeat(230);
  const chunks = speechChunks(long);
  assert.equal(chunks.join(''), long);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 220));
  assert.equal(speechLanguage('中文标题 notes', 'en'), 'zh-CN');
  assert.equal(speechLanguage('English paragraph', 'zh-CN'), 'en');
  assert.equal(speechLanguage('123', 'zh-CN'), 'zh-CN');
  const voices = [{ lang: 'en-US', name: 'English' }, { lang: 'zh-TW', name: 'Chinese' }];
  assert.equal(matchingVoice(voices, 'zh-CN').name, 'Chinese');
  assert.equal(matchingVoice(voices, 'en').name, 'English');
  assert.equal(matchingVoice(voices, 'fr'), undefined);
});

function fakeControl() {
  const events = {};
  const props = {};
  return { hidden: false, textContent: '', value: '1', events, props, style: { setProperty(name, value) { props[name] = value; } }, classList: { state: {}, toggle(name, enabled) { this.state[name] = enabled; } },
    addEventListener(name, fn) { events[name] = fn; }, click() { events.click(); } };
}

test('player pauses, resumes, changes speed, ignores cancelled callbacks and stops on pagehide', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldUtterance = globalThis.SpeechSynthesisUtterance;
  const listeners = {};
  globalThis.window = { addEventListener(name, fn) { listeners[name] = fn; } };
  globalThis.document = { documentElement: { lang: 'en' } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const play = fakeControl(), label = fakeControl(), stop = fakeControl(), speed = fakeControl(), status = fakeControl();
  const caption = fakeControl(), progress = fakeControl();
  const body = element('div', [element('p', [text('First paragraph.')]), element('p', [text('第二段。')])]);
  const title = { textContent: 'Title' };
  const article = { getAttribute: () => 'en', querySelector: (selector) => selector === '.article-body' ? body : title };
  const controls = { '[data-play]': play, '[data-play-label]': label, '[data-stop]': stop, '[data-speed]': speed, '[data-status]': status, '[data-caption]': caption, '[data-progress]': progress };
  const root = { hidden: true, dataset: { pending: '', listen: 'Listen', pause: 'Pause', resume: 'Resume', listening: 'Reading', paused: 'Paused', finished: 'Finished', stopped: 'Stopped', error: 'Error', hint: 'Hint' },
    closest: () => article, querySelector: (selector) => controls[selector] };
  const synth = { paused: false, spoken: [], cancels: 0, getVoices: () => [{ lang: 'en-US' }, { lang: 'zh-CN' }],
    speak(utterance) { this.spoken.push(utterance); }, cancel() { this.cancels++; }, pause() { this.paused = true; }, resume() { this.paused = false; } };
  try {
    assert.equal(initReadAloud(root, synth), true, 'reports that the player is usable');
    assert.equal(root.hidden, false);
    assert.equal('pending' in root.dataset, false, 'the reserved space becomes visible');
    play.click();
    assert.equal(synth.spoken[0].text, 'Title');
    assert.equal(label.textContent, 'Pause');
    assert.equal(root.dataset.state, 'playing');
    play.click(); assert.equal(synth.paused, true); assert.equal(label.textContent, 'Resume');
    play.click(); assert.equal(synth.paused, false);
    speed.value = '1.5';
    speed.events.change();
    assert.equal(synth.spoken.length, 2, 'a rate change restarts the active passage immediately');
    assert.equal(synth.spoken[1].text, 'Title');
    assert.equal(synth.spoken[1].rate, 1.5);
    synth.spoken[0].onend();
    assert.equal(synth.spoken.length, 2, 'the cancelled utterance cannot advance the new run');
    synth.spoken[1].onboundary({ charIndex: 2 });
    play.click();
    speed.value = '0.8';
    speed.events.change();
    assert.equal(synth.spoken[2].text, 'tle', 'a paused rate change resumes from the latest boundary');
    assert.equal(synth.spoken[2].rate, 0.8);
    assert.equal(synth.paused, true, 'changing speed does not unexpectedly resume a paused player');
    assert.equal(root.dataset.state, 'paused');
    play.click();
    synth.spoken[2].onend();
    assert.equal(progress.props['--p'], '0.3333333333333333', 'the progress line follows spoken passages');
    assert.equal(caption.textContent, 'Reading · 33%', 'the visible caption mirrors the state');
    assert.equal(synth.spoken[3].text, 'First paragraph.');
    assert.equal(synth.spoken[3].rate, 0.8);
    synth.spoken[3].onend();
    assert.equal(synth.spoken[4].lang, 'zh-CN');
    assert.equal(synth.spoken[4].voice.lang, 'zh-CN');
    stop.click();
    synth.spoken[4].onend();
    assert.equal(synth.spoken.length, 5, 'late events cannot restart playback');
    assert.equal(status.textContent, 'Stopped');
    assert.equal(caption.textContent, 'Stopped');
    assert.equal(progress.props['--p'], '0', 'stopping resets the progress line');
    play.click();
    synth.spoken.at(-1).onerror();
    assert.equal(status.textContent, 'Error');
    assert.equal(status.classList.state['read-aloud-error'], true, 'errors are visible as well as announced');
    play.click();
    assert.equal(status.classList.state['read-aloud-error'], false);
    listeners.pagehide();
    assert.equal(label.textContent, 'Listen');
    assert.ok(synth.cancels >= 3);
  } finally {
    globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.SpeechSynthesisUtterance = oldUtterance;
  }
});
