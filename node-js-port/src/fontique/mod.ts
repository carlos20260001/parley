// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * A TypeScript port of `fontique`.
 *
 * `fontique` is upstream's font discovery and matching crate: it enumerates
 * fonts, groups them into families, and picks the best face for a requested
 * family + weight + width + style. It is what `parley::FontContext` sits on.
 *
 * The module tree mirrors the crate:
 *
 *  - `attributes.ts` → `attributes.rs`
 *  - `font.ts`       → `font.rs`
 *  - `generic.ts`    → `generic.rs`
 *  - `fallback.ts`   → `fallback.rs`
 *  - `matching.ts`   → `matching.rs`
 *  - `scan.ts`       → `scan.rs`
 *  - `collection/`   → `collection/{mod,query}.rs`
 *
 * ## Scope of this port
 *
 * Ported faithfully, because matching is observable behaviour:
 *  - `Collection`: register, families, generic families, fallbacks, query.
 *  - `Query`: family set, attributes, fallback key, `matchesWith`,
 *    `firstAvailableFont`.
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
 *
 * `charmap.rs`, `family.rs` and `source.rs` are the backends' plumbing; the
 * port's `Collection` stores families in a plain map, so they have no
 * counterpart.
 */

export {
  DEFAULT_OBLIQUE_ANGLE,
  isOblique,
  widthClassToRatio,
  type Attributes,
  type FontStyleKind,
} from './attributes.js';

export { loadFontInfo, type FontInfo } from './font.js';

export {
  DEFAULT_GENERIC_FAMILIES,
  isGenericFamily,
  type CssGenericFamily,
  type CssGenericFamilyMap,
} from './generic.js';

export type { FallbackKey, FallbackMap } from './fallback.js';

export { matchFont, matchFonts } from './matching.js';

export {
  isFontPath,
  loadSystemFonts,
  registerDirectory,
  scanDirectory,
} from './scan.js';

export { Collection, type CollectionOptions } from './collection/mod.js';
export { Query, type QueryAttributes, type QueryFont, type QueryStatus } from './collection/query.js';
