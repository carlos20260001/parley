// Copyright 2021 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Shared scratch space for layout, replacing `parley::LayoutContext`.
 *
 * Upstream `LayoutContext` is designed to be a global resource with only one
 * per application (or per thread). It holds the reusable analysis scratch —
 * the `Analyzer` and its `Analysis` — so that repeated layouts of similar
 * text do not reallocate; the port keeps the same shape by holding the
 * `Analyzer` on the builder and the display scale here.
 *
 * The builders themselves live in `builder.ts`, matching upstream's split.
 */

import { RangedBuilder } from './builder.js';
import type { FontContext } from './font.js';

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
