/**
 * Itemization, replacing `parley_engine/src/itemize.rs`.
 *
 * Splits the text into individually-shapeable runs. The port's rule is a
 * boundary at any change of style, of script, or — new with bidi — of
 * embedding level, because HarfBuzz shapes one script in one direction per
 * call and a level change means a direction change. This is upstream's split
 * on "constant script and bidirectional embedding level", plus the style
 * predicate that `parley` layers on top.
 */

import type { Run } from '../layout/cluster.js';
import type { ResolvedStyle } from '../resolve/mod.js';
import { scriptDirection, scriptOf } from '../unicode.js';

/** Whether two resolved styles are equal for the purpose of run-splitting. */
function sameStyle(a: ResolvedStyle, b: ResolvedStyle): boolean {
  return (
    a.size === b.size &&
    a.color === b.color &&
    a.italic === b.italic &&
    a.weight === b.weight &&
    a.width === b.width &&
    a.familyIndex === b.familyIndex
  );
}

/**
 * Splits the text into runs at style, script and bidi-level boundaries.
 *
 * `levels[i]` is the embedding level of character `i` (even is LTR, odd is
 * RTL); a run's direction and level are taken from its characters, which are
 * constant across the run by construction.
 */
export function itemize(
  text: string,
  styles: ResolvedStyle[],
  levels: readonly number[],
): Run[] {
  const out: Run[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const style = styles[i] ?? { familyIndex: 0, size: 16, weight: 400, width: 1, italic: false, color: 0 };
    const script = scriptOf(text[i] ?? '');
    const level = levels[i] ?? 0;
    let j = i + 1;
    while (j < n) {
      const s = styles[j]!;
      if (!sameStyle(s, style)) break;
      if (scriptOf(text[j] ?? '') !== script) break;
      if ((levels[j] ?? 0) !== level) break;
      j += 1;
    }
    out.push({
      start: i,
      end: j,
      styleIndex: i,
      fontIndex: style.familyIndex,
      script,
      direction: level % 2 === 1 ? 'rtl' : scriptDirection(script),
      bidiLevel: level,
    });
    i = j;
  }
  return out;
}

/**
 * Reorders a line's runs into visual order (UAX #9 rule L1).
 *
 * This is the port of `reorder_line_items`: for each level from the highest
 * down to the lowest odd one, find maximal runs of items at that level or
 * higher and reverse them. Applied to the runs on a line, it turns logical run
 * order into left-to-right visual order. The within-run reversal (L2) is a
 * separate step done when glyphs are emitted, because HarfBuzz reverses glyphs
 * within a run when it is shaped right-to-left.
 */
export function reorderRunsByLevel<T extends { bidiLevel: number }>(items: T[]): T[] {
  const runs = items.slice();
  const count = runs.length;

  let maxLevel = 0;
  let lowestOdd = 255;
  for (const run of runs) {
    const level = run.bidiLevel;
    if (level > maxLevel) maxLevel = level;
    if (level % 2 === 1 && level < lowestOdd) lowestOdd = level;
  }

  for (let level = maxLevel; level >= lowestOdd; level--) {
    let i = 0;
    while (i < count) {
      if (runs[i]!.bidiLevel >= level) {
        let end = i + 1;
        while (end < count && runs[end]!.bidiLevel >= level) end += 1;
        runs.splice(i, end - i, ...runs.slice(i, end).reverse());
        i = end;
      }
      i += 1;
    }
  }
  return runs;
}
