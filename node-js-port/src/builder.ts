// Copyright 2021 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * The builders, replacing `parley::RangedBuilder` (and the
 * `parley_engine` driver that sits underneath it).
 *
 * Upstream `builder.rs` holds `BuilderOptions`, `RangedBuilder`,
 * `StyleRunBuilder` and `TreeBuilder`. Only `RangedBuilder` is ported: it is
 * the one egui-shaped consumers use, and the other two need the style table
 * and style tree machinery of `parley::resolve`, which the port replaces with
 * per-character resolution.
 *
 * The call shape matches upstream, so porting call sites is mechanical:
 *
 * ```ts
 * const fontCtx = await FontContext.new();
 * const layoutCtx = new LayoutContext();
 * const b = layoutCtx.rangedBuilder(fontCtx);
 * b.pushDefault({ kind: 'FontFamily', value: FontFamily.sansSerif() });
 * b.push({ kind: 'FontSize', value: 24 }, 0, text.length);
 * const layout = b.build(fontCtx, text);
 * ```
 *
 * ## Pipeline
 *
 * `build` runs the same stages as `parley_engine` + `parley`:
 *
 *  1. **resolve** — each character inherits a style from the pushed ranges.
 *  2. **analyze** — classify each character and resolve bidi embedding levels
 *     (UAX #9), honouring the paragraph base direction.
 *  3. **itemize** — runs split at style, script and bidi-level boundaries.
 *  4. **shape** — each run goes through HarfBuzz in its bidi direction.
 *  5. **line break** — UAX #14 fills lines to the requested width, in logical
 *     order.
 *  6. **reorder** — per line, runs are put into visual order (L1) and clusters
 *     inside right-to-left runs are reversed (L2).
 *
 * Steps 2 and 6 are the UAX #9 stages; the resolution itself lives in
 * `engine/bidi.ts` and `engine/analysis.ts`.
 */

import type { FontContext, RegisteredFont } from './font.js';
import type { Glyph } from './layout/cluster.js';
import { Layout } from './layout/layout.js';
import { makeLine, LineEndKind, type Line } from './layout/line.js';
import { breakOpportunities, hardBreaks } from './layout/line_break.js';
import { DEFAULT_STYLE, resolveStyles, type ResolvedStyle } from './resolve/mod.js';
import { Alignment, type StyleProperty } from './style/mod.js';
import { Analyzer } from './engine/analysis.js';
import type { BaseDirection } from './engine/bidi.js';
import { itemize, reorderRunsByLevel } from './engine/itemize.js';
import type { Run } from './layout/cluster.js';

/** A glyph while it is being laid out: a `Glyph` plus the bidi bookkeeping. */
interface WorkGlyph extends Glyph {
  readonly bidiLevel: number;
  readonly runIndex: number;
}

/** A style plus the character range it applies to. */
interface StyleRange {
  readonly property: StyleProperty;
  readonly start: number;
  readonly end: number;
}

/** Accumulates style ranges and produces a `Layout`. */
export class RangedBuilder {
  private readonly ranges: StyleRange[] = [];
  private baseDirection: BaseDirection = 'auto';
  private readonly analyzer = new Analyzer();

  constructor(
    private readonly fontCtx: FontContext,
    private readonly scale: number,
  ) {}

  /** Sets the paragraph's base direction. Default is `'auto'` (first-strong). */
  set_base_direction(baseDirection: BaseDirection): this {
    this.baseDirection = baseDirection;
    return this;
  }

  /** Sets the default style for the whole text. */
  pushDefault(property: StyleProperty): this {
    return this.push(property, 0, Number.MAX_SAFE_INTEGER);
  }

  /** Applies a style property to `[start, end)`. */
  push(property: StyleProperty, start: number, end = Number.MAX_SAFE_INTEGER): this {
    this.ranges.push({
      property,
      start,
      end: end === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : end,
    });
    return this;
  }

  /** Lays out `text` into a `Layout`. `width` is the wrap width in pixels. */
  build(text: string, width = Number.POSITIVE_INFINITY, alignment = Alignment.Start): Layout {
    const analysis = this.analyzer.analyze(text, this.baseDirection);
    const layout = new Layout(text, analysis.paragraphLevel);
    void alignment;

    if (text.length === 0) {
      layout.pushLine(
        makeLine([], DEFAULT_STYLE.size * 1.2, DEFAULT_STYLE.size * 1.2, LineEndKind.End),
      );
      return layout;
    }

    const styles = this.resolve(text);
    const levels = analysis.levels;
    const runs = this.itemize(text, styles, levels);
    const lines = this.breakLines(runs, styles, text, width);
    for (const l of lines) layout.pushLine(l);
    return layout;
  }

  /** Resolves a style per character. */
  private resolve(text: string): ResolvedStyle[] {
    return resolveStyles(text, this.ranges);
  }

  /** Splits the text into runs at style, script and bidi-level boundaries. */
  private itemize(text: string, styles: ResolvedStyle[], levels: readonly number[]): Run[] {
    return itemize(text, styles, levels);
  }

  /** Shapes every run and splits the shaped glyphs into lines. */
  private breakLines(
    runs: Run[],
    styles: ResolvedStyle[],
    text: string,
    width: number,
  ): Line[] {
    const scale = this.scale;

    // Shape every run in its bidi direction; collect glyphs with raw (un-penned)
    // positions. Within a run glyphs are re-sorted into logical cluster order so
    // the line breaker sees ascending clusters even for RTL runs; the visual
    // reorder happens afterwards, per line.
    const all: WorkGlyph[] = [];
    runs.forEach((run, runIndex) => {
      const style = styles[run.start] ?? DEFAULT_STYLE;
      const font = this.pickFont(style);
      if (!font) return;
      const size = style.size * scale;
      const unitScale = size / font.unitsPerEm;
      const raw = font.shape.shape(
        text.slice(run.start, run.end),
        run.script,
        run.direction,
        undefined,
        undefined,
      );
      const shaped: WorkGlyph[] = raw.map((g) => ({
        id: g.gid,
        cluster: g.cluster + run.start,
        dx: g.dx * unitScale,
        dy: g.dy * unitScale,
        advance: g.advance * unitScale,
        fontIndex: run.fontIndex,
        size,
        color: style.color,
        bidiLevel: run.bidiLevel,
        runIndex,
      }));
      // HarfBuzz returns RTL runs in visual order; sort by cluster to recover
      // logical order (a stable sort keeps glyphs within a cluster in paint
      // order). For LTR runs this is already the order, so it is a no-op.
      shaped.sort((a, b) => a.cluster - b.cluster);
      for (const g of shaped) all.push(g);
    });

    const fallbackSize = DEFAULT_STYLE.size * scale;
    if (all.length === 0) {
      return [makeLine([], fallbackSize * 1.2, fallbackSize * 1.2, LineEndKind.End)];
    }

    const breaks = new Set(hardBreaks(text));
    const opportunities = new Set(breakOpportunities(text));

    // Line breaking in logical order. Groups capture the consuming glyphs; run
    // height/baseline are running maxima (kept across lines, as upstream does).
    interface Group {
      glyphs: WorkGlyph[];
      height: number;
      baseline: number;
      kind: LineEndKind;
    }
    const groups: Group[] = [];
    let group: WorkGlyph[] = [];
    let pen = 0;
    let runHeight = 0;
    let runBaseline = 0;
    let lastCluster = -1;

    const flush = (kind: LineEndKind): void => {
      groups.push({ glyphs: group, height: runHeight || 1, baseline: runBaseline || 1, kind });
      group = [];
      pen = 0;
    };

    for (const g of all) {
      const cluster = g.cluster;
      if (cluster <= lastCluster) {
        // Extra glyph of a multi-glyph cluster: advances the pen and stays on
        // the line, but can never open a new one.
        pen += g.advance;
        group.push(g);
        runHeight = Math.max(runHeight, g.size * 1.2);
        runBaseline = Math.max(runBaseline, g.size * 0.8);
        continue;
      }
      if (breaks.has(cluster) && group.length > 0) {
        // A paragraph separator ends the line it sits on; it is not folded onto
        // the following line.
        group.push(g);
        runHeight = Math.max(runHeight, g.size * 1.2);
        runBaseline = Math.max(runBaseline, g.size * 0.8);
        flush(LineEndKind.HardBreak);
        continue;
      }
      if (pen + g.advance > width && group.length > 0 && opportunities.has(cluster)) {
        flush(LineEndKind.Width);
      }
      group.push(g);
      pen += g.advance;
      lastCluster = cluster;
      runHeight = Math.max(runHeight, g.size * 1.2);
      runBaseline = Math.max(runBaseline, g.size * 0.8);
    }
    if (group.length > 0) flush(LineEndKind.End);
    if (groups.length === 0) {
      return [makeLine([], fallbackSize * 1.2, fallbackSize * 1.2, LineEndKind.End)];
    }

    return groups.map((gr) => this.finishLine(gr.glyphs, gr.height, gr.baseline, gr.kind));
  }

  /**
   * Turns one line's consumed glyphs into a positioned `Line` in visual order:
   * reorder runs (UAX #9 L1), reverse clusters within RTL runs (L2), then pen
   * the glyphs left-to-right.
   */
  private finishLine(glyphs: WorkGlyph[], height: number, baseline: number, kind: LineEndKind): Line {
    const ordered = glyphs.some((g) => g.bidiLevel !== 0) ? visualOrder(glyphs) : glyphs;
    const positioned: Glyph[] = [];
    let pen = 0;
    for (const g of ordered) {
      positioned.push({
        id: g.id,
        cluster: g.cluster,
        dx: g.dx + pen,
        dy: g.dy,
        advance: g.advance,
        fontIndex: g.fontIndex,
        size: g.size,
        color: g.color,
      });
      pen += g.advance;
    }
    return makeLine(positioned, baseline, height, kind);
  }

  private pickFont(style: ResolvedStyle): RegisteredFont | undefined {
    const family = this.fontCtx.get(style.familyIndex)?.family;
    const all = family ? this.fontCtx.family(family) : [];
    for (const idx of all) {
      const f = this.fontCtx.get(idx);
      if (f && f.unitsPerEm > 0) return f;
    }
    // Fall back to the first registered font, which is what a caller with one
    // font loaded expects.
    for (let i = 0; i < this.fontCtx.size; i++) {
      const f = this.fontCtx.get(i);
      if (f && f.unitsPerEm > 0) return f;
    }
    return undefined;
  }
}

/** Reorders a line's glyphs from logical into visual (left-to-right) order. */
function visualOrder(glyphs: WorkGlyph[]): WorkGlyph[] {
  // Group into run-blocks by contiguous run index. `finishLine` only calls this
  // for lines with bidi, so there is always at least one run.
  interface Block {
    runIndex: number;
    bidiLevel: number;
    glyphs: WorkGlyph[];
  }
  const blocks: Block[] = [];
  for (const g of glyphs) {
    const last = blocks[blocks.length - 1];
    if (last && last.runIndex === g.runIndex) last.glyphs.push(g);
    else blocks.push({ runIndex: g.runIndex, bidiLevel: g.bidiLevel, glyphs: [g] });
  }

  // L1: reorder runs on the line by embedding level.
  const ordered = reorderRunsByLevel(blocks);

  // L2: within a right-to-left run, reverse the order of clusters (keeping each
  // cluster's own glyphs in paint order).
  const out: WorkGlyph[] = [];
  for (const b of ordered) {
    if (b.bidiLevel % 2 === 1) out.push(...reverseClusters(b.glyphs));
    else out.push(...b.glyphs);
  }
  return out;
}

/** Reverses cluster order within a run, keeping each cluster's glyphs together. */
function reverseClusters(glyphs: WorkGlyph[]): WorkGlyph[] {
  const clusters: WorkGlyph[][] = [];
  for (const g of glyphs) {
    const last = clusters[clusters.length - 1];
    if (last && last[0]!.cluster === g.cluster) last.push(g);
    else clusters.push([g]);
  }
  clusters.reverse();
  return clusters.flat();
}
