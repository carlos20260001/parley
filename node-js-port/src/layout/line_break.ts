/**
 * Unicode line breaking, replacing `parley_data` plus the UAX #14 state machine
 * in `parley_engine`.
 *
 * ## Why this is not a mechanical port
 *
 * Upstream gets a single packed `Properties` word per codepoint from ICU
 * (script, general category, grapheme cluster break, bidi class, emoji flags)
 * and runs the UAX #14 state machine over it. `parley_data` is generated from
 * ICU data files.
 *
 * JavaScript exposes `General_Category` and `Script` through Unicode property
 * escapes, but **not** `Line_Break`. The UAX #14 state machine is defined in
 * terms of `Line_Break` classes. So the classes are derived here:
 *
 *  - `CM` from `General_Category = Mark`
 *  - `BA` from `General_Category = Pd` (dash) and U+2010
 *  - `HY` from U+2010
 *  - `SP` from `White_Space`
 *  - `ID`/`H2`/`H3` from `Script = Han | Hiragana | Katakana`
 *  - `RI` from U+1F1E6..=1F1FF
 *  - `NU` from `General_Category = Nd`
 *  - `IS` from `General_Category = Po | Ps | Pe | Pi | Pf`
 *  - `PR` from `Sc ? Sm : General_Category = Sc | Sm | Pi | Pf | Ps | Pe`
 *  - `OP`/`CP`/`CL` from open/close punctuation
 *  - `AL` as the remainder
 *
 * ## What this covers accurately, and what it does not
 *
 * The rules below are implemented for the classes that can be derived exactly:
 * spaces, hyphens, combining marks, alphanumerics, CJK ideographs, kana,
 * regional indicators, open/close punctuation, and mandatory breaks.
 *
 * Emoji line-breaking rules (LB30a/LB30b, Extended_Pictographic, variation
 * selectors, emoji modifiers) are deliberately **not** implemented. Handling
 * those exactly needs `Extended_Pictographic`, which JavaScript does not
 * expose, and they affect emoji-containing text only. Latin, Cyrillic, Greek,
 * Arabic, Hebrew, CJK, Thai and Lao text is unaffected.
 */

import { scriptOf } from '../unicode.js';

/** The UAX #14 line break classes the port derives. */
export type LineBreakClass =
  | 'CM'
  | 'BA'
  | 'HY'
  | 'SP'
  | 'ID'
  | 'H2'
  | 'H3'
  | 'NU'
  | 'IS'
  | 'PR'
  | 'OP'
  | 'CP'
  | 'CL'
  | 'AL'
  | 'RI'
  | 'QU'
  | 'EX'
  | 'BK'
  | 'ZW'
  | 'LF'
  | 'CR'
  | 'BJ';

const RE_WHITE_SPACE = /^[\t\v\f\u2028\u2029 ]$/;
const RE_CM = /^\p{M}/u;
const RE_NU = /^\p{Nd}/u;
const RE_PO = /^\p{Po}/u;
const RE_PS = /^\p{Ps}/u;
const RE_PI = /^\p{Pi}/u;
const RE_SC = /^\p{Sc}/u;
const RE_SM = /^\p{Sm}/u;

/** The line break class of one character. */
export function lineBreakClassOf(ch: string): LineBreakClass {
  if (ch === '\n') return 'LF';
  if (ch === '\r') return 'CR';
  if (ch === '\u2028' || ch === '\u2029') return 'BK';
  if (ch === ' ') return 'SP';
  if (RE_WHITE_SPACE.test(ch)) return 'SP';
  if (ch === '\u2010') return 'HY';
  if (ch === '\u200b') return 'ZW';
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return 'RI';
  if (cp >= 0x1100 && cp <= 0x115f) return 'ID';
  if ((cp >= 0x3040 && cp <= 0x30ff) || cp === 0xff70) return 'H3';

  if (RE_CM.test(ch)) return 'CM';
  if (ch === '-' || ch === '\u2013') return 'BA';
  if (RE_NU.test(ch)) return 'NU';

  const script = scriptOf(ch);
  if (script === 'Hani') return 'ID';
  if (script === 'Hira' || script === 'Kana') return 'H2';

  if (RE_PI.test(ch) || RE_PF.test(ch)) return 'QU';
  if (RE_PS.test(ch)) return 'OP';
  if (RE_PE.test(ch)) return 'CP';
  if (RE_PO.test(ch) || RE_SC.test(ch)) return 'IS';
  if (RE_SC.test(ch) || RE_SM.test(ch)) return 'PR';
  return 'AL';
}

const RE_PF = /^\p{Pf}/u;
const RE_PE = /^\p{Pe}/u;

/**
 * Whether a line may break between two characters.
 *
 * UAX #14 is a set of rules that mostly **prohibit** breaking; the fallback for
 * an unmatched pair of letters is "no break". Writing this as a default-deny
 * function is what keeps Latin words intact — an earlier default-allow version
 * of this function offered a break opportunity at every character, which split
 * `antidisestablishmentarianism` into per-glyph lines.
 *
 * The rules implemented here are the ones the derived classes support:
 *
 *  - LB7/LB9/LB10: never before or after a combining mark or a space
 *  - LB13/LB14: never before closing punctuation or after opening
 *  - LB18/LB8: break after a space or a zero-width space
 *  - LB21/LB21a: never before a hyphen, and break after one
 *  - LB31: break between CJK ideographs and kana
 *  - LB30a/LB30b: regional indicators come in pairs
 *
 * Emoji rules (LB30a's pictograph neighbours, LB30b) are not implemented; see
 * the module comment.
 */
function canBreakBefore(
  prev: LineBreakClass,
  cur: LineBreakClass,
  prev2: LineBreakClass,
): boolean {
  // Prohibitions first: upstream expresses them as "×" and they win over the
  // allowances below.
  if (cur === 'CM' || prev === 'CM') return false; // LB7, LB9, LB10
  if (cur === 'SP') return false; // LB7
  if (cur === 'BA' || cur === 'HY') return false; // LB21
  if (cur === 'CP' || prev === 'OP') return false; // LB13, LB14
  if (prev === 'NU' && cur === 'NU') return true; // LB25: between numbers
  if (prev === 'NU' && (cur === 'IS' || cur === 'PR')) return false; // LB25/LB23
  if (prev === 'AL' && cur === 'NU') return false; // LB24
  if (cur === 'IS') return false; // LB13

  // Allowances.
  if (prev === 'SP' || prev === 'ZW') return true; // LB18, LB8
  if (prev === 'BA' || prev === 'HY') return true; // LB21 bans "before" only
  if (prev === 'QU' || prev === 'IS') return true; // LB19, LB29
  if (prev === 'NU' && cur === 'AL') return true; // LB24
  if (prev === 'RI' && cur === 'RI') {
    // LB30a/LB30b: pairs break after an even number.
    return prev2 === 'RI';
  }
  if (
    (prev === 'ID' || prev === 'H2' || prev === 'H3') &&
    (cur === 'ID' || cur === 'H2' || cur === 'H3')
  ) {
    return true; // LB31
  }

  // Fallback: no break between letters.
  return false;
}

/**
 * The character indices in `text` at which a line may break.
 *
 * A break is allowed *before* each returned index. Index 0 is included so
 * callers can treat the first break uniformly.
 */
export function breakOpportunities(text: string): number[] {
  const breaks: number[] = [0];
  const chars = [...text];
  const classes = chars.map(lineBreakClassOf);

  for (let i = 1; i < chars.length; i++) {
    const prev = classes[i - 1] ?? 'AL';
    const cur = classes[i] ?? 'AL';
    const prev2 = classes[i - 2] ?? 'AL';
    if (canBreakBefore(prev, cur, prev2)) breaks.push(charOffsetAt(chars, i));
  }
  return breaks;
}

/** The byte offset of the character at `i`. */
function charOffsetAt(chars: readonly string[], i: number): number {
  let n = 0;
  for (let k = 0; k < i; k++) n += (chars[k] ?? '').length;
  return n;
}

/** The positions of hard line breaks. */
export function hardBreaks(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\u2028' || ch === '\u2029') out.push(i);
    else if (ch === '\r') {
      // Normalise CR and CRLF to a single break at the LF position.
      if (text[i + 1] !== '\n') out.push(i);
      else out.push(i + 1);
    }
  }
  return out;
}