// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Font attributes, replacing `fontique::attributes`.
 *
 * Upstream `Attributes` is the triple matching compares: weight, width and
 * style. `is_oblique` and `DEFAULT_OBLIQUE_ANGLE` are here because the
 * matching algorithm in `matching.ts` selects oblique faces by angle, the way
 * CSS Fonts Level 4 describes.
 */

/** A font's weight, width and style — the attributes matching compares. */
export interface Attributes {
  readonly weight: number;
  readonly width: number;
  readonly style: FontStyleKind;
}

/** An italic or oblique style. */
export type FontStyleKind = 'normal' | 'italic' | 'oblique';

/** An oblique style with its angle, as upstream `FontStyle::Oblique(angle)`. */
export function isOblique(s: FontStyleKind): boolean {
  return s === 'oblique';
}

/** Upstream's default oblique angle, used when synthesizing. */
export const DEFAULT_OBLIQUE_ANGLE = 14.0;

/** OS/2 `usWidthClass` 1..=9 mapped onto fontique's normalized width ratio. */
export function widthClassToRatio(cls: number): number {
  const table = [0.5, 0.625, 0.75, 0.875, 1.0, 1.125, 1.25, 1.5, 2.0];
  const i = Math.min(8, Math.max(0, cls - 1));
  return table[i] ?? 1.0;
}
