/**
 * Line types, replacing `parley::layout::Line`.
 *
 * A `Line` is one row of positioned glyphs plus the metrics the renderer needs.
 * The port stores one flat glyph array per line, in **visual** order, which is
 * what a renderer wants and avoids an extra indirection — cluster boundaries
 * live on the glyphs via their `cluster` field.
 */

import type { Glyph } from './cluster.js';
import { buildClusters, type Cluster } from './cluster.js';

/** The reason a line ended, for the caller's diagnostics. */
export enum LineEndKind {
  /** A hard break in the text. */
  HardBreak = 'hardBreak',
  /** The line was filled to the requested width. */
  Width = 'width',
  /** The last line. */
  End = 'end',
}

/** A line of laid-out text. */
export interface Line {
  /** Glyphs in visual (left-to-right) order, positioned relative to the line origin. */
  readonly glyphs: Glyph[];
  /** Clusters in visual order. */
  readonly clusters: Cluster[];
  /** Distance from the line box's top to the text run's ascent. */
  readonly baseline: number;
  /** Total line height in pixels. */
  readonly height: number;
  /** Advance width of the text, ignoring trailing spaces. */
  readonly width: number;
  /** Advance width including trailing spaces. */
  readonly trailingWidth: number;
  /** Where the line ended, and why. */
  readonly kind: LineEndKind;
}

/** The overall text box. */
export interface LineMetrics {
  readonly minCoordinate: number;
  readonly maxCoordinate: number;
}

/**
 * Builds a `Line` from positioned glyphs, deriving its metrics.
 *
 * `glyphs` are expected in visual order already — the layout pipeline reorders
 * runs (UAX #9 L1) and clusters within RTL runs (L2) before calling this.
 */
export function makeLine(
  glyphs: Glyph[],
  baseline: number,
  height: number,
  kind: LineEndKind,
): Line {
  const clusters = buildClusters(glyphs);
  const trailing = clusters.reduce((n, c) => (c.isWhitespace ? n + c.advance : n), 0);
  let width = glyphs.reduce((n, g) => n + g.advance, 0);
  // Trailing whitespace never contributes to a line's measured width.
  width -= trailing;
  return { glyphs, clusters, baseline, height, width, trailingWidth: width + trailing, kind };
}
