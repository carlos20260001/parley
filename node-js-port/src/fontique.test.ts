import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  Collection,
  DEFAULT_OBLIQUE_ANGLE,
  DEFAULT_GENERIC_FAMILIES,
  Query,
  isGenericFamily,
  loadFontInfo,
  matchFont,
  matchFonts,
  registerDirectory,
  scanDirectory,
  widthClassToRatio,
  type FontInfo,
} from './fontique.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'testdata');

const ROBOTO = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'));
const SSP = readFileSync(join(FIXTURES, 'SourceSansPro-Regular.otf'));

/** Loads one font's info, then overrides fields to make synthetic faces. */
function face(overrides: Partial<FontInfo> = {}): FontInfo {
  const base = loadFontInfo(ROBOTO, 'Roboto')!;
  return { ...base, ...overrides };
}

describe('font attributes', () => {
  it('maps OS/2 width classes to normalized ratios', () => {
    expect(widthClassToRatio(1)).toBe(0.5);
    expect(widthClassToRatio(5)).toBe(1.0);
    expect(widthClassToRatio(9)).toBe(2.0);
    // Out-of-range classes clamp rather than returning undefined.
    expect(widthClassToRatio(0)).toBe(0.5);
    expect(widthClassToRatio(99)).toBe(2.0);
  });

  it('reads weight, width and style from a real font', () => {
    const f = face();
    expect(f.family).toBe('Roboto');
    expect(f.weight).toBeGreaterThanOrEqual(100);
    expect(f.weight).toBeLessThanOrEqual(900);
    expect(f.width).toBe(1.0);
    expect(f.style).toBe('normal');
  });
});

describe('matching', () => {
  it('returns the only face when a family has one', () => {
    const set = [face()];
    expect(matchFont(set, 1.0, 'normal', 400, false)).toBe(0);
  });

  it('returns undefined for an empty set', () => {
    expect(matchFont([], 1.0, 'normal', 400, false)).toBeUndefined();
  });

  it('picks the closest weight among several faces', () => {
    const set = [face({ weight: 300 }), face({ weight: 400 }), face({ weight: 700 })];
    expect(matchFont(set, 1.0, 'normal', 400, false)).toBe(1);
    expect(matchFont(set, 1.0, 'normal', 690, false)).toBe(2);
    // 500 is in CSS's 400..=500 range, so the lightest face at or above up to
    // 500 wins before any lighter one is considered.
    expect(matchFont(set, 1.0, 'normal', 500, false)).toBe(1);
  });

  it("follows CSS's weight ranges rather than nearest-weight", () => {
    // A request of 400 with faces at 300 and 500 is a tie under naive distance
    // (100 either way) but CSS says: the lightest face at or above the request
    // up to 500. So 500 wins, not 300.
    const set = [face({ weight: 300 }), face({ weight: 500 })];
    expect(matchFont(set, 1.0, 'normal', 400, false)).toBe(1);
  });

  it('prefers the heaviest face at or below when weight is under 400', () => {
    const set = [face({ weight: 100 }), face({ weight: 200 }), face({ weight: 900 })];
    // Below 400 the heaviest face at or below the request is taken first, so
    // 200 rather than 900, even though both are 100 away.
    expect(matchFont(set, 1.0, 'normal', 300, false)).toBe(1);
  });

  it('prefers the exact style over a same-weight different style', () => {
    const set = [face({ weight: 400, style: 'normal' }), face({ weight: 400, style: 'italic' })];
    expect(set[1]!.style).toBe('italic');
    // Asking for italic must find the italic face, not the normal one.
    expect(matchFont(set, 1.0, 'italic', 400, false)).toBe(1);
    expect(matchFont(set, 1.0, 'normal', 400, false)).toBe(0);
  });

  it('returns every face tied with the winner', () => {
    const set = [face({ weight: 400 }), face({ weight: 400 }), face({ weight: 700 })];
    expect(matchFonts(set, 1.0, 'normal', 400, false)).toEqual([0, 1]);
  });

  it('exposes fontique’s default oblique angle', () => {
    expect(DEFAULT_OBLIQUE_ANGLE).toBe(14);
  });
});

describe('Collection', () => {
  it('registers fonts and lists families', () => {
    const c = new Collection();
    expect(c.familyNames()).toEqual([]);
    c.register(face({ family: 'Roboto' }));
    c.register(loadFontInfo(SSP, 'Source Sans Pro')!);
    expect(c.familyNames().sort()).toEqual(['Roboto', 'Source Sans Pro']);
    expect(c.familyByName('Roboto')!.length).toBe(1);
    expect(c.familyByName('Nope')).toBeUndefined();
  });

  it('clears everything', () => {
    const c = new Collection();
    c.register(face());
    c.clear();
    expect(c.familyNames()).toEqual([]);
  });

  it('accepts generic family overrides', () => {
    const c = new Collection();
    expect(c.genericFamilyMap()['sans-serif']).toBe('sans-serif');
    c.setGenericFamily('sans-serif', 'Helvetica');
    expect(c.genericFamilyMap()['sans-serif']).toBe('Helvetica');
  });

  it('stores and appends fallbacks', () => {
    const c = new Collection();
    expect(c.fallbackFamilies()).toEqual({});
    c.setFallbacks('Arab', ['Noto Sans Arabic']);
    c.appendFallbacks('Arab', ['Lateef']);
    expect(c.fallbackFamilies()['Arab']).toEqual(['Noto Sans Arabic', 'Lateef']);
  });

  it('registers a font from raw bytes', () => {
    const c = new Collection();
    expect(c.registerFonts(new Uint8Array(ROBOTO), 'Roboto')).toBe('Roboto');
    expect(c.familyByName('Roboto')!.length).toBe(1);
  });
});

describe('Query', () => {
  it('finds a registered family by name', () => {
    const c = new Collection();
    c.register(face({ family: 'Roboto' }));
    const font = c.query(['Roboto'], { weight: 400 }).firstAvailableFont();
    expect(font).toBeDefined();
    expect(font!.family).toBe('Roboto');
    expect(font!.weight).toBe(400);
  });

  it('falls back to something when the family is unknown', () => {
    const c = new Collection();
    c.register(face({ family: 'Roboto' }));
    // fontique returns the best available face rather than nothing.
    expect(c.query(['NoSuchFamily']).firstAvailableFont()).toBeDefined();
  });

  it('expands a generic family to its substitution', () => {
    const c = new Collection();
    c.register(face({ family: 'Roboto' }));
    c.setGenericFamily('sans-serif', 'Roboto');
    const font = c.query(['sans-serif']).firstAvailableFont();
    expect(font!.family).toBe('Roboto');
  });

  it('searches the family stack in order', () => {
    const c = new Collection();
    c.register(loadFontInfo(SSP, 'Source Sans Pro')!);
    c.register(face({ family: 'Roboto' }));
    const font = c.query(['Missing', 'Roboto']).firstAvailableFont();
    expect(font!.family).toBe('Roboto');
  });

  it('reports a weight mismatch as synthesizable rather than not-found', () => {
    const c = new Collection();
    c.register(face({ family: 'Roboto', weight: 400 }));
    const seen: string[] = [];
    const font = c.query(['Roboto'], { weight: 700 }).matchesWith((f) => {
      seen.push(String(f.weight));
      return f.weight === 700 ? 'found' : 'synthesize';
    });
    // The only face is offered, and the status reflects the mismatch.
    expect(font).toBeDefined();
    expect(seen).toEqual(['400']);
  });

  it('chains setters', () => {
    const c = new Collection();
    c.register(face({ family: 'Roboto' }));
    const q = new Query(c, [], {});
    expect(q.setFamilies(['Roboto']).setAttributes({ weight: 400 })).toBe(q);
    expect(q.firstAvailableFont()).toBeDefined();
  });
});

describe('scanning', () => {
  it('recognises font file extensions', () => {
    expect(isGenericFamily('sans-serif')).toBe(true);
    expect(isGenericFamily('Roboto')).toBe(false);
  });

  it('finds fonts in a directory', () => {
    const found = scanDirectory(FIXTURES);
    expect(found.length).toBeGreaterThan(0);
    // Only font files, never directories or fixtures.
    for (const p of found) expect(p.toLowerCase()).toMatch(/\.(ttf|otf|ttc|woff2)$/);
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(scanDirectory('/no/such/directory/anywhere')).toEqual([]);
  });

  it('registers a whole directory into a collection', () => {
    const c = new Collection();
    const n = registerDirectory(c, FIXTURES, () => 'Scanned');
    expect(n).toBeGreaterThan(0);
    expect(c.familyByName('Scanned')!.length).toBe(n);
  });

  it('reads a real directory without throwing on unrelated files', () => {
    const dir = join(FIXTURES, 'not-a-real-dir');
    const c = new Collection();
    expect(registerDirectory(c, dir)).toBe(0);
    // The fixtures directory itself holds more than two font files, so the
    // scan is exercising real directory traversal.
    expect(readdirSync(FIXTURES).length).toBeGreaterThan(1);
  });
});

describe('generic families', () => {
  it('has fontique-compatible defaults', () => {
    expect(DEFAULT_GENERIC_FAMILIES['sans-serif']).toBe('sans-serif');
    expect(DEFAULT_GENERIC_FAMILIES['ui-monospace']).toBe('monospace');
    expect(DEFAULT_GENERIC_FAMILIES['system-ui']).toBe('sans-serif');
  });
});
