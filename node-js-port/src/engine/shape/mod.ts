/**
 * The shaping stage of `parley_engine`, mirroring `parley_engine/src/shape`.
 *
 * The port wraps HarfBuzzJS for actual glyph production (see `shaper.ts`); this
 * module re-exports that surface under the same path the engine uses.
 */

export * from './shaper.js';
