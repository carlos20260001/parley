// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Font matching, replacing `fontique::matching`.
 *
 * The port of `fontique::matching::match_font`, rule for rule.
 *
 * Upstream's algorithm, in order:
 *
 *  1. **Width reduction.** If a face matches the requested width exactly, only
 *     faces at that width remain. Otherwise take the nearest width above, else
 *     the nearest below, else the first face's width.
 *  2. **Style selection.** If any face has the requested style, keep it.
 *     Otherwise search oblique faces by angle (CSS's weight analogues apply to
 *     angle: prefer the closest at or past the request, etc.), falling back to
 *     Normal, then Italic, then the first face's style.
 *  3. **Weight selection**, following CSS Fonts Level 4 rather than the obvious
 *     "closest weight": for a request of 400..=500, prefer the lightest face
 *     at or above the request up to 500, then the heaviest below, then the
 *     lightest above 500. Below 400 the order is heaviest-at-or-below then
 *     lightest-above; above 500 it mirrors that.
 *
 * Step 3 is the part a rewrite gets wrong. "Closest weight" is *not* what CSS
 * specifies, and it is visibly different: a request of 400 with faces at 300
 * and 500 picks 500 upstream (400..=500 range: lightest at-or-above), while
 * naive distance picks 300.
 *
 * Returns `undefined` when the set is empty. A single face returns index 0.
 */

import { DEFAULT_OBLIQUE_ANGLE, type FontStyleKind } from './attributes.js';
import type { FontInfo } from './font.js';

export function matchFont(
  set: readonly FontInfo[],
  width: number,
  style: FontStyleKind,
  weight: number,
  synthesizeStyle: boolean,
): number | undefined {
  if (set.length === 0) return undefined;
  if (set.length === 1) return 0;

  // Upstream compares integer percentages, so 0.875 and 87.5% agree.
  const widthPct = Math.round(width * 100);
  let useWidthPct = widthPct;
  const anyExactWidth = set.some((f) => Math.round(f.width * 100) === widthPct);
  if (!anyExactWidth) {
    const above = set
      .filter((f) => Math.round(f.width * 100) > widthPct)
      .reduce((best: number | undefined, f) => {
        const w = Math.round(f.width * 100);
        return best === undefined || w < best ? w : best;
      }, undefined);
    const below = set
      .filter((f) => Math.round(f.width * 100) < widthPct)
      .reduce((best: number | undefined, f) => {
        const w = Math.round(f.width * 100);
        return best === undefined || w > best ? w : best;
      }, undefined);
    useWidthPct = above ?? below ?? Math.round(set[0]!.width * 100);
  }

  let remaining = set.filter((f) => Math.round(f.width * 100) === useWidthPct);
  if (remaining.length === 0) remaining = [...set];

  // Style selection.
  const oblique = remaining
    .map((f, i) => ({ i, angle: obliqueAngle(f) }))
    .filter((x): x is { i: number; angle: number } => x.angle !== undefined);
  let useStyle: FontStyleKind = style;
  if (!remaining.some((f) => f.style === style)) {
    if (style === 'italic') {
      useStyle = closestOblique(remaining, oblique, undefined) ?? remaining[0]!.style;
    } else if (style === 'normal') {
      const any = remaining.find((f) => f.style === 'normal');
      const fallback = any
        ? 'normal'
        : remaining.some((f) => f.style === 'italic')
          ? 'italic'
          : (remaining[0]!.style as FontStyleKind);
      if (synthesizeStyle) {
        useStyle = remaining.some((f) => f.hasSlantAxis)
          ? style
          : (fallback as FontStyleKind);
      } else {
        useStyle = fallback;
      }
    } else {
      // Oblique requested: prefer the closest angle, as CSS describes.
      useStyle = closestOblique(remaining, oblique, 0) ?? remaining[0]!.style;
    }
  }

  remaining = remaining.filter((f) => f.style === useStyle);
  if (remaining.length === 0) return undefined;

  // Weight selection, per CSS Fonts Level 4.
  const exact = remaining.find((f) => f.weight === weight);
  if (exact) return set.indexOf(exact);

  if (weight >= 400 && weight <= 500) {
    const atOrAbove = remaining
      .filter((f) => f.weight >= weight && f.weight <= 500)
      .reduce(minByWeight, undefined);
    if (atOrAbove) return set.indexOf(atOrAbove);
    const below = remaining
      .filter((f) => f.weight < weight)
      .reduce(maxByWeight, undefined);
    if (below) return set.indexOf(below);
    const over500 = remaining.filter((f) => f.weight > 500).reduce(minByWeight, undefined);
    if (over500) return set.indexOf(over500);
    return undefined;
  }

  if (weight < 400) {
    const atOrBelow = remaining.filter((f) => f.weight <= weight).reduce(maxByWeight, undefined);
    if (atOrBelow) return set.indexOf(atOrBelow);
    const above = remaining.filter((f) => f.weight > weight).reduce(minByWeight, undefined);
    if (above) return set.indexOf(above);
    return undefined;
  }

  // weight > 500
  const above = remaining.filter((f) => f.weight >= weight).reduce(minByWeight, undefined);
  if (above) return set.indexOf(above);
  const below = remaining.filter((f) => f.weight < weight).reduce(maxByWeight, undefined);
  if (below) return set.indexOf(below);
  return undefined;
}

/** The oblique angle of a face, or undefined when it is not oblique. */
function obliqueAngle(f: FontInfo): number | undefined {
  return f.style === 'oblique' ? DEFAULT_OBLIQUE_ANGLE : undefined;
}

/** The face with the smallest weight, or undefined. */
function minByWeight(best: FontInfo | undefined, f: FontInfo): FontInfo {
  return best === undefined || f.weight < best.weight ? f : best;
}

/** The face with the largest weight, or undefined. */
function maxByWeight(best: FontInfo | undefined, f: FontInfo): FontInfo {
  return best === undefined || f.weight > best.weight ? f : best;
}

/**
 * The oblique face whose angle is closest to the request, in CSS's order:
 * the smallest at-or-above, else the largest below.
 */
function closestOblique(
  remaining: readonly FontInfo[],
  oblique: ReadonlyArray<{ i: number; angle: number }>,
  target: number | undefined,
): FontStyleKind | undefined {
  void remaining;
  if (oblique.length === 0) return undefined;
  if (target === undefined) {
    const any = oblique[0]!.i;
    return remaining[any]?.style;
  }
  const atOrAbove = oblique
    .filter((o) => o.angle >= target)
    .reduce((b: number | undefined, o) => (b === undefined || o.angle < b ? o.angle : b), undefined);
  if (atOrAbove !== undefined) {
    const found = oblique.find((o) => o.angle === atOrAbove)!;
    return remaining[found.i]?.style;
  }
  const below = oblique
    .filter((o) => o.angle < target)
    .reduce((b: number | undefined, o) => (b === undefined || o.angle > b ? o.angle : b), undefined);
  if (below === undefined) return undefined;
  const found = oblique.find((o) => o.angle === below)!;
  return remaining[found.i]?.style;
}

/** Every index tied with the winner, as upstream's `match_fonts` returns. */
export function matchFonts(
  set: readonly FontInfo[],
  width: number,
  style: FontStyleKind,
  weight: number,
  synthesizeStyle: boolean,
): number[] {
  if (set.length === 0) return [];
  const first = matchFont(set, width, style, weight, synthesizeStyle);
  if (first === undefined) return [];
  const best = set[first]!;
  const out: number[] = [];
  for (let i = 0; i < set.length; i++) {
    const f = set[i]!;
    if (f.weight === best.weight && f.style === best.style && f.width === best.width) out.push(i);
  }
  return out;
}
