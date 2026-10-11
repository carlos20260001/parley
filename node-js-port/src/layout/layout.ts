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
 *
 * A `Layout` also carries the paragraph's base bidi level, exposed as
 * [`is_rtl`](Layout::is_rtl) to mirror `parley::Layout::is_rtl`; it is what
 * decides which edge text aligns to.
 */

import type { Glyph } from './cluster.js';
import type { Line } from './line.js';

/** A laid-out paragraph. */
export class Layout {
  private readonly lineList: Line[] = [];
  private _width = 0;
  private _height = 0;
  private _maxCoordinate = 0;
  private _minCoordinate = 0;
  private _text: string;
  private _baseLevel = 0;

  constructor(text = '', baseLevel = 0) {
    this._text = text;
    this._baseLevel = baseLevel;
  }

  /** The text that was laid out. */
  get text(): string {
    return this._text;
  }

  /** The paragraph's base bidi level; odd means the paragraph is right-to-left. */
  get baseLevel(): number {
    return this._baseLevel;
  }

  /** Whether the paragraph's base direction is right-to-left. */
  is_rtl(): boolean {
    return this._baseLevel % 2 === 1;
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

  /** Every glyph in the layout, in line then visual order. */
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

  /** Sets the paragraph base bidi level after the fact. */
  setBaseLevel(level: number): void {
    this._baseLevel = level;
  }
}
