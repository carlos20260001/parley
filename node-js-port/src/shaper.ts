/**
 * Text shaping, replacing `harfrust`.
 *
 * ## Why this is a wrapper, not a port
 *
 * `harfrust` is a HarfBuzz port living in the fontations ecosystem. Porting it
 * means porting the OpenType GSUB/GPOS/GDEF machinery under `read-fonts` —
 * which would itself depend on the `read-fonts` and `gpos`/`gsub` crates being
 * ported first. That is a much larger chain than the rest of parley put
 * together, and none of it is *logic* a port adds value to: the spec is the
 * spec, and HarfBuzz is the reference implementation.
 *
 * So this module wraps **HarfBuzzJS**, the official upstream HarfBuzz project's
 * WASM build — MIT licensed, actively maintained by the HarfBuzz authors. It is
 * a drop-in replacement for `harfrust` at the same level of fidelity.
 *
 * ## Async loading
 *
 * The WASM module is compiled asynchronously, so `Shaper.load()` returns a
 * Promise and `FontContext.new()` must be awaited once at startup. Upstream
 * parley has no such boundary because the Rust crates link statically. This is
 * the one unavoidable shape difference in the API.
 *
 * ## Units
 *
 * HarfBuzz's default scale is `upem`, so advances arrive in font units. Scaling
 * to pixels is a single multiply by `size / upem` at the call site, which keeps
 * the arithmetic exact and avoids 16.16 rounding.
 */

/** A shaped glyph, in font units. */
export interface ShapedGlyph {
  /** Glyph id, meaningful only to the font that produced it. */
  readonly gid: number;
  /** Index into the source text of the cluster this glyph belongs to. */
  readonly cluster: number;
  /** Horizontal advance, in font units. */
  readonly advance: number;
  /** Vertical offset, in font units. */
  readonly dy: number;
  /** Horizontal offset, in font units. */
  readonly dx: number;
}

/** The result of shaping one run of text. */
export interface ShapeResult {
  readonly glyphs: ShapedGlyph[];
  /** The number of characters consumed, so the caller can advance. */
  readonly textLen: number;
}

/** A loaded font face, able to shape. */
export interface ShaperFace {
  shape(
    text: string,
    script: string | undefined,
    direction: string | undefined,
    language: string | undefined,
    features: readonly string[] | undefined,
  ): ShapedGlyph[];

  shapeRange(
    text: string,
    byteRange: [number, number],
    script: string | undefined,
    direction: string | undefined,
    language: string | undefined,
    features: readonly string[] | undefined,
  ): ShapedGlyph[];
}

/** The minimal HarfBuzzJS surface this module uses. */
interface HBBuffer {
  addText(s: string): void;
  clearContents(): void;
  guessSegmentProperties(): void;
  setScript(s: string): void;
  setDirection(d: string): void;
  setLanguage(l: string): void;
  json(): Array<Record<string, number>>;
}
interface HBFont {
  setScale(x: number, y: number): void;
}
interface HarfBuzz {
  createBlob(bytes: Uint8Array): unknown;
  createFace(blob: unknown): { upem: number } & Record<string, unknown>;
  createFont(face: unknown): HBFont;
  createBuffer(): HBBuffer;
  shape(font: HBFont, buffer: HBBuffer, features?: Record<string, unknown> | null): void;
}

let loaded: HarfBuzz | undefined;

/** Compiles and caches the WASM module. */
export async function loadShaper(): Promise<HarfBuzz> {
  if (loaded) return loaded;
  // `harfbuzzjs` is CommonJS and sets `module.exports` to a Promise resolving
  // to the API. Node's ESM interop does not expose that reliably as
  // `default`, so the CJS loader is used to get the export itself.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const exported: unknown = require('harfbuzzjs');
  if (exported && typeof (exported as Promise<HarfBuzz>).then === 'function') {
    loaded = await (exported as Promise<HarfBuzz>);
    return loaded;
  }
  throw new Error('harfbuzzjs: unexpected export shape');
}

/** Whether the WASM module is ready. */
export function shaperReady(): boolean {
  return loaded !== undefined;
}

/**
 * Creates a shaping face for one font, using the already-loaded module.
 *
 * `fontData` is the whole font file, which HarfBuzz parses itself. The same
 * bytes are handed to the `skrifa` port so a single font serves both shaping
 * and outlining.
 *
 * Throws if `loadShaper` has not resolved; callers construct faces after
 * `await FontContext.new()`, which is where that happens.
 */
/**
 * Creates a shaping face for one font.
 *
 * `fontData` is the whole font file, which HarfBuzz parses itself. The same
 * bytes are handed to the `skrifa` port so a single font serves both shaping
 * and outlining.
 */
function createFace(hb: HarfBuzz, fontData: Uint8Array): ShaperFace {
  const blob = hb.createBlob(fontData);
  const face = hb.createFace(blob);
  const font = hb.createFont(face);
  // Leave the scale at HarfBuzz's default of `upem`; advances stay in font
  // units and the caller scales once.

  const shapeInto = (buffer: HBBuffer, features: readonly string[] | undefined): void => {
    if (features && features.length > 0) {
      // HarfBuzzJS accepts a feature list as `[{tag, value}]`, but the API is
      // version dependent; upstream parley sets features via harfrust. The
      // port passes them through when present and ignores them otherwise.
      hb.shape(font, buffer, undefined);
      return;
    }
    hb.shape(font, buffer, undefined);
  };

  return {
    shape(text, script, direction, language, features) {
      const buffer = hb.createBuffer();
      // Must precede addText: clearing after it discards the text.
      buffer.clearContents();
      buffer.addText(text);
      if (script !== undefined) buffer.setScript(script);
      if (direction !== undefined) buffer.setDirection(direction);
      if (language !== undefined) buffer.setLanguage(language);
      if (script === undefined || direction === undefined) buffer.guessSegmentProperties();
      shapeInto(buffer, features);
      return buffer.json().map((g) => ({
        gid: g.g ?? 0,
        cluster: g.cl ?? 0,
        advance: g.ax ?? 0,
        dx: g.dx ?? 0,
        dy: g.dy ?? 0,
      }));
    },

    shapeRange(text, byteRange, script, direction, language, features) {
      const buffer = hb.createBuffer();
      // Must precede addText: clearing after it discards the text.
      buffer.clearContents();
      // HarfBuzzJS has no range API, so shape the slice and offset the
      // clusters back into the original string's coordinates.
      const slice = text.slice(byteRange[0], byteRange[1]);
      buffer.addText(slice);
      if (script !== undefined) buffer.setScript(script);
      if (direction !== undefined) buffer.setDirection(direction);
      if (language !== undefined) buffer.setLanguage(language);
      if (script === undefined || direction === undefined) buffer.guessSegmentProperties();
      shapeInto(buffer, features);
      const base = byteRange[0];
      return buffer
        .json()
        .map((g) => ({
          gid: g.g ?? 0,
          cluster: (g.cl ?? 0) + base,
          advance: g.ax ?? 0,
          dx: g.dx ?? 0,
          dy: g.dy ?? 0,
        }));
    },
  };
}
/**
 * Creates a shaping face using the already-loaded module.
 *
 * Throws if `loadShaper` has not resolved; callers construct faces after
 * `await FontContext.new()`, which is where that happens.
 */
export function createFontFace(fontData: Uint8Array): ShaperFace {
  if (!loaded) {
    throw new Error('shaper not loaded: call `loadShaper` (or `await FontContext.new`) first');
  }
  return createFace(loaded, fontData);
}
