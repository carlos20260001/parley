// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * Font discovery, replacing `fontique::scan` and the collection's
 * `register_fonts` entry points.
 *
 * Upstream scans the host's font directories through one of four OS backends
 * (`fontconfig`, `dwrite`, `coretext`, `android`). A Node process has no
 * portable equivalent, so the port scans directories with `node:fs`, which is
 * the same job with the platform APIs replaced.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Collection } from './collection/mod.js';
import { loadFontInfo } from './font.js';

const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'];

/** Whether a path looks like a font file. */
export function isFontPath(path: string): boolean {
  const lower = path.toLowerCase();
  return FONT_EXTENSIONS.some((ext) => lower.endsWith(ext));
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

/** Whether a path is a directory that can be scanned. */
function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
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
      const info = loadFontInfo(new Uint8Array(readFileSync(p)), familyHintFor(p));
      if (info) {
        collection.register(info);
        n++;
      }
    } catch {
      // A file that cannot be read or parsed is skipped rather than failing
      // the scan, which is what fontique's source cache does.
    }
  }
  return n;
}

/** Upstream `Collection::load_system_fonts`, using directory scanning. */
export function loadSystemFonts(collection: Collection, dirs: readonly string[]): number {
  let n = 0;
  for (const d of dirs) {
    // A missing directory is skipped, as fontique's backends do.
    if (isDirectory(d)) n += registerDirectory(collection, d);
  }
  return n;
}
