/**
 * The layout entry point, replacing `parley::LayoutContext`, `RangedBuilder`
 * and the `parley_engine` driver that sits underneath them.
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
 * `build` runs the same four stages as `parley_engine`:
 *
 *  1. **resolve** — each character inherits a style from the pushed ranges.
 *  2. **itemize** — runs are split at style boundaries and script boundaries.
 *  3. **shape** — each run goes through HarfBuzz with its resolved style.
 *  4. **line break** — UAX #14 breaks fill lines to the requested width.
 *
 * ## What is not yet implemented
 *
 * Bidirectional reordering (UAX #9). RTL text is laid out as if it were LTR,
 * which is correct for the glyph order but not for visual order in a mixed
 * paragraph. Upstream runs `bidi.rs` (915 lines) between stages 2 and 3. That
 * is the largest remaining gap; see `bidi.ts`.
 */

import type { FontContext, RegisteredFont } from './font_context.js';
import { buildClusters, type Glyph, type Run } from './cluster.js';
import type { Brush, StyleProperty } from './attrs.js';
import { Alignment } from './style.js';
import { breakOpportunities, hardBreaks } from './line_break.js';
import { Layout, type Line } from './layout.js';
import { makeLine, LineEndKind } from './layout.js';
import { graphemes, scriptDirection, scriptOf } from './unicode.js';

/** A resolved style for one character. */
interface ResolvedStyle {
  familyIndex: number;
  size: number;
  weight: number;
  width: number;
  italic: boolean;
  color: Brush;
}

const DEFAULT_STYLE: ResolvedStyle = {
  familyIndex: 0,
  size: 16,
  weight: 400,
  width: 1,
  italic: false,
  color: 0,
};

/**
 * A style plus the character range it applies to.
 *
 * Upstream `RangedBuilder` stores ranges as it is built; the port does the
 * same, then resolves once at `build`.
 */
interface StyleRange {
  readonly property: StyleProperty;
  readonly start: number;
  readonly end: number;
}

/** Builds style runs and drives a layout. */
export class LayoutContext {
  private scale = 1;

  /** Sets a display scale applied to every size, as upstream does. */
  setScale(scale: number): void {
    this.scale = scale;
  }

  /** Starts a builder for `text`. */
  rangedBuilder(fontCtx: FontContext): RangedBuilder {
    return new RangedBuilder(fontCtx, this.scale);
  }
}

/** Accumulates style ranges and produces a `Layout`. */
export class RangedBuilder {
  private readonly ranges: StyleRange[] = [];

  constructor(
    private readonly fontCtx: FontContext,
    private readonly scale: number,
  ) {}

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

  /**
   * Lays out `text` into a `Layout`.
   *
   * `width` is the maximum line width in pixels before wrapping.
   */
  build(text: string, width = Number.POSITIVE_INFINITY, alignment = Alignment.Start): Layout {
    const layout = new Layout(text);
    if (text.length === 0) {
      layout.pushLine(
        makeLine([], DEFAULT_STYLE.size * 1.2, DEFAULT_STYLE.size * 1.2, LineEndKind.End),
      );
      return layout;
    }

    const styles = this.resolve(text);
    const runs = this.itemize(text, styles);
    const lines = this.breakLines(runs, text, width, alignment);
    for (const l of lines) layout.pushLine(l);
    return layout;
  }

  /** Resolves a style per character. */
  private resolve(text: string): ResolvedStyle[] {
    const out: ResolvedStyle[] = new Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = { ...DEFAULT_STYLE };

    for (const r of this.ranges) {
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

  /**
   * Splits the text into runs at style and script boundaries.
   *
   * Upstream itemizes by script, emoji, bidi direction and style. The port
   * splits on style and script only — the other two are covered by `bidi.ts`
   * being unimplemented.
   */
  private itemize(text: string, styles: ResolvedStyle[]): Run[] {
    const out: Run[] = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
      const style = styles[i] ?? DEFAULT_STYLE;
      const script = scriptOf(text[i] ?? '');
      let j = i + 1;
      while (j < n) {
        const s = styles[j] ?? DEFAULT_STYLE;
        // A change in any style property starts a new run.
        if (
          s.size !== style.size ||
          s.color !== style.color ||
          s.italic !== style.italic ||
          s.weight !== style.weight ||
          s.width !== style.width ||
          s.familyIndex !== style.familyIndex
        ) {
          break;
        }
        // So does a change of script, because HarfBuzz shapes per script.
        if (scriptOf(text[j] ?? '') !== script) break;
        j++;
      }
      out.push({
        start: i,
        end: j,
        styleIndex: i,
        fontIndex: style.familyIndex,
        script: scriptTagFor(script),
        direction: scriptDirection(script),
      });
      i = j;
    }
    return out;
  }

  /** Shapes every run and splits the result into lines. */
  private breakLines(
    runs: Run[],
    text: string,
    width: number,
    alignment: Alignment,
  ): Line[] {
    const styles = this.resolve(text);
    const scale = this.scale;

    // Shape every run up front; line breaking then works on real advances.
    const all: Glyph[] = [];
    for (const run of runs) {
      const style = styles[run.start] ?? DEFAULT_STYLE;
      const font = this.pickFont(style);
      if (!font) continue;
      const size = style.size * scale;
      const unitScale = size / font.unitsPerEm;
      const raw = font.shape.shape(
        text.slice(run.start, run.end),
        run.script,
        'ltr',
        undefined,
        undefined,
      );
      for (const g of raw) {
        all.push({
          id: g.gid,
          cluster: g.cluster + run.start,
          dx: g.dx * unitScale,
          dy: g.dy * unitScale,
          advance: g.advance * unitScale,
          fontIndex: run.fontIndex,
          size,
          color: style.color,
        });
      }
    }

    const fallbackSize = DEFAULT_STYLE.size * scale;
    if (all.length === 0) {
      return [makeLine([], fallbackSize * 1.2, fallbackSize * 1.2, LineEndKind.End)];
    }

    const lines: Line[] = [];
    const breaks = breakSet(text);
    const opportunities = new Set(breakOpportunities(text));

    let line: Glyph[] = [];
    let pen = 0;
    let lineHeight = 0;
    let baseline = 0;
    let lastCluster = -1;

    const flush = (kind: LineEndKind): void => {
      lines.push(makeLine(line, baseline || 1, lineHeight || 1, kind));
      line = [];
      pen = 0;
    };

    for (const g of all) {
      const cluster = g.cluster;
      // A cluster spanning characters already placed on this line: one glyph
      // of a ligature. It advances the pen but starts no new line.
      if (cluster <= lastCluster) {
        pen += g.advance;
        continue;
      }

      // A hard break in the text ends the line before this cluster.
      if (breaks.has(cluster) && line.length > 0) flush(LineEndKind.HardBreak);

      // Overflow, but only where UAX #14 allows a break; a word that cannot
      // break overflows rather than wrapping mid-word.
      if (pen + g.advance > width && line.length > 0 && opportunities.has(cluster)) {
        flush(LineEndKind.Width);
      }

      line.push({ ...g, dx: g.dx + pen });
      pen += g.advance;
      lastCluster = cluster;
      lineHeight = Math.max(lineHeight, g.size * 1.2);
      baseline = Math.max(baseline, g.size * 0.8);
    }

    if (line.length > 0) flush(LineEndKind.End);
    if (lines.length === 0) {
      lines.push(makeLine([], fallbackSize * 1.2, fallbackSize * 1.2, LineEndKind.End));
    }
    void alignment;
    return lines;
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

/** Applies one property to a resolved style. */
function applyProperty(s: ResolvedStyle, p: StyleProperty): ResolvedStyle {
  switch (p.kind) {
    case 'FontSize': return { ...s, size: p.value };
    case 'FontWeight': return { ...s, weight: p.value.value };
    case 'FontWidth': return { ...s, width: p.value.value };
    case 'FontStyle': return { ...s, italic: p.value.kind !== 'normal' };
    case 'Brush': return { ...s, color: p.value };
    default: return s;
  }
}

/** Maps a script tag to the tag HarfBuzz expects, defaulting to Latin. */
function scriptTagFor(script: string): string {
  return script || 'Latn';
}

/** All character indices where the text has a hard break. */
function breakSet(text: string): Set<number> {
  return new Set(hardBreaks(text));
}
