/**
 * The layout result, replacing `parley::layout::Layout`.
 *
 * Upstream `Layout<B>` holds lines, each holding clusters and glyphs, plus
 * metrics for the whole paragraph. Callers walk `lines()` and then each
 * line's glyphs to render, which is also how the port is consumed.
 *
 * The port stores one flat glyph array per line, which is what a renderer needs
 * and avoids an extra indirection — the cluster boundaries live on the glyphs
 * via their `cluster` field, so `Cluster[]` can be derived rather than stored.
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
  /** Glyphs in reading order, positioned relative to the line origin. */
  readonly glyphs: Glyph[];
  /** Clusters in reading order. */
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

/** A laid-out paragraph. */
export class Layout {
  private readonly lineList: Line[] = [];
  private _width = 0;
  private _height = 0;
  private _maxCoordinate = 0;
  private _minCoordinate = 0;
  private _text: string;

  constructor(text = '') {
    this._text = text;
  }

  /** The text that was laid out. */
  get text(): string {
    return this._text;
  }

  /** The advance width of the widest line. */
  get width(): number {
    return this._width;
  }

  /** The total height of all lines. */
  get height(): number {
    return this._height;
  }

  /** Above-baseline extent of the tallest line. */
  get maxCoordinate(): number {
    return this._maxCoordinate;
  }

  /** Below-baseline extent of the deepest line. */
  get minCoordinate(): number {
    return this._minCoordinate;
  }

  get lines(): readonly Line[] {
    return this.lineList;
  }

  /** Every glyph in the layout, in line then reading order. */
  allGlyphs(): Glyph[] {
    const out: Glyph[] = [];
    for (const l of this.lineList) out.push(...l.glyphs);
    return out;
  }

  /**
   * Returns the line containing `index`, or the last line if past the end.
   *
   * Upstream finds a line by cluster index; the port walks the glyphs, which
   * is equivalent and avoids storing per-line index ranges.
   */
  lineForIndex(index: number): Line | undefined {
    for (const l of this.lineList) {
      if (l.glyphs.length === 0) continue;
      const first = l.glyphs[0]!.cluster;
      const last = l.glyphs[l.glyphs.length - 1]!.cluster;
      if (index >= first && index <= last + 1) return l;
    }
    return this.lineList[this.lineList.length - 1];
  }

  /** Advances the layout by one line. Called while building. */
  pushLine(line: Line): void {
    this.lineList.push(line);
    this._height += line.height;
    this._width = Math.max(this._width, line.width);
    this._maxCoordinate = Math.max(this._maxCoordinate, line.baseline);
    this._minCoordinate = Math.min(this._minCoordinate, line.baseline - (line.height - line.baseline));
  }

  /** Sets the laid-out text after the fact. */
  setText(text: string): void {
    this._text = text;
  }
}

/** Builds a `Line` from positioned glyphs, deriving its metrics. */
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