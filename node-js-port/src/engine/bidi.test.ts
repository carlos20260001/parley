import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { Analyzer, bidiClassOf, pairedBracketOf } from './analysis.js';
import { FontContext } from '../font.js';
import { LayoutContext } from '../context.js';
import { FontFamily } from '../style/mod.js';

const analyze = (text: string, dir: 'auto' | 'ltr' | 'rtl' = 'auto') =>
  new Analyzer().analyze(text, dir);

describe('bidi class derivation', () => {
  it('classifies the strong, number and neutral classes exactly', () => {
    expect(bidiClassOf('a')).toBe('L');
    expect(bidiClassOf('1')).toBe('EN');
    expect(bidiClassOf(' ')).toBe('WS');
    expect(bidiClassOf('م')).toBe('AL'); // Arabic letter
    expect(bidiClassOf('ש')).toBe('R'); // Hebrew letter
    expect(bidiClassOf('ة')).toBe('AL');
    expect(bidiClassOf('\u0665')).toBe('AN'); // Arabic-Indic digit ٥
    expect(bidiClassOf(',')).toBe('CS');
    expect(bidiClassOf('$')).toBe('ET');
    expect(bidiClassOf('(')).toBe('ON');
  });

  it('classifies the explicit directional codes by codepoint', () => {
    expect(bidiClassOf('\u202a')).toBe('LRE');
    expect(bidiClassOf('\u202b')).toBe('RLE');
    expect(bidiClassOf('\u202c')).toBe('PDF');
    expect(bidiClassOf('\u202d')).toBe('LRO');
    expect(bidiClassOf('\u202e')).toBe('RLO');
    expect(bidiClassOf('\u2066')).toBe('LRI');
    expect(bidiClassOf('\u2067')).toBe('RLI');
    expect(bidiClassOf('\u2068')).toBe('FSI');
    expect(bidiClassOf('\u2069')).toBe('PDI');
  });

  it('reports paired brackets with their mirror', () => {
    expect(pairedBracketOf('(')).toEqual({ paired: 'open', mirror: ')' });
    expect(pairedBracketOf(')')).toMatchObject({ paired: 'close' });
    expect(pairedBracketOf('\u3008')).toEqual({ paired: 'open', mirror: '\u3009' });
    expect(pairedBracketOf('a')).toEqual({ paired: 'none', mirror: undefined });
  });
});

describe('bidi level resolution', () => {
  it('gives an all-LTR paragraph level 0 and empty levels', () => {
    const a = analyze('hello world');
    expect(a.paragraphLevel).toBe(0);
    // Every level 0 (the fast path fills zeros, not a reordering-relevant run).
    expect(a.levels.every((l) => l === 0)).toBe(true);
  });

  it('embeds a mid-sentence RTL word between two LTR words', () => {
    // abc<Arabic مدة>def with an LTR base (first strong is 'a').
    const a = analyze('abc\u0645\u062f\u0629def');
    expect(a.paragraphLevel).toBe(0);
    expect(a.levels).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0]);
  });

  it('makes an all-RTL paragraph level 1', () => {
    const a = analyze('\u0645\u0631\u062d\u0628\u0627'); // "مرحبا"
    expect(a.paragraphLevel).toBe(1);
    expect(a.levels.every((l) => l === 1)).toBe(true);
  });

  it('keeps a trailing number LTR inside an RTL paragraph', () => {
    // שלום 123 : Hebrew (R), space (WS), ASCII digits (EN).
    const a = analyze('\u05e9\u05dc\u05d5\u05dd 123');
    expect(a.paragraphLevel).toBe(1);
    expect(a.levels).toEqual([1, 1, 1, 1, 1, 2, 2, 2]);
  });

  it('honours an explicit base direction over the first strong character', () => {
    const auto = analyze('\u0645\u0631\u062d\u0628\u0627 hello');
    const ltr = analyze('\u0645\u0631\u062d\u0628\u0627 hello', 'ltr');
    expect(auto.paragraphLevel).toBe(1); // first strong is Arabic
    expect(ltr.paragraphLevel).toBe(0); // explicit LTR wins
  });

  it('resolves numbers as LTR within an explicit RTL paragraph', () => {
    // Mirrors parley_engine's analyzer test.
    const text = '123 / 456';
    const rtl = analyze(text, 'rtl');
    expect(rtl.paragraphLevel).toBe(1);
    expect(rtl.levels.length).toBe(text.length);
    for (let i = 0; i < text.length; i++) {
      if (/\d/.test(text[i]!)) expect(rtl.levels[i]! % 2).toBe(0); // even === LTR
    }
    expect(rtl.levels.some((l) => l % 2 === 1)).toBe(true);
  });

  it('keeps an inner LTR isolate one level deeper than its RTL wrapper', () => {
    // a<RLI> b <PDI> c  →  'b' isolates at the next even level (2).
    const a = analyze('a\u2067b\u2069c');
    expect(a.paragraphLevel).toBe(0);
    expect(a.levels).toEqual([0, 0, 2, 0, 0]);
  });

  it('isolates Hebrew at an RTL level inside an LTR paragraph', () => {
    // <RLI><Hebrew אב><PDI> in an LTR paragraph: the Hebrew run is RTL.
    const a = analyze('\u2067\u05d0\u05d1\u2069');
    expect(a.paragraphLevel).toBe(0);
    expect(a.levels).toEqual([0, 1, 1, 0]);
  });

  it('nests an LTR embedding inside an RTL isolate', () => {
    // abc<RLI>أبج def<PDI>ghi: the isolate is level 1, and the Latin inside it
    // is an even level *deeper* than the isolate that contains it.
    const a = analyze('abc\u2067\u0623\u0628\u062c def\u2069ghi');
    expect(a.paragraphLevel).toBe(0);
    expect(a.levels).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 0, 0, 0, 0]);
  });

  it('nests an RTL embedding inside an LTR paragraph', () => {
    // abc<RLE>مدة def<PDF>ghi: the embedding is level 1 and the Latin inside
    // it is level 2.
    const a = analyze('abc\u202b\u0645\u062f\u0629 def\u202cghi');
    expect(a.paragraphLevel).toBe(0);
    expect(a.levels).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0]);
  });

  it('applies an LTR override to everything it wraps (X6)', () => {
    const a = analyze('a\u202dbcd\u202ce');
    expect(a.levels).toEqual([0, 0, 2, 2, 2, 2, 0]);
  });

  it('applies an RTL override to everything it wraps (X7)', () => {
    const a = analyze('a\u202ecde\u202cf');
    expect(a.levels).toEqual([0, 0, 1, 1, 1, 1, 0]);
  });

  it('resolves bracket pairs by the text between them (N0)', () => {
    // `x (hebrew) y` in an LTR paragraph: the brackets are neutral by class but
    // N0 resolves them to the direction of the text they enclose, so only the
    // Hebrew ends up right-to-left.
    const a = analyze('x (\u05d0\u05d1) y');
    expect(a.levels).toEqual([0, 0, 0, 1, 1, 0, 0, 0]);
  });

  it('resolves brackets the same way in an RTL paragraph', () => {
    // שלום (אבג) in an RTL paragraph: N0 resolves the brackets to R too.
    const a = analyze('\u05e9\u05dc\u05d5\u05dd (\u05d0\u05d1\u05d2)');
    expect(a.paragraphLevel).toBe(1);
    expect(a.levels).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('resolves Arabic-Indic digits to their own even level (AN)', () => {
    const a = analyze('a\u0661\u0662b');
    expect(a.levels).toEqual([0, 2, 2, 0]);
  });

  it('follows previous strong type for a combining mark (W1)', () => {
    // Hebrew + hiriq (NSM): the mark takes the preceding strong type.
    const a = analyze('\u05e9\u0650\u05dc');
    expect(a.levels).toEqual([1, 1, 1]);
  });

  it('levels characters the fast path cannot skip', () => {
    // All-EN/WS text has no bidi-relevant class and an LTR base, so upstream
    // takes the fast path and produces an all-zero level array.
    expect(analyze('123 / 456').levels).toEqual([]);
  });
});

/** A real font as the single shaping target; Latin + digit coverage. */
const FONT = readFileSync(new URL('../../testdata/SourceSansPro-Regular.otf', import.meta.url));
const makeCtx = async (): Promise<FontContext> => {
  const ctx = await FontContext.new();
  ctx.registerFont(new Uint8Array(FONT), 'Source Sans Pro');
  return ctx;
};

/** The sequence of cluster (source) indices of a line's glyphs, left-to-right. */
function visualClusters(ctx: FontContext, text: string, base?: 'auto' | 'ltr' | 'rtl'): number[] {
  const b = new LayoutContext().rangedBuilder(ctx);
  if (base) b.set_base_direction(base);
  b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
  const layout = b.build(text);
  return layout.lines[0]!.glyphs.map((g) => g.cluster);
}

describe('bidi visual order (end to end)', () => {
  it('reverses the RTL word while keeping its slot between the LTR words', async () => {
    const ctx = await makeCtx();
    // abc<مدة>def: 'مدة' (clusters 3,4,5) reads right-to-left → 5,4,3 on screen.
    expect(visualClusters(ctx, 'abc\u0645\u062f\u0629def')).toEqual([0, 1, 2, 5, 4, 3, 6, 7, 8]);
  });

  it('puts a trailing number first in an all-RTL paragraph', async () => {
    const ctx = await makeCtx();
    // שלום 123 : the number (5,6,7) sits left of the Hebrew word (גרס reversed).
    expect(visualClusters(ctx, '\u05e9\u05dc\u05d5\u05dd 123')).toEqual([5, 6, 7, 4, 3, 2, 1, 0]);
  });

  it('honours set_base_direction: an LTR word stays LTR inside an RTL paragraph', async () => {
    const ctx = await makeCtx();
    // 'english' forced into an RTL paragraph: levels are even (LTR), so its
    // glyphs keep logical order, but the paragraph itself is right-to-left.
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    b.set_base_direction('rtl');
    const layout = b.build('english');
    expect(layout.is_rtl()).toBe(true);
    expect(layout.lines[0]!.glyphs.map((g) => g.cluster)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps pure Latin text in logical order', async () => {
    const ctx = await makeCtx();
    expect(visualClusters(ctx, 'hello')).toEqual([0, 1, 2, 3, 4]);
  });

  it('reverses an RTL isolate that wraps Latin inside an LTR paragraph', async () => {
    const ctx = await makeCtx();
    // abc<RLI>أبج def<PDI>ghi. The isolate is one level deep, so the paragraph
    // reads: abc | def | space | reversed(أبج) | ghi.
    expect(visualClusters(ctx, 'abc\u2067\u0623\u0628\u062c def\u2069ghi')).toEqual([
      0, 1, 2, 3, 8, 9, 10, 7, 6, 5, 4, 11, 12, 13, 14,
    ]);
  });

  it('reverses an RTL embedding that wraps Latin inside an LTR paragraph', async () => {
    const ctx = await makeCtx();
    // abc<RLE>مدة def<PDF>ghi. The embedding's Latin is one level deeper still,
    // so `def` keeps its own order inside the reversed embedding.
    expect(visualClusters(ctx, 'abc\u202b\u0645\u062f\u0629 def\u202cghi')).toEqual([
      0, 1, 2, 3, 8, 9, 10, 11, 7, 6, 5, 4, 12, 13, 14,
    ]);
  });

  it('resolves brackets before reordering a line', async () => {
    const ctx = await makeCtx();
    // שלום (אבג) 123 in an RTL paragraph. N0 makes the brackets R, and the
    // digits end up left of everything.
    expect(visualClusters(ctx, '\u05e9\u05dc\u05d5\u05dd (\u05d0\u05d1\u05d2) 123')).toEqual([
      11, 12, 13, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
  });

  it('reorders runs on both sides of an LTR word in an RTL paragraph', async () => {
    const ctx = await makeCtx();
    // مرحبا hello العالم: the Arabic words flip, `hello` does not.
    expect(visualClusters(ctx, '\u0645\u0631\u062d\u0628\u0627 hello \u0627\u0644\u0639\u0627\u0644\u0645')).toEqual([
      17, 16, 15, 14, 13, 12, 11, 6, 7, 8, 9, 10, 5, 4, 3, 2, 1, 0,
    ]);
  });

  it('reorders multiple lines independently', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    const layout = b.build('abc\u0645\u062f\u0629def\n\u05e9\u05dc\u05d5\u05dd 123', 1000);
    expect(layout.lines.length).toBe(2);
    // Line 1: an LTR paragraph, so only the Arabic word reverses. The paragraph
    // separator terminates the line it sits on.
    expect(layout.lines[0]!.glyphs.map((g) => g.cluster)).toEqual([0, 1, 2, 5, 4, 3, 6, 7, 8, 9]);
    // Line 2: an RTL paragraph, so the whole line reverses and the digits come
    // first.
    expect(layout.lines[1]!.glyphs.map((g) => g.cluster)).toEqual([15, 16, 17, 14, 13, 12, 11, 10]);
  });
});
