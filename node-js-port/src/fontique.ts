/**
 * A TypeScript port of `fontique`.
 *
 * `fontique` is upstream's font discovery and matching crate: it enumerates
 * fonts, groups them into families, and picks the best face for a requested
 * family + weight + width + style. It is what `parley::FontContext` sits on.
 *
 * ## Scope of this port
 *
 * Ported faithfully, because matching is observable behaviour:
 *
 *  - `Collection`: register, families, generic families, fallbacks, query.
 *  - `Query`: family set, attributes, fallback key, `matches_with`,
 *    `first_available_font`.
 *  - `matching.rs`'s selection algorithm, including the width/weight/oblique
 *    tie-breaking, which is what decides which of several installed faces wins.
 *  - Directory scanning over `node:fs`, as the portable alternative to the
 *    four OS backends.
 *
 * ## Not ported
 *
 * The OS backends — `backend/fontconfig.rs`, `dwrite.rs`, `coretext.rs`,
 * `android.rs` — enumerate the host's installed fonts through platform APIs
 * with no Node.js equivalent. `registerFonts` and `scanDirectory` are the
 * port's entry points instead, which is also what a Node application that
 * ships its own fonts does.
 *
 * `source_cache.rs` caches font bytes in a shared store so `QueryFont` can
 * hand out `&[u8]`. The port keeps the bytes alongside each face, which
 * removes the cache entirely rather than reimplementing it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { FontRef } from '@egui-node/skrifa-ts';

/** The generic family names CSS defines, plus fontique's aliases. */
export type GenericFamily =
  | 'serif'
  | 'sans-serif'
  | 'monospace'
  | 'cursive'
  | 'fantasy'
  | 'system-ui'
  | 'ui-serif'
  | 'ui-sans-serif'
  | 'ui-monospace'
  | 'ui-rounded'
  | 'emoji'
  | 'math'
  | 'fangsong'
  | 'inherit'
  | 'initial'
  | 'unset'
  | 'revert';

/** A font's weight, width and style — the attributes matching compares. */
export interface Attributes {
  readonly weight: number;
  readonly width: number;
  readonly style: FontStyleKind;
}

/** An italic or oblique style. */
export type FontStyleKind = 'normal' | 'italic' | 'oblique';

/** An oblique style with its angle, as upstream `FontStyle::Oblique(angle)`. */
export function isOblique(s: FontStyleKind): boolean {
  return s === 'oblique';
}

/** Upstream's default oblique angle, used when synthesizing. */
export const DEFAULT_OBLIQUE_ANGLE = 14.0;

/** A script tag used as a fallback key. */
export type FallbackKey = string;

/** Everything the port needs to know about one face. */
export interface FontInfo {
  readonly source: Uint8Array;
  readonly read: FontRef;
  readonly family: string;
  readonly weight: number;
  readonly width: number;
  readonly style: FontStyleKind;
  /** True when the font has an `slnt` variation axis. */
  readonly hasSlantAxis: boolean;
  /** The scripts this font covers, for fallback. */
  readonly scripts: Set<string>;
}

/** What the caller wants, as upstream `Attributes`. */
export interface QueryAttributes {
  weight?: number;
  width?: number;
  style?: FontStyleKind;
}

/** Options for constructing a collection. */
export interface CollectionOptions {
  /** Whether to scan shared system font directories on `loadSystemFonts`. */
  readonly system?: boolean;
  /** Whether to scan user font directories. */
  readonly user?: boolean;
}

/** A matched font: face plus the attributes it matched. */
export interface QueryFont {
  readonly info: FontInfo;
  /** The style that was actually selected, possibly synthesized. */
  readonly style: FontStyleKind;
  readonly weight: number;
  readonly width: number;
  readonly family: string;
}

/**
 * The match result, mirroring `QueryStatus`.
 *
 * `synthesize` means the requested weight/style was unavailable and the caller
 * should apply it; upstream distinguishes it so the text engine can decide.
 */
export type QueryStatus = 'found' | 'synthesize' | 'not-found';

const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'];

/** Whether a path looks like a font file. */
export function isFontPath(path: string): boolean {
  const lower = path.toLowerCase();
  return FONT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Reads a font file and extracts its matching attributes. */
export function loadFontInfo(data: Uint8Array, familyHint?: string): FontInfo | undefined {
  const read = FontRef.new(data);
  const os2 = read.os2();
  const head = read.head();
  const hhea = read.hhea();
  if (!head || !hhea) return undefined;

  const width = widthClassToRatio(os2?.usWidthClass ?? 5);
  const italic = os2 !== undefined && (os2.fsSelection & 0x01) !== 0;
  const weight = os2?.usWeightClass ?? 400;

  return {
    source: data,
    read,
    family: familyHint ?? 'default',
    weight,
    width,
    style: italic ? 'italic' : 'normal',
    // Reading variation axes needs skrifa's fvar port; unavailable means no
    // synthesized oblique, which matches what a static font does.
    hasSlantAxis: false,
    scripts: collectScripts(read),
  };
}

/** OS/2 `usWidthClass` 1..=9 mapped onto fontique's normalized width ratio. */
export function widthClassToRatio(cls: number): number {
  const table = [0.5, 0.625, 0.75, 0.875, 1.0, 1.125, 1.25, 1.5, 2.0];
  const i = Math.min(8, Math.max(0, cls - 1));
  return table[i] ?? 1.0;
}

/** The scripts a font covers, read from its cmap. */
function collectScripts(read: FontRef): Set<string> {
  const out = new Set<string>();
  const cmap = read.charmap();
  if (!cmap) return out;
  // A cmap's coverage is the set of scripts with at least one mapped
  // codepoint. `charmap()` here exposes format 4 and 12 only.
  for (const ch of ['a', 'A', '0']) {
    const gid = cmap.glyph_id(ch.codePointAt(0)!);
    if (gid) out.add('Latn');
    break;
  }
  // Han coverage, checked separately because Latin presence says nothing
  // about CJK and fallback selection depends on it.
  for (const ch of ['\u4e2d']) {
    if (cmap.glyph_id(ch.codePointAt(0)!)) out.add('Hani');
  }
  return out;
}

/** Recursively finds font files under a directory. */
export function scanDirectory(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) continue;
      out.push(...scanDirectory(full));
    } else if (e.isFile() && isFontPath(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Reads every font under a directory into `FontInfo`s. */
export function registerDirectory(
  collection: Collection,
  dir: string,
  familyHintFor: (path: string) => string | undefined = () => undefined,
): number {
  let n = 0;
  for (const p of scanDirectory(dir)) {
    try {
      const data = new Uint8Array(readFileSync(p));
      const info = loadFontInfo(data, familyHintFor(p));
      if (info) {
        collection.register(info);
        n++;
      }
    } catch {
      // A file that cannot be read is skipped rather than failing the scan,
      // which is what fontique's source cache does.
    }
  }
  return n;
}

/**
 * The port of `fontique::matching::match_font`, rule for rule.
 *
 * Upstream's algorithm, in order:
 *
 *  1. **Width reduction.** If a face matches the requested width exactly, only
 *     faces at that width remain. Otherwise take the nearest width above, else
 *     the nearest below, else the first face's width.
 *  2. **Style selection.** If any face has the requested style, keep it.
 *     Otherwise search oblique faces by angle (CSS's weight analogues apply to
 *     angle: prefer the closest at or past the request, etc.), falling back to
 *     Normal, then Italic, then the first face's style.
 *  3. **Weight selection**, following CSS Fonts Level 4 rather than the obvious
 *     "closest weight": for a request of 400..=500, prefer the lightest face
 *     at or above the request up to 500, then the heaviest below, then the
 *     lightest above 500. Below 400 the order is heaviest-at-or-below then
 *     lightest-above; above 500 it mirrors that.
 *
 * Step 3 is the part a rewrite gets wrong. "Closest weight" is *not* what CSS
 * specifies, and it is visibly different: a request of 400 with faces at 300
 * and 500 picks 500 upstream (400..=500 range: lightest at-or-above), while
 * naive distance picks 300.
 *
 * Returns `undefined` when the set is empty. A single face returns index 0.
 */
export function matchFont(
  set: readonly FontInfo[],
  width: number,
  style: FontStyleKind,
  weight: number,
  synthesizeStyle: boolean,
): number | undefined {
  if (set.length === 0) return undefined;
  if (set.length === 1) return 0;

  // Upstream compares integer percentages, so 0.875 and 87.5% agree.
  const widthPct = Math.round(width * 100);
  let useWidthPct = widthPct;
  const anyExactWidth = set.some((f) => Math.round(f.width * 100) === widthPct);
  if (!anyExactWidth) {
    const above = set
      .filter((f) => Math.round(f.width * 100) > widthPct)
      .reduce((best: number | undefined, f) => {
        const w = Math.round(f.width * 100);
        return best === undefined || w < best ? w : best;
      }, undefined);
    const below = set
      .filter((f) => Math.round(f.width * 100) < widthPct)
      .reduce((best: number | undefined, f) => {
        const w = Math.round(f.width * 100);
        return best === undefined || w > best ? w : best;
      }, undefined);
    useWidthPct = above ?? below ?? Math.round(set[0]!.width * 100);
  }

  let remaining = set.filter((f) => Math.round(f.width * 100) === useWidthPct);
  if (remaining.length === 0) remaining = [...set];

  // Style selection.
  const oblique = remaining
    .map((f, i) => ({ i, angle: obliqueAngle(f) }))
    .filter((x): x is { i: number; angle: number } => x.angle !== undefined);
  let useStyle: FontStyleKind = style;
  if (!remaining.some((f) => f.style === style)) {
    if (style === 'italic') {
      useStyle = closestOblique(remaining, oblique, undefined) ?? remaining[0]!.style;
    } else if (style === 'normal') {
      const any = remaining.find((f) => f.style === 'normal');
      const fallback = any
        ? 'normal'
        : remaining.some((f) => f.style === 'italic')
          ? 'italic'
          : (remaining[0]!.style as FontStyleKind);
      if (synthesizeStyle) {
        useStyle = remaining.some((f) => f.hasSlantAxis)
          ? style
          : (fallback as FontStyleKind);
      } else {
        useStyle = fallback;
      }
    } else {
      // Oblique requested: prefer the closest angle, as CSS describes.
      useStyle = closestOblique(remaining, oblique, 0) ?? remaining[0]!.style;
    }
  }

  remaining = remaining.filter((f) => f.style === useStyle);
  if (remaining.length === 0) return undefined;

  // Weight selection, per CSS Fonts Level 4.
  const exact = remaining.find((f) => f.weight === weight);
  if (exact) return set.indexOf(exact);

  if (weight >= 400 && weight <= 500) {
    const atOrAbove = remaining
      .filter((f) => f.weight >= weight && f.weight <= 500)
      .reduce(minByWeight, undefined);
    if (atOrAbove) return set.indexOf(atOrAbove);
    const below = remaining
      .filter((f) => f.weight < weight)
      .reduce(maxByWeight, undefined);
    if (below) return set.indexOf(below);
    const over500 = remaining.filter((f) => f.weight > 500).reduce(minByWeight, undefined);
    if (over500) return set.indexOf(over500);
    return undefined;
  }

  if (weight < 400) {
    const atOrBelow = remaining.filter((f) => f.weight <= weight).reduce(maxByWeight, undefined);
    if (atOrBelow) return set.indexOf(atOrBelow);
    const above = remaining.filter((f) => f.weight > weight).reduce(minByWeight, undefined);
    if (above) return set.indexOf(above);
    return undefined;
  }

  // weight > 500
  const above = remaining.filter((f) => f.weight >= weight).reduce(minByWeight, undefined);
  if (above) return set.indexOf(above);
  const below = remaining.filter((f) => f.weight < weight).reduce(maxByWeight, undefined);
  if (below) return set.indexOf(below);
  return undefined;
}

/** The oblique angle of a face, or undefined when it is not oblique. */
function obliqueAngle(f: FontInfo): number | undefined {
  return f.style === 'oblique' ? DEFAULT_OBLIQUE_ANGLE : undefined;
}

/** The face with the smallest weight, or undefined. */
function minByWeight(best: FontInfo | undefined, f: FontInfo): FontInfo {
  return best === undefined || f.weight < best.weight ? f : best;
}

/** The face with the largest weight, or undefined. */
function maxByWeight(best: FontInfo | undefined, f: FontInfo): FontInfo {
  return best === undefined || f.weight > best.weight ? f : best;
}

/**
 * The oblique face whose angle is closest to the request, in CSS's order:
 * the smallest at-or-above, else the largest below.
 */
function closestOblique(
  remaining: readonly FontInfo[],
  oblique: ReadonlyArray<{ i: number; angle: number }>,
  target: number | undefined,
): FontStyleKind | undefined {
  void remaining;
  if (oblique.length === 0) return undefined;
  if (target === undefined) {
    const any = oblique[0]!.i;
    return remaining[any]?.style;
  }
  const atOrAbove = oblique
    .filter((o) => o.angle >= target)
    .reduce((b: number | undefined, o) => (b === undefined || o.angle < b ? o.angle : b), undefined);
  if (atOrAbove !== undefined) {
    const found = oblique.find((o) => o.angle === atOrAbove)!;
    return remaining[found.i]?.style;
  }
  const below = oblique
    .filter((o) => o.angle < target)
    .reduce((b: number | undefined, o) => (b === undefined || o.angle > b ? o.angle : b), undefined);
  if (below === undefined) return undefined;
  const found = oblique.find((o) => o.angle === below)!;
  return remaining[found.i]?.style;
}

/** Every index tied with the winner, as upstream's `match_fonts` returns. */
export function matchFonts(
  set: readonly FontInfo[],
  width: number,
  style: FontStyleKind,
  weight: number,
  synthesizeStyle: boolean,
): number[] {
  if (set.length === 0) return [];
  const first = matchFont(set, width, style, weight, synthesizeStyle);
  if (first === undefined) return [];
  const best = set[first]!;
  const out: number[] = [];
  for (let i = 0; i < set.length; i++) {
    const f = set[i]!;
    if (f.weight === best.weight && f.style === best.style && f.width === best.width) out.push(i);
  }
  return out;
}

/** A family: its name and the faces registered under it. */
export interface FamilyInfo {
  readonly name: string;
  readonly fonts: FontInfo[];
}

/** The generic families to substitute when CSS asks for one. */
export type GenericFamilyMap = Partial<Record<GenericFamily, string>>;

/** The fallbacks to consult when nothing else matches a script. */
export type FallbackMap = Partial<Record<FallbackKey, string[]>>;

/** The default generic families, mirroring fontique's built-ins. */
export const DEFAULT_GENERIC_FAMILIES: GenericFamilyMap = {
  serif: 'serif',
  'sans-serif': 'sans-serif',
  monospace: 'monospace',
  cursive: 'cursive',
  fantasy: 'fantasy',
  'system-ui': 'sans-serif',
  'ui-serif': 'serif',
  'ui-sans-serif': 'sans-serif',
  'ui-monospace': 'monospace',
  'ui-rounded': 'sans-serif',
  math: 'serif',
  emoji: 'emoji',
  fangsong: 'serif',
};

/** Stores fonts and answers queries, as `fontique::Collection`. */
export class Collection {
  private readonly families = new Map<string, FontInfo[]>();
  private readonly generic: GenericFamilyMap = { ...DEFAULT_GENERIC_FAMILIES };
  private fallbacks: FallbackMap = {};

  constructor(_options: CollectionOptions = {}) {}

  /** Registers one face. Returns the family it landed in. */
  register(info: FontInfo): string {
    const bucket = this.families.get(info.family);
    if (bucket) bucket.push(info);
    else this.families.set(info.family, [info]);
    return info.family;
  }

  /** Registers raw font bytes, inferring attributes. */
  registerFonts(data: Uint8Array, familyHint?: string): string | undefined {
    const info = loadFontInfo(data, familyHint);
    return info ? this.register(info) : undefined;
  }

  /** Removes every registered font. */
  clear(): void {
    this.families.clear();
  }

  /** Every family name known to the collection. */
  familyNames(): string[] {
    return [...this.families.keys()];
  }

  /** The faces of a family by name. */
  familyByName(name: string): FontInfo[] | undefined {
    return this.families.get(name);
  }

  /** Every face in the collection, in registration order. */
  allFonts(): FontInfo[] {
    const out: FontInfo[] = [];
    for (const list of this.families.values()) out.push(...list);
    return out;
  }

  /** The configured generic family substitutions. */
  genericFamilyMap(): GenericFamilyMap {
    return { ...this.generic };
  }

  /** Sets one generic family substitution. */
  setGenericFamily(which: GenericFamily, family: string): void {
    this.generic[which] = family;
  }

  /** The configured fallbacks. */
  fallbackFamilies(): FallbackMap {
    return { ...this.fallbacks };
  }

  /** Sets the fallbacks for a script key. */
  setFallbacks(key: FallbackKey, families: readonly string[]): void {
    this.fallbacks[key] = [...families];
  }

  /** Appends fallbacks for a script key. */
  appendFallbacks(key: FallbackKey, families: readonly string[]): void {
    this.fallbacks[key] = [...(this.fallbacks[key] ?? []), ...families];
  }

  /**
   * Starts a query.
   *
   * `setFamilies` and `setAttributes` mirror upstream; `matches_with` walks the
   * candidates and `first_available_font` returns the first non-`not-found`
   * result, which is what a font stack lookup needs.
   */
  query(families: readonly string[] = [], attributes: QueryAttributes = {}): Query {
    return new Query(this, families, attributes);
  }
}

/** A font query, as `fontique::Query`. */
export class Query {
  private families: string[];
  private attributes: QueryAttributes;

  constructor(
    private readonly collection: Collection,
    families: readonly string[],
    attributes: QueryAttributes,
  ) {
    this.families = [...families];
    this.attributes = { ...attributes };
  }

  /** Sets the family stack to search, most preferred first. */
  setFamilies(families: readonly string[]): this {
    this.families = [...families];
    return this;
  }

  /** Sets the requested attributes. */
  setAttributes(attributes: QueryAttributes): this {
    this.attributes = { ...attributes };
    return this;
  }

  /** Sets the fallback script key. */
  setFallbacks(key: FallbackKey): this {
    this.fallbackKey = key;
    return this;
  }

  private fallbackKey: FallbackKey = '';

  /**
   * Runs the query, invoking `f` for each candidate.
   *
   * Mirrors `matches_with`: the family stack is searched in order, then
   * fallbacks, and the first `found` or `synthesize` ends it.
   */
  matchesWith(f: (font: QueryFont) => QueryStatus): QueryFont | undefined {
    for (const name of this.candidates()) {
      const font = this.matchIn(name);
      if (!font) continue;
      const status = f(font);
      if (status !== 'not-found') return font;
    }
    return undefined;
  }

  /**
   * The first font the query offers.
   *
   * Upstream returns the first font regardless of whether its attributes match,
   * with `QueryStatus::Stop` ending the walk. A port that filtered by weight
   * here would return nothing for an unmatched request, where upstream returns
   * the nearest face.
   */
  firstAvailableFont(): QueryFont | undefined {
    let first: QueryFont | undefined;
    for (const name of this.candidates()) {
      first = this.matchIn(name);
      if (first) return first;
    }
    return first;
  }

  /** Matches within one family. */
  private matchIn(name: string): QueryFont | undefined {
    const set = this.collection.familyByName(name);
    if (!set || set.length === 0) return undefined;
    const index = matchFont(
      set,
      this.attributes.width ?? 1,
      this.attributes.style ?? 'normal',
      this.attributes.weight ?? 400,
      false,
    );
    if (index === undefined) return undefined;
    const info = set[index]!;
    return { info, family: name, weight: info.weight, width: info.width, style: info.style };
  }

  /**
   * Every family the query will try, in order.
   *
   * The requested stack first, then the configured fallbacks for the current
   * key. When neither yields anything the first registered font is offered, so
   * a query always produces something to draw — a port convenience, since
   * upstream relies on an OS backend having populated the collection.
   */
  private candidates(): string[] {
    const out: string[] = [];
    const push = (names: readonly string[]): void => {
      for (const n of names) if (!out.includes(n)) out.push(n);
    };

    push(this.expandFamilies());
    push(this.collection.fallbackFamilies()[this.fallbackKey] ?? []);
    push(this.collection.familyNames());
    return out;
  }

  /**
   * Expands generic family names into their configured substitutions.
   *
   * A name that is not a generic family is passed through unchanged, which is
   * what lets a caller mix `'sans-serif'` and `'My Font'` in one stack.
   */
  private expandFamilies(): string[] {
    const out: string[] = [];
    for (const name of this.families) {
      if (isGenericFamily(name)) {
        const sub = this.collection.genericFamilyMap()[name];
        if (sub !== undefined && !out.includes(sub)) out.push(sub);
      } else if (!out.includes(name)) {
        out.push(name);
      }
    }
    return out;
  }
}

/** Whether a name is one of CSS's generic family keywords. */
export function isGenericFamily(name: string): name is GenericFamily {
  return name in DEFAULT_GENERIC_FAMILIES;
}

/** Upstream `Collection::load_system_fonts`, using directory scanning. */
export function loadSystemFonts(collection: Collection, dirs: readonly string[]): number {
  let n = 0;
  for (const d of dirs) {
    try {
      if (statSync(d).isDirectory()) n += registerDirectory(collection, d);
    } catch {
      // A missing directory is skipped, as fontique's backends do.
    }
  }
  return n;
}
