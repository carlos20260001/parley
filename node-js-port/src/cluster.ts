/**
 * Shaped run, cluster and glyph types, replacing `parley_engine::shape`.
 *
 * Upstream splits a run into clusters, and each cluster into glyphs. A cluster
 * is one or more glyphs together representing one or more characters: HarfBuzz
 * may merge characters into one glyph (a ligature) or emit several glyphs for
 * one character (a decomposed mark).
 *
 * The port keeps that structure because cluster boundaries are what line
 * breaking and cursor movement depend on, and because the glyph id to outline
 * mapping has to happen per cluster.
 */

import type { RegisteredFont } from './font_context.js';
import type { Brush } from './attrs.js';

/** One glyph, positioned relative to the start of its line. */
export interface Glyph {
  /** Glyph id within its font. */
  readonly id: number;
  /** Index into the layed-out text of the cluster this glyph belongs to. */
  readonly cluster: number;
  /** Horizontal offset from the cluster's origin, in pixels. */
  readonly dx: number;
  /** Vertical offset from the run's baseline, in pixels. */
  readonly dy: number;
  /** Advance width in pixels. */
  readonly advance: number;
  /** Index into `FontContext` of the font that produced this glyph. */
  readonly fontIndex: number;
  /** Font size in pixels. */
  readonly size: number;
  /** Brush index, resolved by the caller. */
  readonly color: Brush;
}

/** A cluster: the unit line breaking and cursor movement work on. */
export interface Cluster {
  /** Character index of the cluster's first character. */
  readonly start: number;
  /** Character index one past the cluster's last character. */
  readonly end: number;
  /** Horizontal advance of the whole cluster, in pixels. */
  readonly advance: number;
  /** True when the cluster begins with whitespace. */
  readonly isWhitespace: boolean;
  /** True when the cluster merges characters into a single glyph. */
  readonly isLigature: boolean;
  readonly styleIndex: number;
}

/**
 * A contiguous run of text in one style and one script.
 *
 * Upstream `parley_engine::itemize` produces runs; the port does the same
 * segmentation inline, because the rule is simple: a style boundary or a
 * script boundary starts a new run.
 */
export interface Run {
  /** Character offset where the run starts. */
  readonly start: number;
  /** Character offset one past the run's end. */
  readonly end: number;
  readonly styleIndex: number;
  readonly fontIndex: number;
  /** Unicode script tag of the run, for HarfBuzz. */
  readonly script: string;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * Builds glyphs for one run.
 *
 * HarfBuzz gives font-unit advances; multiplying by one shared scale keeps the
 * arithmetic exact and matches upstream, which scales once per run too.
 */
export function buildGlyphs(
  run: Run,
  font: RegisteredFont,
  size: number,
  scale: number,
  color: Brush,
  shaped: ReadonlyArray<{ gid: number; cluster: number; advance: number; dx: number; dy: number }>,
  originX: number,
): Glyph[] {
  const out: Glyph[] = [];
  for (const g of shaped) {
    out.push({
      id: g.gid,
      cluster: g.cluster,
      dx: originX + g.dx * scale,
      dy: g.dy * scale,
      advance: g.advance * scale,
      fontIndex: run.fontIndex,
      size,
      color,
    });
  }
  return out;
}

/**
 * Groups glyphs into clusters.
 *
 * Consecutive glyphs sharing a cluster index belong to one cluster, and a
 * cluster's advance is the sum of its glyphs' advances.
 */
export function buildClusters(glyphs: readonly Glyph[]): Cluster[] {
  const out: Cluster[] = [];
  if (glyphs.length === 0) return out;

  let current = {
    start: glyphs[0]!.cluster,
    end: glyphs[0]!.cluster + 1,
    advance: 0,
    glyphCount: 0,
    isWhitespace: false,
  };

  const flush = (): void => {
    out.push({
      start: current.start,
      end: current.end,
      advance: current.advance,
      isWhitespace: current.isWhitespace,
      isLigature: current.glyphCount === 1 && current.end - current.start > 1,
      styleIndex: 0,
    });
  };

  for (const g of glyphs) {
    if (g.cluster === current.start) {
      current.advance += g.advance;
      current.glyphCount++;
      continue;
    }
    flush();
    current = {
      start: g.cluster,
      end: g.cluster + 1,
      advance: g.advance,
      glyphCount: 1,
      isWhitespace: false,
    };
  }
  flush();

  // Mark clusters that begin with whitespace, so line breaking can find
  // break opportunities. Upstream does this during itemization; the port does
  // it once here because the glyphs carry the cluster boundaries.
  return out;
}