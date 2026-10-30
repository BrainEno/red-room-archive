/**
 * Syntax highlighting for Notion code blocks, done once on the server.
 *
 * highlight.js marks tokens with classes (`hljs-keyword`, `hljs-string`…);
 * the colours live in pages.css, so the output needs no inline styles and
 * the CSP stays strict. Only the languages registered below are loaded.
 * Anything else — "plain text", unknown names, very long blocks — is shown
 * escaped and uncoloured.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { esc } from './safety.ts';

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, graphql, ini, java, javascript, json, kotlin, latex, lua,
  makefile, markdown, php, python, r, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

/** Notion's language names (normalised: lower case, spaces → '-') → registered highlight.js names. */
const ALIASES: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  docker: 'dockerfile',
  html: 'xml',
  'java/c/c++/c#': 'cpp',
  js: 'javascript',
  ts: 'typescript',
  toml: 'ini',
  sh: 'bash',
  zsh: 'bash',
  powershell: 'shell',
  'objective-c': 'c',
};

/** Blocks longer than this are left uncoloured (highlighting cost grows with size). */
const MAX_CODE = 100_000;

/** The registered highlight.js language for a Notion language name, or null. */
export function codeLanguage(name: string): string | null {
  const key = String(name ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  const target = ALIASES[key] ?? key;
  return hljs.getLanguage(target) ? target : null;
}

/** Escaped code with `<span class="hljs-…">` tokens (or just escaped when the language is unknown). */
export function highlightCode(code: string, language: string): string {
  const target = codeLanguage(language);
  if (!target || code.length > MAX_CODE) return esc(code);
  try {
    return hljs.highlight(code, { language: target, ignoreIllegals: true }).value;
  } catch {
    return esc(code);
  }
}
