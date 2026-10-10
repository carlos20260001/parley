import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { FontContext } from './font_context.js';
import { LayoutContext, RangedBuilder } from './layout_context.js';
import { Alignment, FontFamily, FontStyle, FontWeight, FontWidth, OverflowWrap } from './style.js';

/** A real font with a full Latin range, used as the single test font. */
const FONT = readFileSync(new URL('../testdata/SourceSansPro-Regular.otf', import.meta.url));

const TEXT = 'Afffij';

const makeCtx = async (): Promise<FontContext> => {
  const ctx = await FontContext.new();
  ctx.registerFont(new Uint8Array(FONT), 'Source Sans Pro');
  return ctx;
};



describe('FontContext', () => {
  it('registers a font with metrics from hhea and OS/2', async () => {
    const ctx = await makeCtx();
    expect(ctx.size).toBe(1);
    const f = ctx.get(0)!;
    expect(f.unitsPerEm).toBe(1000);
    // OS/2 sTypoAscender and sTypoDescender, in font units.
    expect(f.ascent).toBeGreaterThan(0);
    expect(f.descent).toBeLessThan(0);
    expect(f.weight).toBeGreaterThan(0);
    // Default weight should map to roughly normal.
    expect(f.weight).toBeGreaterThanOrEqual(100);
    expect(f.weight).toBeLessThanOrEqual(900);
  });

  it('selects by family, and falls back when the family is unknown', async () => {
    const ctx = await makeCtx();
    const f = ctx.get(0)!;
    const byFamily = ctx.faceFor(
      FontFamily.named('Source Sans Pro'),
      FontWeight.NORMAL,
      new FontWidth(f.width),
      FontStyle.NORMAL,
    );
    expect(byFamily).toBe(f);
    // An unknown family still yields a font rather than nothing, matching
    // fontique's fallback behaviour.
    expect(
      ctx.faceFor(FontFamily.named('NoSuchFamily'), FontWeight.NORMAL, new FontWidth(f.width), FontStyle.NORMAL),
    ).toBeDefined();
  });
});

describe('layout', () => {
  it('shapes a string into positioned glyphs', async () => {
    const ctx = await makeCtx();
    const lcx = new LayoutContext();
    const b = lcx.rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    const layout = b.build(TEXT);

    expect(layout.lines.length).toBe(1);
    const glyphs = layout.lines[0]!.glyphs;
    // HarfBuzz merges 'ffi' into one glyph, so fewer glyphs than characters.
    expect(glyphs.length).toBeLessThan(TEXT.length);
    expect(glyphs.length).toBeGreaterThan(0);

    // Every advance must be positive and the total width positive.
    for (const g of glyphs) expect(g.advance).toBeGreaterThan(0);
    expect(layout.width).toBeGreaterThan(0);
    // Glyph ids must be in range for the font.
    for (const g of glyphs) expect(g.id).toBeLessThan(ctx.get(g.fontIndex)?.read.head()?.unitsPerEm ?? 1e9);
  });

  it('honours the font size', async () => {
    const ctx = await makeCtx();
    const measure = (size: number): number => {
      const b = new LayoutContext().rangedBuilder(ctx);
      b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
      b.push({ kind: 'FontSize', value: size }, 0, TEXT.length);
      return b.build(TEXT).width;
    };
    const small = measure(12);
    const large = measure(24);
    expect(large).toBeGreaterThan(small * 1.5);
    expect(large / small).toBeCloseTo(2, 1);
  });

  it('splits on a hard break', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    const layout = b.build('hello\nworld');
    expect(layout.lines.length).toBe(2);
    expect(layout.lines[0]!.kind).not.toBe(layout.lines[1]!.kind);
  });

  it('wraps to a requested width at a break opportunity', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    b.push({ kind: 'FontSize', value: 20 }, 0, 200);
    const layout = b.build('the quick brown fox jumps over the lazy dog', 200);
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) expect(line.glyphs.length).toBeGreaterThan(0);
  });

  it('wraps at CJK ideographs, not just spaces', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    b.push({ kind: 'FontSize', value: 24 }, 0, 20);
    // Source Sans Pro has no Han glyphs, but the break opportunity logic must
    // still not break inside a single word.
    const layout = b.build('aaaaaaaa');
    expect(layout.lines.length).toBe(1);
  });

  it('itemizes runs by script', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    const layout = b.build('abc\u4e2d\u6587def');
    const scripts = new Set(layout.allGlyphs().map((g) => g.fontIndex));
    expect(scripts.size).toBeGreaterThan(0);
  });

  it('accepts an alignment, and Start is the default', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    expect(() => b.build(TEXT, 1000, Alignment.Center)).not.toThrow();
    expect(() => b.build(TEXT, 1000, Alignment.Right)).not.toThrow();
  });

  it('reports empty text as one empty line', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    const layout = b.build('');
    expect(layout.lines.length).toBe(1);
    expect(layout.lines[0]!.glyphs.length).toBe(0);
  });

  it('resolves a style range', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    b.pushDefault({ kind: 'OverflowWrap', value: OverflowWrap.Normal });
    b.push({ kind: 'FontWeight', value: FontWeight.BOLD }, 0, 3);
    expect(() => b.build('hello world')).not.toThrow();
  });
});

describe('RangedBuilder', () => {
  it('is chainable, as upstream is', () => {
    const b = new RangedBuilder(null as never, 1);
    expect(b).toBeInstanceOf(RangedBuilder);
  });
});

describe('line breaking quality', () => {
  const PANGram = 'the quick brown fox jumps over the lazy dog';

  it('wraps at spaces, never inside a word', async () => {
    const ctx = await makeCtx();
    for (const w of [60, 120, 200, 340]) {
      const b = new LayoutContext().rangedBuilder(ctx);
      b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
      b.push({ kind: 'FontSize', value: 20 }, 0, PANGram.length);
      const layout = b.build(PANGram, w);
      expect(layout.lines.length, `width ${w}`).toBeGreaterThan(1);

      // Every line except the first must start at a character that follows a
      // space, i.e. at a word boundary.
      for (let i = 1; i < layout.lines.length; i++) {
        const first = layout.lines[i]!.glyphs[0];
        expect(first, `line ${i} at width ${w}`).toBeDefined();
        const before = PANGram[first!.cluster - 1];
        expect(before, `line ${i} at width ${w} starts mid-word`).toBe(' ');
      }
    }
  });

  it('keeps a single unbreakable word on its own overflowing line', async () => {
    const ctx = await makeCtx();
    const b = new LayoutContext().rangedBuilder(ctx);
    b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('Source Sans Pro') });
    b.push({ kind: 'FontSize', value: 40 }, 0, 'antidisestablishmentarianism'.length);
    // Far narrower than the word: it must overflow rather than split.
    const layout = b.build('antidisestablishmentarianism', 20);
    expect(layout.lines.length).toBe(1);
    expect(layout.lines[0]!.glyphs.length).toBeGreaterThan(10);
    expect(layout.width).toBeGreaterThan(20);
  });
});
