/**
 * Font storage and selection, replacing the `fontique` half of `FontContext`.
 *
 * Upstream `parley::FontContext` owns a fontique collection and answers
 * "which face matches this family + weight + width + style". The fontique crate
 * does discovery and matching; `parley` does selection.
 *
 * The port keeps fonts as parsed `skrifa` fonts plus a HarfBuzz face built from
 * the same bytes, so one font serves both shaping and outlining. Discovery is
 * an explicit `registerFont` rather than an OS scan, because a Node process has
 * no portable system font directory to enumerate — callers pass in the fonts
 * they want.
 *
 * `skrifa`'s `name` table is not ported yet, so a family name comes from the
 * caller's hint. Upstream reads it from `name` ID 1/16; that is the one
 * selection input the port takes externally rather than from the font.
 */

import { FontRef } from '@egui-node/skrifa-ts';
import { FontFamily, FontStyle, FontWeight, FontWidth } from './style.js';
import type { Brush } from './attrs.js';
import { createFontFace, loadShaper, type ShaperFace, type ShapedGlyph } from './shaper.js';

/** A font the context can lay text out with. */
export interface RegisteredFont {
  /** The family name this font is registered under. */
  readonly family: string;
  /** OS/2 `usWeightClass`, defaulting to 400. */
  readonly weight: number;
  /** Normalized width, where 1.0 is normal. */
  readonly width: number;
  readonly italic: boolean;
  readonly unitsPerEm: number;
  readonly read: FontRef;
  readonly shape: ShaperFace;
  /** Vertical metrics in font units. */
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly capHeight: number;
  readonly xHeight: number;
}

/**
 * How far a font may be from the requested weight and still be chosen.
 *
 * Upstream fontique scores candidates and takes the closest. The port does the
 * same with a distance over weight, width and italic, which is what actually
 * decides which of several installed faces wins.
 */
const SCORE_WEIGHT = 1.0;
const SCORE_WIDTH = 1.0;
const SCORE_ITALIC = 40.0;

/** OS/2 `usWidthClass` 1..=9 mapped onto fontique's normalized widths. */
const WIDTH_BY_CLASS = new Map<number, number>([
  [1, 0.5],
  [2, 0.625],
  [3, 0.75],
  [4, 0.875],
  [5, 1.0],
  [6, 1.125],
  [7, 1.25],
  [8, 1.5],
  [9, 2.0],
]);

export class FontContext {
  private readonly fonts: RegisteredFont[] = [];
  private readonly byFamily = new Map<string, number[]>();

  private constructor() {}

  /**
   * Creates a context and compiles the HarfBuzz WASM module.
   *
   * Upstream is synchronous. This is async because HarfBuzzJS compiles its
   * WASM at load time; call it once at startup and reuse the context.
   */
  static async new(): Promise<FontContext> {
    await loadShaper();
    return new FontContext();
  }

  /** Registers a font from its raw bytes, returning its index. */
  registerFont(data: Uint8Array, familyHint?: string): number {
    const read = FontRef.new(data);
    const head = read.head();
    const hhea = read.hhea();
    const os2 = read.os2();

    const unitsPerEm = head?.unitsPerEm ?? 1000;
    const ascent = os2?.sTypoAscender ?? hhea?.ascender ?? 0;
    const descent = os2?.sTypoDescender ?? hhea?.descender ?? 0;
    const lineGap = os2?.sTypoLineGap ?? hhea?.lineGap ?? 0;
    const width = WIDTH_BY_CLASS.get(os2?.usWidthClass ?? 5) ?? 1;
    // `fsSelection` bit 0 is italic, bit 5 is bold.
    const italic = os2 !== undefined ? (os2.fsSelection & 0x01) !== 0 : false;

    const family = familyHint ?? 'default';
    const entry: RegisteredFont = {
      family,
      weight: os2?.usWeightClass ?? 400,
      width,
      italic,
      unitsPerEm,
      read,
      shape: createFontFace(data),
      ascent,
      descent,
      lineGap,
      capHeight: os2?.sCapHeight ?? 0,
      xHeight: os2?.sxHeight ?? 0,
    };

    const index = this.fonts.length;
    this.fonts.push(entry);
    const bucket = this.byFamily.get(family);
    if (bucket) bucket.push(index);
    else this.byFamily.set(family, [index]);
    return index;
  }

  get size(): number {
    return this.fonts.length;
  }

  get(i: number): RegisteredFont | undefined {
    return this.fonts[i];
  }

  /** Every font registered under a family name. */
  family(name: string): readonly number[] {
    return this.byFamily.get(name) ?? [];
  }

  /** Every distinct family name known to the context. */
  families(): string[] {
    return [...this.byFamily.keys()];
  }

  /**
   * Picks the closest font for a style.
   *
   * Tries the requested family first, then everything registered. Weight and
   * width distance is what breaks ties, matching fontique's scoring.
   */
  faceFor(
    family: FontFamily,
    weight: FontWeight,
    width: FontWidth,
    style: FontStyle,
  ): RegisteredFont | undefined {
    let best: RegisteredFont | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    const consider = (i: number): void => {
      const f = this.fonts[i];
      if (!f || f.unitsPerEm <= 0) return;
      const score =
        Math.abs(f.weight - weight.value) * SCORE_WEIGHT +
        Math.abs(f.width - width.value) * SCORE_WIDTH * 1000 +
        (style.kind === 'italic' && !f.italic ? SCORE_ITALIC : 0);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    };

    if (family.name !== undefined) for (const i of this.byFamily.get(family.name) ?? []) consider(i);
    if (best === undefined) for (let i = 0; i < this.fonts.length; i++) consider(i);
    return best;
  }
}

/** A resolved font plus the colour and size it should be drawn at. */
export interface ResolvedRun {
  readonly font: RegisteredFont;
  readonly scale: number;
  readonly color: Brush;
}

/** Scales font units to pixels for a run. */
export function runScale(font: RegisteredFont, size: number): number {
  return size / font.unitsPerEm;
}

/** Shapes one run of text with a resolved font. */
export function shapeRun(
  run: ResolvedRun,
  text: string,
  script: string | undefined,
): ShapedGlyph[] {
  return run.font.shape.shape(text, script, 'ltr', undefined, undefined);
}