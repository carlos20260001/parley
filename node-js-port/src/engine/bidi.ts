// Copyright the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Unicode bidirectional algorithm (UAX #9) — the port of
 * `parley_engine/src/bidi.rs`.
 *
 * This resolves a paragraph's characters into per-character *embedding
 * levels*, which is what turns logical order into visual order. It runs
 * between itemization and shaping: a run's level decides both the direction
 * HarfBuzz shapes it in and how runs are reordered on a line (L1) and how
 * clusters reverse inside an RTL run (L2). The pairing of L1/L2 with the level
 * data is wired up in `context.ts`.
 *
 * The resolver itself is transcribed from upstream. What the port has to
 * supply itself is the *data* upstream gets from ICU — the `Bidi_Class` of each
 * character, and the paired-bracket / mirroring data for rule N0. JavaScript
 * exposes none of these three properties, so they are derived in `analysis.ts`
 * (which this module consumes); that derivation is exact for the scripts and
 * controls that matter and approximate for the long tail of codepoints.
 */

/** The paragraph base direction. Upstream `parlance::BaseDirection`. */
export type BaseDirection = 'auto' | 'ltr' | 'rtl';

/**
 * A bidi class: the subset of `icu_properties::props::BidiClass` that UAX #9
 * names. Each maps to one bit via [`BidiClass`]'s `mask`, mirroring upstream.
 */
export type BidiClass =
  | 'L' | 'R' | 'EN' | 'ES' | 'ET' | 'AN' | 'CS' | 'B' | 'S' | 'WS' | 'ON'
  | 'LRE' | 'LRO' | 'AL' | 'RLE' | 'RLO' | 'PDF' | 'NSM' | 'BN'
  | 'FSI' | 'LRI' | 'RLI' | 'PDI';

/** The paired-bracket type of a character, for rule N0. */
export interface PairedBracket {
  readonly paired: 'none' | 'open' | 'close';
  /** The mirroring (opposite) bracket, for an open/close bracket. */
  readonly mirror: string | undefined;
}

/** A character with no paired-bracket role. */
export const NO_BRACKET: PairedBracket = { paired: 'none', mirror: undefined };

/** One analysed character handed to the resolver: its class and bracket. */
export interface BidiChar {
  readonly ch: string;
  readonly bidiClass: BidiClass;
  readonly bracket: PairedBracket;
}

/** The maximum embedding level, per UAX #9 BD2 (and `BidiLevel::MAX`). */
export const MAX_LEVEL = 125;

/** The bit index of each class, matching upstream's `mask`. */
const CLASS_BIT: Record<BidiClass, number> = {
  L: 0, R: 1, EN: 2, ES: 3, ET: 4, AN: 5, CS: 6, B: 7, S: 8, WS: 9, ON: 10,
  LRE: 11, LRO: 12, AL: 13, RLE: 14, RLO: 15, PDF: 16, NSM: 17, BN: 18,
  FSI: 19, LRI: 20, RLI: 21, PDI: 22,
};

/** Turns a bidi class into a single bit, for cheap set membership testing. */
function mask(t: BidiClass): number {
  return 1 << (CLASS_BIT[t] ?? 31);
}
const bit = (c: BidiClass): number => 1 << CLASS_BIT[c];

const OVERRIDE_MASK = bit('RLE') | bit('LRE') | bit('RLO') | bit('LRO');
const ISOLATE_MASK = bit('RLI') | bit('LRI') | bit('FSI');
const EXPLICIT_MASK = OVERRIDE_MASK | ISOLATE_MASK;
const RTL_MASK = bit('RLE') | bit('RLO') | bit('RLI');
const REMOVED_BY_X9_MASK = OVERRIDE_MASK | bit('PDF') | bit('BN');
const BIDI_MASK = EXPLICIT_MASK | bit('R') | bit('AL') | bit('AN');

/** Whether a class is an isolate initiator (LRI/RLI/FSI). */
function is_isolate_initiator(ty: BidiClass): boolean {
  return (mask(ty) & ISOLATE_MASK) !== 0;
}

/** Whether a class is removed by rule X9 (overrides, PDF, BN). */
export function is_removed_by_x9(ty: BidiClass): boolean {
  return (mask(ty) & REMOVED_BY_X9_MASK) !== 0;
}

/** Whether the character needs bidirectional resolution at all. */
export function needs_bidi_resolution(t: BidiClass): boolean {
  return (mask(t) & BIDI_MASK) !== 0;
}

/** Returns the default bidi type implied by a level: L if even, R if odd. */
export function type_from_level(level: number): BidiClass {
  return level % 2 === 0 ? 'L' : 'R';
}

const next_odd = (l: number): number => (l + 1) | 1;
const next_even = (l: number): number => (l + 2) & 0xfe; // & ~1 within a byte

/** A run of characters at a single level, as built by [`resolve_runs`]. */
interface Run {
  level: number;
  ends_with_isolate: boolean;
  starts_with_pdi: boolean;
  sos: BidiClass;
  eos: BidiClass;
  start: number;
  end: number;
  in_sequence: boolean;
  next: number | undefined;
}

/**
 * Resolver for the Unicode bidirectional algorithm.
 *
 * Port of `parley_engine::bidi::BidiResolver`. Reused across paragraphs via
 * [`clear`]; the working arrays are trimmed and refilled rather than
 * reallocated, matching upstream's reuse.
 */
export class BidiResolver {
  private baseLevel = 0;
  private levels: number[] = [];
  private initialTypes: BidiClass[] = [];
  private types: BidiClass[] = [];
  private brackets: Array<[number, string, PairedBracket]> = [];
  private bracketPairs: Array<[number, number]> = [];
  private runs: Run[] = [];
  private indices: number[] = [];
  private flags = 0;

  /** The base level of the resolved paragraph. */
  base_level(): number {
    return this.baseLevel;
  }

  /** The per-character embedding levels, parallel to the resolved characters. */
  resolved_levels(): number[] {
    return this.levels;
  }

  /** Clears the resolver state. */
  clear(): void {
    this.initialTypes = [];
    this.levels = [];
    this.types = [];
    this.brackets = [];
    this.bracketPairs = [];
    this.flags = 0;
    this.baseLevel = 0;
  }

  /**
   * Resolves a paragraph with the specified base direction and precomputed
   * per-character classes and bracket data.
   */
  resolve(chars: readonly BidiChar[], baseDirection: BaseDirection): void {
    this.clear();
    let needsBidi = false;
    const len = chars.length;
    for (let i = 0; i < len; i++) {
      const c = chars[i]!;
      this.initialTypes.push(c.bidiClass);
      if (c.bracket.paired !== 'none') this.brackets.push([i, c.ch, c.bracket]);
      needsBidi = needsBidi || (mask(c.bidiClass) & BIDI_MASK) !== 0;
    }

    this.baseLevel =
      baseDirection === 'rtl' ? 1 : baseDirection === 'ltr' ? 0 : BidiResolver.default_level(this.initialTypes);

    if (!needsBidi && this.baseLevel === 0) {
      this.flags |= 1;
      this.levels = new Array(len).fill(0);
      return;
    }

    this.types = this.initialTypes.slice();
    this.resolve_levels();
    this.resolve_runs();
    for (let i = 0; i < this.runs.length; i++) {
      if (this.runs[i]!.in_sequence) continue;
      this.types.length = len; // truncate to the character count
      this.indices = [];
      let cur: number | undefined = i;
      const run = this.runs[i]!;
      const level = run.level;
      const sos = run.sos;
      let eos: BidiClass = run.eos;
      while (cur !== undefined) {
        const r: Run = this.runs[cur]!;
        for (let j = r.start; j < r.end; j++) {
          const ty = this.types[j]!;
          if (!is_removed_by_x9(ty)) {
            this.types.push(ty);
            this.indices.push(j);
          }
        }
        eos = r.eos;
        cur = r.next;
      }
      this.resolve_sequence(level, sos, eos, this.indices.length);
    }

    for (let i = 0; i < len; i++) {
      const t = this.initialTypes[i]!;
      if (t === 'S' || t === 'B') {
        this.levels[i] = this.baseLevel;
        for (let j = i - 1; j >= 0; j--) {
          const tj = this.initialTypes[j]!;
          if (is_removed_by_x9(tj)) continue;
          else if (tj === 'WS' || is_isolate_initiator(tj) || tj === 'PDI') this.levels[j] = this.baseLevel;
          else break;
        }
      } else if (is_removed_by_x9(t)) {
        this.levels[i] = i === 0 ? this.baseLevel : this.levels[i - 1]!;
      }
    }
  }

  /** The first-strong base level for `BaseDirection::Auto`. */
  static default_level(types: readonly BidiClass[]): number {
    let isolates = 0;
    for (const ty of types) {
      if (ty === 'RLI' || ty === 'LRI' || ty === 'FSI') isolates += 1;
      else if (ty === 'PDI' && isolates > 0) isolates -= 1;
      else if ((ty === 'L' || ty === 'R' || ty === 'AL') && isolates === 0) return ty === 'L' ? 0 : 1;
    }
    return 0;
  }

  /** The first-strong level up to the matching PDI, for FSI. */
  static default_level_until_pdi(types: readonly BidiClass[]): number {
    let isolates = 0;
    for (const ty of types) {
      if (ty === 'RLI' || ty === 'LRI' || ty === 'FSI') isolates += 1;
      else if (ty === 'PDI') {
        if (isolates > 0) isolates -= 1;
        else return 0;
      } else if ((ty === 'L' || ty === 'R' || ty === 'AL') && isolates === 0) return ty === 'L' ? 0 : 1;
    }
    return 0;
  }

  /** Rules X1–X8: explicit levels and overrides from the directional codes. */
  private resolve_levels(): void {
    const base = this.baseLevel;
    const len = this.types.length;
    this.levels = new Array(len).fill(0);
    const stack = new Stack();
    let overflow_isolates = 0;
    let overflow_embedding = 0;
    let valid_isolates = 0;
    stack.push(base, 'ON', false);
    for (let i = 0; i < len; i++) {
      const t = this.types[i]!;
      const tmask = mask(t);
      if ((tmask & EXPLICIT_MASK) !== 0) {
        const is_isolate = (tmask & ISOLATE_MASK) !== 0;
        const is_rtl =
          t === 'FSI' && i + 1 < len
            ? BidiResolver.default_level_until_pdi(this.types.slice(i + 1)) === 1
            : (tmask & RTL_MASK) !== 0;
        if (is_isolate) {
          this.levels[i] = stack.embedding_level();
          if (stack.override_status() !== 'ON') this.types[i] = stack.override_status();
        }
        const new_level = is_rtl ? next_odd(stack.embedding_level()) : next_even(stack.embedding_level());
        if (new_level <= MAX_LEVEL && overflow_isolates === 0 && overflow_embedding === 0) {
          if (is_isolate) valid_isolates += 1;
          stack.push(new_level, t === 'LRO' ? 'L' : t === 'RLO' ? 'R' : 'ON', is_isolate);
        } else if (is_isolate) overflow_isolates += 1;
        else if (overflow_isolates === 0) overflow_embedding += 1;
      } else if (t === 'PDI') {
        if (overflow_isolates > 0) overflow_isolates -= 1;
        else if (valid_isolates === 0) {
          /* empty */
        } else {
          overflow_embedding = 0;
          while (!stack.isolate_status()) stack.pop();
          stack.pop();
          valid_isolates -= 1;
        }
        this.levels[i] = stack.embedding_level();
        if (stack.override_status() !== 'ON') this.types[i] = stack.override_status();
      } else if (t === 'PDF') {
        this.levels[i] = stack.embedding_level();
        if (overflow_isolates > 0) {
          /* empty */
        } else if (overflow_embedding > 0) overflow_embedding -= 1;
        else if (!stack.isolate_status() && stack.depth >= 2) stack.pop();
      } else if (t === 'B') {
        stack.depth = 1;
        overflow_isolates = 0;
        overflow_embedding = 0;
        valid_isolates = 0;
        this.levels[i] = base;
      } else if (t !== 'BN') {
        this.levels[i] = stack.embedding_level();
        if (stack.override_status() !== 'ON') this.types[i] = stack.override_status();
      }
    }
  }

  /** Groups characters into level runs and wires isolate sequences together. */
  private resolve_runs(): void {
    const len = this.types.length;
    this.runs = [];
    let start = 0;
    while (start < len) {
      if (!is_removed_by_x9(this.types[start]!)) break;
      start += 1;
    }
    if (start === len) return;

    const new_run = (level: number, s: number, e: number): Run => ({
      level, ends_with_isolate: false, starts_with_pdi: false, sos: 'ON', eos: 'ON',
      start: s, end: e, in_sequence: false, next: undefined,
    });

    let level = this.levels[start]!;
    let offset = 0;
    for (let i = start + 1; i < len; i++) {
      if (is_removed_by_x9(this.types[i]!)) continue;
      if (this.levels[i] !== level) {
        this.runs.push(new_run(level, offset, i));
        offset = i;
        level = this.levels[i]!;
      }
    }
    if (offset < len) this.runs.push(new_run(level, offset, len));

    for (const run of this.runs) {
      while (run.start < run.end && is_removed_by_x9(this.types[run.start]!)) run.start += 1;
      while (run.end > run.start && is_removed_by_x9(this.types[run.end - 1]!)) run.end -= 1;
      if (run.start === run.end) continue;
      if (this.types[run.start] === 'PDI') run.starts_with_pdi = true;
      let prev_level = this.baseLevel;
      for (let i = run.start - 1; i >= 0; i--) {
        if (!is_removed_by_x9(this.types[i]!)) { prev_level = this.levels[i]!; break; }
      }
      run.sos = type_from_level(Math.max(prev_level, run.level));
      if (is_isolate_initiator(this.initialTypes[run.end - 1]!)) {
        run.ends_with_isolate = true;
        run.eos = type_from_level(Math.max(this.baseLevel, run.level));
      } else {
        let next_level = this.baseLevel;
        for (let i = run.end; i < len; i++) {
          if (!is_removed_by_x9(this.types[i]!)) { next_level = this.levels[i]!; break; }
        }
        run.eos = type_from_level(Math.max(next_level, run.level));
      }
    }

    for (let i = 0; i < this.runs.length; i++) {
      if (!this.runs[i]!.ends_with_isolate) continue;
      const lvl = this.runs[i]!.level;
      for (let j = i + 1; j < this.runs.length; j++) {
        if (this.runs[j]!.starts_with_pdi && this.runs[j]!.level === lvl) {
          this.runs[i]!.next = j;
          this.runs[j]!.in_sequence = true;
          break;
        }
      }
    }
  }

  /**
   * Rules W1–W7, N0–N2 and I1/I2 for one isolating run sequence.
   *
   * The sequence's working classes are the tail of `this.types` starting at
   * `base = initialTypes.length`; `this.indices[i]` maps sequence position `i`
   * back to its source character index.
   */
  private resolve_sequence(level: number, sos: BidiClass, eos: BidiClass, len: number): void {
    if (len === 0) return;
    const base = this.initialTypes.length;
    const at = (i: number): BidiClass => this.types[base + i]!;
    const set = (i: number, v: BidiClass): void => { this.types[base + i] = v; };

    const W1_MASK = bit('LRI') | bit('RLI') | bit('FSI') | bit('PDI');
    const W2_MASK = bit('L') | bit('R') | bit('AL');
    const W4_MASK = bit('ES') | bit('CS');

    let prev = sos;
    let prev_strong = sos;
    for (let i = 0; i < len; i++) {
      let t = at(i);
      const tmask = mask(t);
      if (t === 'NSM') {
        set(i, prev); // W1
      } else {
        if ((tmask & W1_MASK) !== 0) { prev = 'ON'; continue; }
        if (t === 'EN') {
          if (prev_strong === 'AL') { t = 'AN'; set(i, t); } // W2
        } else if ((tmask & W2_MASK) !== 0) {
          prev_strong = t;
          if (t === 'AL') { t = 'R'; set(i, t); } // W3
        } else if ((tmask & W4_MASK) !== 0 && i < len - 1) {
          let next = at(i + 1);
          if (next === 'EN' && prev_strong === 'AL') next = 'AN';
          if (prev === 'EN' && next === 'EN') { t = 'EN'; set(i, t); }
          else if (t === 'CS' && prev === 'AN' && next === 'AN') { t = 'AN'; set(i, t); }
        }
        prev = t;
      }
    }

    // W5
    let i = 0;
    while (i < len) {
      if (at(i) === 'ET') {
        const limit = this.seq_find(base, i, 'ET');
        let t = i === 0 ? sos : at(i - 1);
        if (t !== 'EN') t = limit === len ? eos : at(limit);
        if (t === 'EN') for (let j = i; j < limit; j++) set(j, 'EN');
        i = limit;
      }
      i += 1;
    }

    // W6, W7
    const W6_MASK = bit('ES') | bit('ET') | bit('CS');
    prev_strong = sos;
    for (i = 0; i < len; i++) {
      const t = at(i);
      if ((mask(t) & W6_MASK) !== 0) set(i, 'ON');
      else if (t === 'EN') { if (prev_strong === 'L') set(i, 'L'); }
      else if (t === 'L' || t === 'R') prev_strong = t;
    }

    // N0
    if (this.brackets.length > 0) {
      const base_brackets = this.bracketPairs.length;
      const stack = new BracketStack();
      for (i = 0; i < len; i++) {
        if (at(i) !== 'ON') continue;
        const index = this.indices[i]!;
        const found = this.brackets.findIndex((b) => b[0] === index);
        if (found < 0) continue;
        const char = this.brackets[found]![1];
        const bracket = this.brackets[found]![2];
        if (bracket.paired === 'open') {
          if (stack.depth === MAX_BRACKET_STACK) break;
          stack.push(i, bracket.mirror!);
        } else if (bracket.paired === 'close') {
          const open = stack.find_and_pop(char);
          if (open !== undefined) this.bracketPairs.push([open, i]);
        }
      }
      if (this.bracketPairs.length > base_brackets) {
        const embed_dir: BidiClass = level % 2 !== 0 ? 'R' : 'L';
        const tail = this.bracketPairs.slice(base_brackets);
        tail.sort((a, b) => a[0] - b[0]);
        for (const pair of tail) {
          let pair_dir: BidiClass = 'ON';
          for (let j = pair[0] + 1; j < pair[1]; j++) {
            const dir = bidi_dir(at(j));
            if (dir === 'ON') continue;
            pair_dir = dir;
            if (dir === embed_dir) break;
          }
          if (pair_dir === 'ON') {
            pair[0] = this.indices[pair[0]]!;
            pair[1] = this.indices[pair[1]]!;
            continue;
          }
          if (pair_dir !== embed_dir) {
            pair_dir = sos;
            for (let j = pair[0] - 1; j >= 0; j--) {
              const dir = bidi_dir(at(j));
              if (dir !== 'ON') { pair_dir = dir; break; }
            }
            if (pair_dir === embed_dir || pair_dir === 'ON') pair_dir = embed_dir;
          }
          set(pair[0], pair_dir);
          set(pair[1], pair_dir);
          for (let j = pair[0] + 1; j < pair[1]; j++) {
            if (this.initialTypes[this.indices[j]!]! === 'NSM') set(j, pair_dir);
            else break;
          }
          for (let j = pair[1] + 1; j < len; j++) {
            if (this.initialTypes[this.indices[j]!]! === 'NSM') set(j, pair_dir);
            else break;
          }
          pair[0] = this.indices[pair[0]]!;
          pair[1] = this.indices[pair[1]]!;
        }
      }
    }

    // N1, N2
    const N_MASK = bit('B') | bit('S') | bit('WS') | bit('ON') | bit('RLI') | bit('LRI') | bit('FSI') | bit('PDI');
    i = 0;
    while (i < len) {
      if ((mask(at(i)) & N_MASK) !== 0) {
        const offset = i;
        const limit = this.seq_find_mask(base, offset, N_MASK);
        let leading: BidiClass;
        if (offset === 0) leading = sos;
        else {
          leading = at(offset - 1);
          if (leading === 'AN' || leading === 'EN') leading = 'R';
        }
        let trailing: BidiClass;
        if (limit === len) trailing = eos;
        else {
          trailing = at(limit);
          if (trailing === 'AN' || trailing === 'EN') trailing = 'R';
        }
        const resolved: BidiClass = leading === trailing ? leading : level % 2 !== 0 ? 'R' : 'L';
        for (let j = offset; j < limit; j++) set(j, resolved);
        i = limit - 1;
      }
      i += 1;
    }

    // Implicit levels I1 / I2
    if (level % 2 === 0) {
      for (i = 0; i < len; i++) {
        const index = this.indices[i]!;
        const t = at(i);
        if (t === 'R') this.levels[index] = level + 1;
        else if (t !== 'L') this.levels[index] = level + 2;
        else this.levels[index] = level;
      }
    } else {
      for (i = 0; i < len; i++) {
        const index = this.indices[i]!;
        const t = at(i);
        if (t !== 'R') this.levels[index] = level + 1;
        else this.levels[index] = level;
      }
    }
  }

  private seq_find(base: number, offset: number, ty: BidiClass): number {
    let len = offset;
    while (base + len < this.types.length && this.types[base + len] === ty) len += 1;
    return len;
  }

  private seq_find_mask(base: number, offset: number, m: number): number {
    let len = offset;
    while (base + len < this.types.length && (mask(this.types[base + len]!) & m) !== 0) len += 1;
    return len;
  }
}

/** Maps a class to a direction for N0 bracket-pair resolution. */
function bidi_dir(t: BidiClass): BidiClass {
  if (t === 'EN' || t === 'AN' || t === 'AL' || t === 'R') return 'R';
  if (t === 'L') return 'L';
  return 'ON';
}

const MAX_BRACKET_STACK = 63;

/** The directional-status stack for X1–X8, matching `bidi.rs::Stack`. */
class Stack {
  embeddings = new Array<number>(MAX_LEVEL + 2).fill(0);
  overrides: BidiClass[] = new Array(MAX_LEVEL + 2).fill('ON');
  isolates = new Array<boolean>(MAX_LEVEL + 2).fill(false);
  depth = 0;

  push(level: number, override_status: BidiClass, isolate_status: boolean): void {
    this.embeddings[this.depth] = level;
    this.overrides[this.depth] = override_status;
    this.isolates[this.depth] = isolate_status;
    this.depth += 1;
  }
  pop(): void {
    if (this.depth > 1) this.depth -= 1;
  }
  embedding_level(): number {
    return this.embeddings[this.depth - 1]!;
  }
  override_status(): BidiClass {
    return this.overrides[this.depth - 1]!;
  }
  isolate_status(): boolean {
    return this.isolates[this.depth - 1]!;
  }
}

/** Matching stack of open brackets for rule N0. */
class BracketStack {
  private openers: Array<[number, string]> = [];
  depth = 0;

  push(offset: number, closer: string): void {
    this.openers[this.depth] = [offset, closer];
    this.depth += 1;
  }

  find_and_pop(closer: string): number | undefined {
    if (this.depth === 0) return undefined;
    for (let i = this.depth - 1; i >= 0; i--) {
      const c = this.openers[i]![1];
      if (c === closer || (c === '\u232A' && closer === '\u3009') || (c === '\u3009' && closer === '\u232A')) {
        this.depth = i;
        return this.openers[i]![0];
      }
    }
    return undefined;
  }
}
