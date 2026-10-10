/**
 * Text style properties, replacing `parley::style` and the `attributed_text`
 * crate it is built on.
 *
 * Upstream is a family of newtypes plus a `StyleProperty` enum. In a port the
 * natural grouping is a single module of classes with `#[derive(Default)]`
 * equivalents expressed as constants, so the API reads the same at call sites.
 *
 * The port deliberately keeps the *names* identical to upstream: `FontWeight`,
 * `FontFamily`, `LineHeight`, `TextWrapMode`, `OverflowWrap`, `Alignment`.
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

/** How the height of a line box is derived. */
export type LineHeight_ =
  | { readonly kind: 'metrics-relative'; readonly value: number }
  | { readonly kind: 'font-size-relative'; readonly value: number }
  | { readonly kind: 'absolute'; readonly value: number };

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
