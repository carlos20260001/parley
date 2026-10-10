/**
 * Attributed text, replacing the `attributed_text` crate.
 *
 * `attributed_text` is upstream's standalone crate for `Attrs` and `AttrsList`:
 * a flat set of text attributes plus a mapping from character ranges to them.
 * It is the layer `parley::style` is built on, so it is ported here in its own
 * module to keep the correspondence with the two upstream crates visible.
 *
 * `Color` is not redefined. The port shares `Brush` with `ecolor` so there is
 * one colour implementation across the whole pipeline; upstream `attributed_text`
 * ships its own `Color` and `parley` re-exports it.
 */

import {
  FontFamily,
  FontStyle,
  FontWeight,
  FontWidth,
  LineBreak,
  LineHeight,
  OverflowWrap,
  TextWrapMode,
  WhiteSpaceCollapse,
  WordBreak,
} from './style.js';

/** A colour, shared with the `ecolor` port rather than redefined. */
export type Brush = number;

/**
 * A styled text attribute set, ported from `attributed_text::Attrs`.
 *
 * Upstream `Attrs` is a flat struct of options. The port keeps the same
 * defaults so a `RangedBuilder` with no properties behaves as upstream does.
 */
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

/**
 * A property in a style run, mirroring `StyleProperty`.
 *
 * A union keyed by `kind`, so a builder can apply one attribute to a range.
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
