// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Font queries, replacing `fontique::collection::query`.
 *
 * Upstream `Query` is built by `Collection::query` and carries a family stack
 * plus requested attributes. `matches_with` walks the candidates in order and
 * stops at the first one the callback does not reject, which is how parley
 * asks "which of these families has a face for this style".
 */

import type { FontStyleKind } from '../attributes.js';
import type { FallbackKey } from '../fallback.js';
import { isGenericFamily } from '../generic.js';
import { matchFont } from '../matching.js';
import type { FontInfo } from '../font.js';
import type { Collection } from './mod.js';

/** What the caller wants, as upstream `Attributes`. */
export interface QueryAttributes {
  weight?: number;
  width?: number;
  style?: FontStyleKind;
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

/** A font query, as `fontique::Query`. */
export class Query {
  private families: string[];
  private attributes: QueryAttributes;
  private fallbackKey: FallbackKey = '';

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
    const generics = this.collection.genericFamilyMap();
    for (const name of this.families) {
      if (isGenericFamily(name)) {
        const sub = generics[name];
        if (sub !== undefined && !out.includes(sub)) out.push(sub);
      } else if (!out.includes(name)) {
        out.push(name);
      }
    }
    return out;
  }
}
