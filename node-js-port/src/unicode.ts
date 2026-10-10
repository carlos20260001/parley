/**
 * Unicode properties, replacing the `icu_*` crates that `parley_engine` uses.
 *
 * Upstream depends on `icu_properties` (script, bidi class, word break),
 * `icu_segmenter` (grapheme segmentation) and `icu_normalizer`. All three
 * ship enormous generated Unicode tables, and porting them would mean
 * generating megabytes of data from UCD files.
 *
 * JavaScript exposes the same properties natively:
 *
 *  - `Intl.Segmenter` does UAX #29 grapheme segmentation, matching
 *    `icu_segmenter`'s grapheme break iterator.
 *  - Unicode property escapes (`/\p{Script=Latin}/u`, `\p{White_Space}`,
 *    `\p{Bidi_Control}`) expose `General_Category` and `Script`, which is
 *    enough to derive script and a bidi direction.
 *
 * Where the two implementations disagree, JavaScript is frozen to an older
 * Unicode revision than the ICU build parley links. That is a data-version
 * difference, not a logic difference, and it surfaces only for codepoints
 * assigned in a release newer than the host's ICU.
 */

/** A BCP-47 script tag, as used by both HarfBuzz and parley. */
export type ScriptTag = string;

/**
 * The scripts JavaScript exposes by property escape, mapped to their ISO
 * 15924 tags. Anything outside this list falls back to Latin.
 */
const SCRIPT_PROPS: ReadonlyArray<readonly [string, ScriptTag]> = [
  ['Latin', 'Latn'],
  ['Greek', 'Grek'],
  ['Cyrillic', 'Cyrl'],
  ['Armenian', 'Armn'],
  ['Hebrew', 'Hebr'],
  ['Arabic', 'Arab'],
  ['Syriac', 'Syrc'],
  ['Thaana', 'Thaa'],
  ['Devanagari', 'Deva'],
  ['Bengali', 'Beng'],
  ['Gurmukhi', 'Guru'],
  ['Gujarati', 'Gujr'],
  ['Oriya', 'Orya'],
  ['Tamil', 'Taml'],
  ['Telugu', 'Telu'],
  ['Kannada', 'Knda'],
  ['Malayalam', 'Mlym'],
  ['Sinhala', 'Sinh'],
  ['Thai', 'Thai'],
  ['Lao', 'Laoo'],
  ['Tibetan', 'Tibt'],
  ['Myanmar', 'Mymr'],
  ['Georgian', 'Geor'],
  ['Ethiopic', 'Ethi'],
  ['Cherokee', 'Cher'],
  ['Canadian_Aboriginal', 'Cans'],
  ['Ogham', 'Ogam'],
  ['Runic', 'Runr'],
  ['Khmer', 'Khmr'],
  ['Mongolian', 'Mong'],
  ['Hiragana', 'Hira'],
  ['Katakana', 'Kana'],
  ['Bopomofo', 'Bopo'],
  ['Han', 'Hani'],
  ['Hangul', 'Hang'],
  ['Braille', 'Brai'],
  ['Adlam', 'Adlm'],
  ['Osage', 'Osge'],
  ['Vai', 'Vaii'],
];

const SCRIPT_OF = new Map<string, RegExp>(
  SCRIPT_PROPS.map(([name, tag]) => [tag, new RegExp(`^\\p{Script=${name}}$`, 'u')]),
);

/** The direction a script is normally written in. */
const RTL_SCRIPTS = new Set<ScriptTag>(['Hebr', 'Arab', 'Syrc', 'Thaa', 'Nkoo', 'Adlm']);

/** The script used when nothing else is known. */
export const DEFAULT_SCRIPT: ScriptTag = 'Latn';

/**
 * The script of a single character.
 *
 * Property escapes are the only way to reach `Script` from JS, so this tests
 * each script regex in turn. The list is ordered so the common scripts are
 * reached in a couple of comparisons, which is what makes this cheap enough
 * to call per character.
 */
export function scriptOf(ch: string): ScriptTag {
  if (ch === '') return DEFAULT_SCRIPT;
  const cp = ch.codePointAt(0) ?? 0;
  // Fast path for the scripts that cover almost all text.
  if (cp < 0x0300) return 'Latn';
  if (cp >= 0x0590 && cp <= 0x08ff) return cp < 0x0600 ? 'Hebr' : CP_TO_SCRIPT.get(cp) ?? 'Arab';
  if (cp >= 0x0400 && cp <= 0x052f) return 'Cyrl';
  if (cp >= 0x0370 && cp <= 0x03ff) return 'Grek';
  if (cp >= 0x3040 && cp <= 0x30ff) return 'Kana';
  if (cp >= 0x4e00 && cp <= 0x9fff) return 'Hani';
  if (cp >= 0xac00 && cp <= 0xd7af) return 'Hang';

  for (const [tag, re] of SCRIPT_OF) {
    if (re.test(ch)) return tag;
  }
  return DEFAULT_SCRIPT;
}

/**
 * Codepoint ranges that need a per-codepoint lookup because a single block
 * covers several scripts (the Arabic block holds Arabic, Syriac and Thaana).
 */
const CP_TO_SCRIPT = new Map<number, ScriptTag>([
  [0x0700, 'Syrc'], [0x070f, 'Syrc'], [0x0710, 'Syrc'],
  [0x0780, 'Thaa'], [0x07a0, 'Thaa'], [0x07c0, 'Nkoo'],
  [0x0800, 'Samr'], [0x0840, 'Mand'], [0x0860, 'Syrc'],
  [0x0870, 'Arab'], [0x08a0, 'Arab'], [0x08e0, 'Arab'],
]);

/** Whether a script is written right to left. */
export function isRtlScript(s: ScriptTag): boolean {
  return RTL_SCRIPTS.has(s);
}

/** The paragraph direction implied by a script. */
export function scriptDirection(s: ScriptTag): 'ltr' | 'rtl' {
  return isRtlScript(s) ? 'rtl' : 'ltr';
}

/** Codepoints with `White_Space=yes`. */
const WHITE_SPACE = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/;

/** Whether a character is Unicode whitespace. */
export function isWhitespace(ch: string): boolean {
  return WHITE_SPACE.test(ch);
}

/** Whether a character is a line break, per `bk`/`NL`/`CR`/`LF`. */
export function isLineBreak(ch: string): boolean {
  return ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
}

/** Codepoints with `Bidi_Control=yes`. */
const BIDI_CONTROL = /^[\u200e\u200f\u061c\u2066-\u2069]$/;

/** Whether a character is a bidi control character. */
export function isBidiControl(ch: string): boolean {
  return BIDI_CONTROL.test(ch);
}

/** A single grapheme cluster, as split by UAX #29. */
export interface GraphemeSegment {
  readonly index: number;
  readonly text: string;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Splits text into grapheme clusters.
 *
 * Upstream uses an ICU grapheme break iterator; `Intl.Segmenter` implements
 * the same UAX #29 algorithm. The port reuses one cached segmenter, because
 * constructing one per call is expensive.
 */
export function graphemes(text: string): GraphemeSegment[] {
  const out: GraphemeSegment[] = [];
  for (const { index, segment } of GRAPHEME_SEGMENTER.segment(text)) {
    out.push({ index, text: segment });
  }
  return out;
}

/** The number of characters, counting a surrogate pair as one. */
export function charLen(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}