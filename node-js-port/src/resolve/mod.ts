/**
 * Style resolution, replacing `parley::resolve`.
 *
 * `RangedBuilder` accumulates a flat list of `(property, range)` spans. Before
 * layout, those are collapsed into one resolved style per character, which is
 * what itemization and shaping consume. Upstream keeps this in its own
 * `resolve` module (`ResolvedStyle`, the range/tree resolvers); the port keeps
 * the per-character resolution here and the builder-side range bookkeeping in
 * `context.ts`.
 */

import type { Brush, StyleProperty } from '../style/mod.js';

/**
 * A resolved style for one character.
 *
 * Upstream `ResolvedStyle` also carries font selection, metrics and decoration
 * resolved through the `FontContext`; the port keeps the subset its pipeline
 * needs and re-resolves the font at shaping time.
 */
export interface ResolvedStyle {
  familyIndex: number;
  size: number;
  weight: number;
  width: number;
  italic: boolean;
  color: Brush;
}

/** The style a character has when nothing overrides it. */
export const DEFAULT_STYLE: ResolvedStyle = {
  familyIndex: 0,
  size: 16,
  weight: 400,
  width: 1,
  italic: false,
  color: 0,
};

/** Applies one property to a resolved style, returning the new style. */
export function applyProperty(s: ResolvedStyle, p: StyleProperty): ResolvedStyle {
  switch (p.kind) {
    case 'FontSize': return { ...s, size: p.value };
    case 'FontWeight': return { ...s, weight: p.value.value };
    case 'FontWidth': return { ...s, width: p.value.value };
    case 'FontStyle': return { ...s, italic: p.value.kind !== 'normal' };
    case 'Brush': return { ...s, color: p.value };
    default: return s;
  }
}

/**
 * Resolves a style per character from a set of `(property, range)` spans.
 *
 * Later spans win, matching upstream's sequential application. A property with
 * no effect on the resolved shape (alignment, wrap mode, …) is a no-op here,
 * exactly as `applyProperty` ignores it.
 */
export function resolveStyles(
  text: string,
  ranges: ReadonlyArray<{ readonly property: StyleProperty; readonly start: number; readonly end: number }>,
): ResolvedStyle[] {
  const out: ResolvedStyle[] = new Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = { ...DEFAULT_STYLE };

  for (const r of ranges) {
    const from = Math.max(0, r.start);
    const to = Math.min(text.length, r.end);
    for (let i = from; i < to; i++) {
      const cur = out[i];
      if (!cur) continue;
      out[i] = applyProperty(cur, r.property);
    }
  }
  return out;
}
