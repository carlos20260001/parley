// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Generic families, replacing `fontique::generic`.
 *
 * CSS's generic family keywords, plus the mapping from each to a concrete
 * installed family. fontique keeps the built-in map and lets a backend or an
 * application override entries; the port does the same, with a Node-friendly
 * default of "generic names resolve to themselves", i.e. to whatever family
 * was registered under that name.
 */

/**
 * The generic family names CSS defines.
 *
 * A superset of `style/`'s `GenericFamily`, which only lists the families a
 * style can *request*. fontique also has to recognise the `ui-*` aliases and
 * CSS-wide keywords because it maps them, so it carries the full set under
 * its own name.
 */
export type CssGenericFamily =
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

/** The generic families to substitute when CSS asks for one. */
export type CssGenericFamilyMap = Partial<Record<CssGenericFamily, string>>;

/** The default generic families, mirroring fontique's built-ins. */
export const DEFAULT_GENERIC_FAMILIES: CssGenericFamilyMap = {
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

/** Whether a name is one of CSS's generic family keywords. */
export function isGenericFamily(name: string): name is CssGenericFamily {
  return name in DEFAULT_GENERIC_FAMILIES;
}
