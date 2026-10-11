// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * A font collection, replacing `fontique::collection::Collection`.
 *
 * Upstream owns a `SourceCache`, a family map and the generic/fallback maps,
 * and answers queries against all of them. The port keeps the same shape with
 * the source cache removed: the bytes are already held alongside each face by
 * `FontInfo`, so the shared store would only add indirection.
 */

import type { FallbackKey, FallbackMap } from '../fallback.js';
import {
  type CssGenericFamily,
  type CssGenericFamilyMap,
  DEFAULT_GENERIC_FAMILIES,
} from '../generic.js';
import { type FontInfo, loadFontInfo } from '../font.js';
import type { QueryAttributes } from './query.js';
import { Query } from './query.js';

/** Options for constructing a collection. */
export interface CollectionOptions {
  /** Whether to scan shared system font directories on `loadSystemFonts`. */
  readonly system?: boolean;
  /** Whether to scan user font directories. */
  readonly user?: boolean;
}

/** Stores fonts and answers queries, as `fontique::Collection`. */
export class Collection {
  private readonly families = new Map<string, FontInfo[]>();
  private readonly generic: CssGenericFamilyMap = { ...DEFAULT_GENERIC_FAMILIES };
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
  genericFamilyMap(): CssGenericFamilyMap {
    return { ...this.generic };
  }

  /** Sets one generic family substitution. */
  setGenericFamily(which: CssGenericFamily, family: string): void {
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
   * `setFamilies` and `setAttributes` mirror upstream; `matchesWith` walks the
   * candidates and `firstAvailableFont` returns the first non-`not-found`
   * result, which is what a font stack lookup needs.
   */
  query(families: readonly string[] = [], attributes: QueryAttributes = {}): Query {
    return new Query(this, families, attributes);
  }
}
