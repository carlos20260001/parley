// Copyright 2025 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * `Attrs`, replacing the `attributed_text` crate's `Attrs`.
 *
 * Upstream `Attrs` is a flat struct of options with `Default`. The port keeps
 * the same defaults so a builder with no properties behaves as upstream does.
 *
 * The bidi- and layout-relevant style *properties* (`StyleProperty`) and the
 * shared `Brush` live in `style/`, because upstream those belong to
 * `parley::style`, which is built on top of this crate rather than the other
 * way round.
 */

import { type Brush, FontFamily, FontWeight, FontWidth, LineBreak, WordBreak } from '../style/mod.js';

export class Attrs {
  constructor(
    readonly family: FontFamily = FontFamily.sansSerif(),
    readonly weight: FontWeight = FontWeight.DEFAULT,
    readonly width: FontWidth = FontWidth.DEFAULT,
    readonly italic: boolean = false,
    readonly obliqueAngleDegrees: number = 0,
    readonly size: number = 16,
    readonly color: Brush = 0,
    readonly lineBreak: LineBreak = LineBreak.Auto,
    readonly wordBreak: WordBreak = WordBreak.Normal,
    readonly letterSpacing: number = 0,
    readonly wordSpacing: number = 0,
    readonly locale: string | undefined = undefined,
  ) {}
}
