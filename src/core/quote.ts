/**
 * A quotation with a trailing attribution, as typed in a single field:
 *   `写作就是……一场战斗。——维托尔德·贡布罗维奇`
 *   `Writing is … dignity. — Witold Gombrowicz`
 * The homepage sets the attribution on its own line. Only a dash that follows
 * the end of a sentence counts, so a dash inside the quote (`audience—waged`)
 * is left alone, and an "attribution" that is itself a sentence is not one.
 */
export interface Quote {
  quote: string;
  /** The attribution with its dash, e.g. `——维托尔德·贡布罗维奇`; '' when there is none. */
  cite: string;
}

const PATTERN = /^([\s\S]*?[。！？.!?…”"’』」)）])\s*((?:——|—|―|–|--)\s*[^\s—―–][^—―–。！？!?\n]{0,59})$/u;

export function splitQuote(text: string): Quote {
  const value = String(text ?? '').trim();
  const match = PATTERN.exec(value);
  if (!match || /[.。]$/.test(match[2]!)) return { quote: value, cite: '' };
  return { quote: match[1]!.trim(), cite: match[2]!.trim() };
}
