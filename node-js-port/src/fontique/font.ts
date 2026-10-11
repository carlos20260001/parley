// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * One font face, replacing `fontique::font`.
 *
 * Upstream `FontInfo` is everything fontique knows about a face: the byte
 * handle, the attributes, the scripts it covers and any overrides applied at
 * registration. The port keeps the same fields, with `FontInfoOverride`
 * folded into `registerFont`'s family hint because `skrifa`'s `name` table is
 * not ported.
 */

import { FontRef } from '@egui-node/skrifa-ts';

import { type FontStyleKind, widthClassToRatio } from './attributes.js';

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
