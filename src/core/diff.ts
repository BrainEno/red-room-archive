/**
 * Line diff (longest common subsequence) for comparing post versions.
 * Pure and dependency-free so the admin UI can run it in the browser.
 */

export type DiffOp = 'same' | 'add' | 'del';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/** Beyond this many line pairs the table would be too large: compare as blocks. */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');

  // Trim the common head and tail first; edits are usually local.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head = a.slice(0, start).map((text): DiffLine => ({ op: 'same', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ op: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ op: 'del', text })),
      ...midB.map((text): DiffLine => ({ op: 'add', text })),
      ...tail,
    ];
  }

  const n = midA.length;
  const m = midB.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ op: 'same', text: midA[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      middle.push({ op: 'del', text: midA[i++]! });
    } else {
      middle.push({ op: 'add', text: midB[j++]! });
    }
  }
  while (i < n) middle.push({ op: 'del', text: midA[i++]! });
  while (j < m) middle.push({ op: 'add', text: midB[j++]! });

  return [...head, ...middle, ...tail];
}

export const diffStats = (lines: DiffLine[]) => ({
  added: lines.filter((line) => line.op === 'add').length,
  removed: lines.filter((line) => line.op === 'del').length,
});
