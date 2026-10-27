/** Small DOM helpers shared by the admin panels. */
import { escapeHtml } from '../../../core/text.ts';

export { escapeHtml as esc };
export { formatBytes as bytes } from '../../../core/text.ts';

export const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing element ${selector}`);
  return element;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, bad = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast on${bad ? ' bad' : ''}`;
  element.setAttribute('role', bad ? 'alert' : 'status');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (element.className = 'toast'), 3200);
}

export const fail = (error: unknown) => toast(error instanceof Error ? error.message : String(error), true);

/** Open the native file picker and resolve with the chosen file (or null). */
export const pickFile = (accept = '') =>
  new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });

/** Disable a form's buttons while an async action runs. */
export async function busy<T>(root: HTMLElement, action: () => Promise<T>): Promise<T> {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach((button) => (button.disabled = true));
  root.setAttribute('aria-busy', 'true');
  try {
    return await action();
  } finally {
    buttons.forEach((button) => (button.disabled = false));
    root.removeAttribute('aria-busy');
  }
}

export const dateLabel = (value: unknown) => String(value ?? '').slice(0, 10);

/** `2026-10-27 13:45` from an ISO or SQLite timestamp (SQLite ones are UTC). */
export const timeLabel = (value: unknown) => {
  const raw = String(value ?? '');
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Hand a fetched file to the browser's "save" flow. */
export function saveDownload({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
