/**
 * Text analysis for bidi, replacing the bidi half of
 * `parley_engine/src/analysis.rs` + `analyzer.rs`.
 *
 * Given a paragraph's text and base direction this produces one embedding
 * level per character plus the paragraph level, by classifying each character
 * and handing the classes to [`BidiResolver`]. Script detection itself lives in
 * `/unicode.ts` and is reused here.
 *
 * ## The `Bidi_Class` data source
 *
 * Upstream reads `Bidi_Class`, `Bidi_Paired_Bracket_Type` and
 * `Bidi_Mirroring_Glyph` from ICU. JavaScript exposes none of them: `\p{Bidi}`
 * of any form is a syntax error, and only `Bidi_Control`, `Bidi_Mirrored`,
 * `General_Category` and `Script` are available. So the classes are derived
 * here, in the same spirit as `layout/line_break.ts` derives `Line_Break`
 * classes:
 *
 *  - the twelve explicit directional codes and the two marks are matched by
 *    exact codepoint (they are a fixed, tiny set);
 *  - separators come from the C0/C1 control table (`B`, `S`, else `BN`);
 *  - nonspacing marks are `Mn`; format characters are `BN`;
 *  - digits: ASCII and fullwidth are `EN`; Arabic-Indic and Extended
 *    Arabic-Indic are `AN`;
 *  - number terminators are currency (`Sc`) plus `#` and `%`;
 *  - `+`/`-` are `ES`; `,` `.` `:` `/` are `CS`;
 *  - Hebrew letters are `R`; Arabic, Syriac and Thaana letters are `AL`;
 *  - everything else falls back to `L` for letters and `ON` otherwise.
 *
 * This is exact for Latin, Hebrew, Arabic/Syriac/Thaana, the ASCII/Latin
 * digit forms and the explicit controls — the shapes bidi's W/N/I rules are
 * most sensitive to. It is approximate for the long tail: Indic-script digits
 * are reported `EN` rather than `L`, `Mn`-plus exceptions to `NSM` are not
 * modelled, and the `AN`/`ON` distinctions within Arabic punctuation are
 * simplified. Those affect rare scripts the port does not target.
 */

import { scriptOf } from '../unicode.js';
import {
  BidiResolver,
  needs_bidi_resolution,
  type BaseDirection,
  type BidiChar,
  type BidiClass,
  type PairedBracket,
} from './bidi.js';
/** The twelve explicit directional codes, plus LRM/RLM/ALM, by codepoint. */
const EXPLICIT_CONTROL = new Map<number, BidiClass>([
  [0x061c, 'R'],  // ALM, Arabic Letter Mark — behaves as R here
  [0x200e, 'L'],  // LRM
  [0x200f, 'R'],  // RLM
  [0x202a, 'LRE'],
  [0x202b, 'RLE'],
  [0x202c, 'PDF'],
  [0x202d, 'LRO'],
  [0x202e, 'RLO'],
  [0x2066, 'LRI'],
  [0x2067, 'RLI'],
  [0x2068, 'FSI'],
  [0x2069, 'PDI'],
]);

/** C0/C1 controls that are paragraph separators (`B`). */
const PARA_SEP = new Set([0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85]);
/** C0/C1 controls that are segment separators (`S`). */
const SEG_SEP = new Set([0x09, 0x1f]);

const RE_MN = /^\p{Mn}$/u;
const RE_SC = /^\p{Sc}$/u;
const RE_LETTER = /^\p{L}$/u;
const RE_ND = /^\p{Nd}$/u;
const RE_CF = /^\p{Cf}$/u;

/** Arabic-block punctuation whose class differs from the surrounding `AL`. */
const ARABIC_PUNCT = new Map<number, BidiClass>([
  [0x060c, 'CS'], // ARABIC COMMA
  [0x061f, 'ON'], // ARABIC QUESTION MARK
  [0x06d4, 'ON'], // ARABIC FULL STOP
]);
/** Hebrew marks/punctuation that are neutral rather than `R`. */
const HEBREW_ON = new Set<number>([0x05f3, 0x05f4]); // geresh, gershayim

/**
 * The derived `Bidi_Class` of a single UTF-16 code unit.
 *
 * See the module header for the derivation and its honest limits.
 */
export function bidiClassOf(unit: string): BidiClass {
  const cp = unit.codePointAt(0) ?? 0;

  const explicit = EXPLICIT_CONTROL.get(cp);
  if (explicit !== undefined) return explicit;

  // C0/C1 controls and DEL.
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
    if (PARA_SEP.has(cp)) return 'B';
    if (SEG_SEP.has(cp)) return 'S';
    return 'BN';
  }

  // Nonspacing marks and format characters.
  if (RE_MN.test(unit)) return 'NSM';
  const cat = gcGroup(unit);
  if (cat === 'Cf') return 'BN';

  // Numbers.
  if (cp >= 0x30 && cp <= 0x39) return 'EN'; // ASCII
  if ((cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9)) return 'AN'; // Arabic-Indic
  if (RE_ND.test(unit)) return 'EN'; // other Nd (approximation — see header)

  // European number terminators / separators / common separators.
  if (RE_SC.test(unit)) return 'ET'; // currency ($ € £ …)
  if (cp === 0x23 || cp === 0x25) return 'ET'; // # %
  if (cp === 0x2b || cp === 0x2d) return 'ES'; // + -
  if (cp === 0x2c || cp === 0x2e || cp === 0x3a || cp === 0x2f) return 'CS'; // , . : /

  // Strong right-to-left scripts.
  const arabicExtra = ARABIC_PUNCT.get(cp);
  const script = scriptOf(unit);
  if (script === 'Hebr') return HEBREW_ON.has(cp) ? 'ON' : 'R';
  if (script === 'Arab' || script === 'Syrc' || script === 'Thaa') return arabicExtra ?? 'AL';

  // Whitespace.
  if (isWhitespaceChar(cp)) return 'WS';

  // Defaults: letters are L, everything else neutral.
  return RE_LETTER.test(unit) ? 'L' : 'ON';
}

/** The Unicode `White_Space` codepoints (minus the C0 controls handled above). */
function isWhitespaceChar(cp: number): boolean {
  if (cp === 0x20) return true; // SPACE
  if (cp === 0x85) return true; // NEL (already classified B above; unreachable)
  if (cp >= 0x09 && cp <= 0x0d) return true; // handled above; unreachable
  if (cp === 0xa0) return true; // NO-BREAK SPACE (reported WS; CS upstream — see header)
  if (cp >= 0x2000 && cp <= 0x200a) return true; // en/em spaces
  return cp === 0x1680 || cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

/** A cheap `General_Category` group read, enough to spot `Cf`. */
function gcGroup(unit: string): string | undefined {
  if (RE_CF.test(unit)) return 'Cf';
  return undefined;
}

/**
 * Paired-bracket data for rule N0, derived from a small canonical table.
 *
 * `Bidi_Paired_Bracket_Type` and `Bidi_Mirroring_Glyph` are not exposed by
 * JavaScript, so the fixed set of reference brackets is embedded. The
 * `\u2329`/`\u3008` and `\u232A`/`\u3009` canonical equivalences are handled in
 * the resolver's bracket stack, as upstream does.
 */
const OPEN_TO_CLOSE = new Map<number, number>([
  [0x0028, 0x0029], // ( )
  [0x005b, 0x005d], // [ ]
  [0x007b, 0x007d], // { }
  [0x0f3a, 0x0f3b], [0x0f3c, 0x0f3d],
  [0x169b, 0x169c],
  [0x2018, 0x2019], // ' '
  [0x201c, 0x201d], // " "
  [0x207d, 0x207e], // ⁽ ⁾
  [0x208d, 0x208e], // ₍ ₎
  [0x2329, 0x232a], // 〈 〉
  [0x2768, 0x2769], [0x276a, 0x276b], [0x276c, 0x276d], [0x276e, 0x276f],
  [0x2770, 0x2771], [0x2772, 0x2773], [0x2774, 0x2775],
  [0x27ec, 0x27ed], [0x27ee, 0x27ef],
  [0x2987, 0x2988], [0x2989, 0x298a], [0x298b, 0x298c], [0x298d, 0x2990], [0x298f, 0x298e],
  [0x29d8, 0x29d9], [0x29da, 0x29db],
  [0x2e56, 0x2e57], [0x2e58, 0x2e59], [0x2e5a, 0x2e5b],
  [0x3008, 0x3009], // 〈 〉
  [0x300a, 0x300b], [0x300c, 0x300d], [0x300e, 0x300f],
  [0x3010, 0x3011], [0x3014, 0x3015], [0x3016, 0x3017], [0x3018, 0x3019], [0x301a, 0x301b],
  [0xff08, 0xff09], [0xff3b, 0xff3d], [0xff5b, 0xff5d],
]);
const CLOSE_TO_OPEN = new Map<number, number>();
for (const [o, c] of OPEN_TO_CLOSE) CLOSE_TO_OPEN.set(c, o);

/** The paired-bracket data of a single character. */
export function pairedBracketOf(unit: string): PairedBracket {
  const cp = unit.codePointAt(0) ?? 0;
  const close = OPEN_TO_CLOSE.get(cp);
  if (close !== undefined) return { paired: 'open', mirror: String.fromCodePoint(close) };
  const open = CLOSE_TO_OPEN.get(cp);
  if (open !== undefined) return { paired: 'close', mirror: String.fromCodePoint(open) };
  return { paired: 'none', mirror: undefined };
}

/** The result of analysing one paragraph for bidi. */
export interface ParagraphAnalysis {
  /** One embedding level per character (UTF-16 code unit). */
  levels: number[];
  /** The paragraph's base level. */
  paragraphLevel: number;
}

/** Reusable analyzer scratch, mirroring `parley_engine::Analyzer`. */
export class Analyzer {
  private readonly resolver = new BidiResolver();

  /**
   * Analyses `text` for bidi, returning per-character levels and the base
   * level. Equivalent to `Analyzer::analyze` for the bidi stage.
   *
   * As upstream, the resolver is only run when there is something to resolve:
   * a bidi-relevant class somewhere in the text, or an explicit RTL base. An
   * all-LTR paragraph with a neutral base direction therefore yields an
   * *empty* level array rather than an array of zeros, which is also what
   * `itemize` reads as "every character is at the paragraph level".
   */
  analyze(text: string, baseDirection: BaseDirection): ParagraphAnalysis {
    let needsBidi = false;
    const chars: BidiChar[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const bidiClass = bidiClassOf(ch);
      if (needs_bidi_resolution(bidiClass)) needsBidi = true;
      chars.push({ ch, bidiClass, bracket: pairedBracketOf(ch) });
    }
    if (!needsBidi && baseDirection !== 'rtl') {
      return {
        levels: [],
        paragraphLevel:
          baseDirection === 'ltr'
            ? 0
            : BidiResolver.default_level(chars.map((c) => c.bidiClass)),
      };
    }
    this.resolver.resolve(chars, baseDirection);
    return { levels: this.resolver.resolved_levels(), paragraphLevel: this.resolver.base_level() };
  }
}
