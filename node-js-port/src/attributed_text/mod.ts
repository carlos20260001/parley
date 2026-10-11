// Copyright 2025 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Attributed text, replacing the `attributed_text` crate.
 *
 * `attributed_text` is upstream's standalone crate for `Attrs`, `AttrsList`,
 * `TextRange` and the attribute-segment iterators: a flat set of text
 * attributes plus a mapping from character ranges to them. It is the layer
 * `parley::style` is built on, so it is ported here in its own module to keep
 * the correspondence with the two upstream crates visible.
 *
 * Upstream's `lib.rs` exports `attribute_segments`, `attributed_text`,
 * `error`, `text_range` and `text_storage`. The port implements only
 * `Attrs` — the attribute set itself — because the segment iterators and the
 * `AttrsList` range map are consumed by `parley::resolve`, which resolves
 * styles per character here in a single pass instead.
 */

export { Attrs } from './attributed_text.js';
