/**
 * `parley_engine`: the low-level analysis, bidi, itemization and shaping that
 * sits under `parley`. This barrel mirrors the crate's public surface
 * (`parley_engine/src/lib.rs`): analysis produces per-character data and bidi
 * levels, itemization splits into shapeable runs, and the shaper turns a run's
 * text into glyphs.
 */

export * from './analysis.js';
export * from './bidi.js';
export * from './itemize.js';
export * from './shape/mod.js';
