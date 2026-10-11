// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Script fallback, replacing `fontique::fallback`.
 *
 * Upstream keys fallback families by script (plus a few special keys) and
 * consults them when nothing in the requested family stack covers the script
 * being laid out. The port keeps the key as a plain script tag string: the
 * same tag HarfBuzz and `unicode.ts` already use.
 */

/** A script tag used as a fallback key. */
export type FallbackKey = string;

/** The fallbacks to consult when nothing else matches a script. */
export type FallbackMap = Partial<Record<FallbackKey, string[]>>;
