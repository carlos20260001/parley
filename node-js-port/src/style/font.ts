// Copyright 2021 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * The font-selection newtypes, replacing `parley::style::font`.
 *
 * Upstream this module holds `FontFamily`, `FontFamilyName`, `FontFeature`,
 * `FontFeatures`, `FontStyle`, `FontVariation`, `FontVariations`, `FontWeight`,
 * `FontWidth` and `GenericFamily`. The port keeps the selection-relevant
 * subset: a family, a weight, a width and a style, which is what
 * `FontContext::faceFor` and fontique's matching compare.
 *
 * These live here rather than in `attributed_text` because upstream they are
 * part of `parley::style`, which `attributed_text` builds on.
 */

/**
 * A generic family name, plus upstream's named `FontFamily` variants.
 *
 * Upstream `FontFamily<'a>` is `Specific(Cow<'a, str>) | Generic(GenericFamily)`
 * where `GenericFamily` is `Serif | SansSerif | Monospace | Cursive | Fantasy |
 * SystemUi | Emoji | Math`.
 */
export type GenericFamily =
  | 'serif'
  | 'sans-serif'
  | 'monospace'
  | 'cursive'
  | 'fantasy'
  | 'system-ui'
  | 'emoji'
  | 'math';

/**
 * A font family: either a specific name or a generic CSS family.
 *
 * Upstream returns `FontFamily::Specific` from `named` and
 * `FontFamily::Generic` from the static constructors; the port carries both
 * possibilities in the same object so a caller can read whichever it needs.
 */
export class FontFamily {
  readonly generic: GenericFamily | undefined;
  readonly name: string | undefined;

  private constructor(name: string | undefined, generic: GenericFamily | undefined) {
    this.name = name;
    this.generic = generic;
  }

  static named(name: string): FontFamily {
    return new FontFamily(name, undefined);
  }

  static generic(g: GenericFamily): FontFamily {
    return new FontFamily(g === undefined ? 'sans-serif' : g, g);
  }

  static sansSerif(): FontFamily {
    return new FontFamily(undefined, 'sans-serif');
  }

  static serif(): FontFamily {
    return new FontFamily(undefined, 'serif');
  }

  static monospace(): FontFamily {
    return new FontFamily(undefined, 'monospace');
  }

  static get(css: string | GenericFamily): FontFamily {
    return FontFamily.named(css);
  }
}

/** A font weight, a u32 in upstream. Named constants are the CSS weights. */
export class FontWeight {
  constructor(readonly value: number) {}

  static readonly THIN = new FontWeight(100);
  static readonly EXTRA_LIGHT = new FontWeight(200);
  static readonly LIGHT = new FontWeight(300);
  static readonly NORMAL = new FontWeight(400);
  static readonly MEDIUM = new FontWeight(500);
  static readonly SEMIBOLD = new FontWeight(600);
  static readonly BOLD = new FontWeight(700);
  static readonly EXTRA_BOLD = new FontWeight(800);
  static readonly BLACK = new FontWeight(900);

  static readonly DEFAULT = FontWeight.NORMAL;

  /** CSS clamps to 1..=1000; upstream does the same via `from_css`/`from_f32`. */
  static fromF32(v: number): FontWeight {
    return new FontWeight(Math.min(1000, Math.max(1, Math.round(v))));
  }

  static fromCssKeyword(kw: string): FontWeight {
    switch (kw) {
      case 'bold': return FontWeight.BOLD;
      case 'normal': default: return FontWeight.NORMAL;
    }
  }
}

/** A font width, a f32 in upstream. Named constants are the CSS percentages. */
export class FontWidth {
  constructor(readonly value: number) {}
  static readonly NORMAL = new FontWidth(1.0);
  static readonly ULTRA_CONDENSED = new FontWidth(0.5);
  static readonly EXTRA_CONDENSED = new FontWidth(0.625);
  static readonly CONDENSED = new FontWidth(0.75);
  static readonly SEMI_CONDENSED = new FontWidth(0.875);
  static readonly SEMI_EXPANDED = new FontWidth(1.125);
  static readonly EXPANDED = new FontWidth(1.25);
  static readonly EXTRA_EXPANDED = new FontWidth(1.5);
  static readonly ULTRA_EXPANDED = new FontWidth(2.0);
  static readonly DEFAULT = FontWidth.NORMAL;
  static fromF32(v: number): FontWidth {
    return new FontWidth(Math.min(2, Math.max(0.5, v)));
  }
}

/** An italic or oblique style, with the oblique angle in degrees. */
export class FontStyle {
  private constructor(
    readonly kind: 'normal' | 'italic' | 'oblique',
    readonly angle: number,
  ) {}

  static readonly NORMAL = new FontStyle('normal', 0);
  static readonly ITALIC = new FontStyle('italic', 0);

  static oblique(angle: number): FontStyle {
    return new FontStyle('oblique', Math.min(90, Math.max(-90, angle)));
  }

  static fromCssKeyword(kw: string): FontStyle {
    return kw === 'italic' ? FontStyle.ITALIC : FontStyle.NORMAL;
  }
}
