// Copyright 2021 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Rich styling support, replacing `parley::style`.
 *
 * Upstream is `mod.rs` (the `StyleProperty` enum, `LineHeight`,
 * `WhiteSpaceCollapse`, `AlignmentBaseline`, the CSS enums re-exported from
 * `parlance`) plus `brush.rs`, `font.rs` and `styleset.rs`. The port keeps the
 * same three-file split for what it implements; `styleset.rs` is not ported
 * because `StyleRunBuilder` — the only consumer — is not ported either.
 *
 * The port deliberately keeps the *names* identical to upstream: `FontWeight`,
 * `FontFamily`, `LineHeight`, `TextWrapMode`, `OverflowWrap`, `Alignment`.
 */

import { FontFamily, FontStyle, FontWeight, FontWidth } from './font.js';
import type { Brush } from './brush.js';

export { FontFamily, FontStyle, FontWeight, FontWidth, type GenericFamily } from './font.js';
export type { Brush } from './brush.js';

/** How the height of a line box is derived. */
export type LineHeight_ =
  | { readonly kind: 'metrics-relative'; readonly value: number }
  | { readonly kind: 'font-size-relative'; readonly value: number }
  | { readonly kind: 'absolute'; readonly value: number };

/**
 * The height a line takes up.
 *
 * Upstream's default is `MetricsRelative(1.0)`, the font's preferred line
 * height; the port's `DEFAULT` is the `FontSizeRelative(1.2)` approximation
 * used before real font metrics are available.
 */
export class LineHeight {
  private constructor(
    readonly kind: 'metrics-relative' | 'font-size-relative' | 'absolute',
    readonly value: number,
  ) {}

  static metricsRelative(v: number): LineHeight {
    return new LineHeight('metrics-relative', v);
  }
  static fontSizeRelative(v: number): LineHeight {
    return new LineHeight('font-size-relative', v);
  }
  static absolute(v: number): LineHeight {
    return new LineHeight('absolute', v);
  }

  /** Upstream default: 1.2x the font size. */
  static readonly DEFAULT = LineHeight.fontSizeRelative(1.2);
}

export enum Alignment {
  Start = 'start',
  End = 'end',
  Left = 'left',
  Right = 'right',
  Center = 'center',
  Justify = 'justify',
}

export enum TextWrapMode {
  Wrap = 'wrap',
  NoWrap = 'noWrap',
}

export enum OverflowWrap {
  Normal = 'normal',
  Anywhere = 'anywhere',
  BreakWord = 'breakWord',
}

export enum WordBreak {
  Normal = 'normal',
  BreakAll = 'breakAll',
  KeepAll = 'keepAll',
}

/**
 * Unicode line-breaking overrides.
 *
 * Only `Auto` and an explicit break hint exist in the port; upstream adds
 * `LineBreak(Auto | Strict | Loose | Anywhere | ...)` plus `WordBreak`.
 */
export enum LineBreak {
  Auto = 'auto',
  Strict = 'strict',
  Loose = 'loose',
  Anywhere = 'anywhere',
}

export enum WhiteSpaceCollapse {
  Collapse = 'collapse',
  Preserve = 'preserve',
  PreserveBreaks = 'preserve-breaks',
  BreakSpaces = 'break-spaces',
}

/**
 * A property in a style run, mirroring `parley::style::StyleProperty`.
 *
 * A union keyed by `kind`, so a builder can apply one attribute to a range.
 * `Brush` is a type parameter because upstream styles are generic over the
 * brush type.
 */
export type StyleProperty<B = Brush> =
  | { readonly kind: 'FontFamily'; readonly value: FontFamily }
  | { readonly kind: 'FontSize'; readonly value: number }
  | { readonly kind: 'FontWeight'; readonly value: FontWeight }
  | { readonly kind: 'FontWidth'; readonly value: FontWidth }
  | { readonly kind: 'FontStyle'; readonly value: FontStyle }
  | { readonly kind: 'Brush'; readonly value: B }
  | { readonly kind: 'LineHeight'; readonly value: LineHeight }
  | { readonly kind: 'LetterSpacing'; readonly value: number }
  | { readonly kind: 'WordSpacing'; readonly value: number }
  | { readonly kind: 'OverflowWrap'; readonly value: OverflowWrap }
  | { readonly kind: 'TextWrapMode'; readonly value: TextWrapMode }
  | { readonly kind: 'LineBreak'; readonly value: LineBreak }
  | { readonly kind: 'WordBreak'; readonly value: WordBreak }
  | { readonly kind: 'WhiteSpaceCollapse'; readonly value: WhiteSpaceCollapse }
  | { readonly kind: 'Locale'; readonly value: string | undefined };
