# Node.js port: `parley` replacement

TypeScript replacement for [`parley`](https://github.com/linebender/parley)
and the `parley_engine` crate underneath it.

## Upstream reference

- Crate: `parley` + `parley_engine`, in the `parley` monorepo.
- Version egui pins: `0.7.0` / engine `0.5.0`.
- Licence: `Apache-2.0 OR MIT` — identical to egui's own dual licence.

## What this replaces, and the one thing it does not

`parley` is the text layout engine: given a string, a set of style ranges and
a font, it produces positioned glyphs per line. Its dependencies are:

| Rust dependency | Replaced by |
| --- | --- |
| `harfrust` | **HarfBuzzJS** — the official HarfBuzz project's WASM build (see below) |
| `icu_properties`, `icu_segmenter`, `icu_normalizer` | `Intl.Segmenter` + Unicode property escapes (`unicode.js`) |
| `parley_data` | a UAX #14 state machine over derived break classes (`line_break.ts`) |
| `fontique` | `FontContext.registerFont` / `faceFor` (`font_context.ts`) |
| `skrifa` | `@egui-node/skrifa-ts`, the same port used elsewhere in this tree |
| `attributed_text` | `attrs.ts` |

## The shaper decision

`harfrust` is a HarfBuzz port living in the fontations ecosystem. Porting it
means porting OpenType GSUB/GPOS/GDEF under `read-fonts`, which is a larger
chain than the rest of parley put together — and none of it is logic a port adds
value to. The spec is the spec, and HarfBuzz is the reference implementation.

So the port wraps **HarfBuzzJS**: the official upstream HarfBuzz project, MIT
licensed, maintained by the HarfBuzz authors, and at the same fidelity as
`harfrust`. This is why `harfbuzzjs` is the only runtime dependency.

HarfBuzz's default scale is `upem`, so shaping returns advances in font units; a
single multiply by `size / upem` converts to pixels.

## Async loading

`FontContext.new()` returns a Promise because HarfBuzzJS compiles its WASM at
load time. Upstream parley is synchronous. This is the one shape difference in
the API: call it once at startup and reuse the context.

```ts
import { FontContext, LayoutContext, FontFamily } from 'parley-ts';

const fontCtx = await FontContext.new();
fontCtx.registerFont(new Uint8Array(fontBytes), 'My Family');

const lcx = new LayoutContext();
const b = lcx.rangedBuilder(fontCtx);
b.pushDefault({ kind: 'FontFamily', value: FontFamily.named('My Family') });
b.push({ kind: 'FontSize', value: 24 }, 0, text.length);

const layout = b.build(text, 400);   // 400px wrap width
for (const line of layout.lines) {
  for (const g of line.glyphs) draw(g.id, g.dx, g.dy);
}
```

## Ported

- **Styles** (`style.ts`, `attrs.ts`): `FontFamily`, `FontWeight`, `FontWidth`,
  `FontStyle`, `LineHeight`, `Alignment`, `TextWrapMode`, `OverflowWrap`,
  `WordBreak`, `LineBreak`, `WhiteSpaceCollapse`, `StyleProperty`, `Attrs`.
- **Unicode** (`unicode.ts`): script detection and direction, whitespace,
  grapheme segmentation via `Intl.Segmenter`.
- **Line breaking** (`line_break.ts`): UAX #14 break opportunities over
  derived break classes.
- **Shaping** (`shaper.ts`): HarfBuzzJS wrapper, incl. `shapeRange` for
  slicing (built on plain `shape` plus cluster offsetting, because
  HarfBuzzJS exposes no range entry point).
- **Engine** (`layout_context.ts`): style resolution, itemization by style and
  script, shaping, and line breaking into lines.
- **Font selection** (`font_context.ts`): family/weight/width/italic matching
  with distance scoring, vertical metrics from `hhea` and `OS/2`.
- **Layout output** (`layout.ts`, `cluster.ts`): `Layout`, `Line`, `Glyph`,
  cluster boundaries and advances.

## Not ported

- **Bidirectional reordering (UAX #9)** — `bidi.rs` is 915 lines and is the
  largest remaining gap. Without it, runs are laid out in logical order, which
  is correct for single-direction paragraphs but wrong for mixed-direction
  text: Arabic or Hebrew mixed with Latin or digits will be mis-ordered on
  screen. See `bidi.ts`.
- **Emoji line breaking** (LB30a/LB30b). Needs `Extended_Pictographic`, which
  JavaScript does not expose. Latin, Cyrillic, Greek, Arabic, Hebrew, CJK,
  Thai and Lao are unaffected.
- **`fontique`'s OS enumeration and OS font config** — replaced by explicit
  `registerFont`.
- **`skrifa`'s `name` table** — a family name comes from the caller's hint.
- **Editing** (`parley::editing`: editor and selection) — not yet needed by
  egui.
- **Inline boxes, `TextIndent`, `VerticalAlign`** — part of the style surface
  but not yet consumed by the port's consumers.
- **CFF2** — as with the `skrifa` port.

## Testing

14 tests run against a real font (Source Sans Pro), covering font metric
registration, family selection and fallback, glyph output, font-size scaling,
hard breaks, width wrapping, script itemization, alignment, empty text, and two
line-breaking quality checks: that wrapping happens at word boundaries only,
and that an unbreakable word overflows rather than being split.

The two breaking tests exist because an earlier version of this port defaulted
to "break allowed" between characters, which passed the "it wraps" test while
splitting every word into per-glyph lines. A wrap test that only asserts
`lines.length > 1` cannot see that.
