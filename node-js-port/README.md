# Node.js port: `parley` replacement

TypeScript replacement for [`parley`](https://github.com/linebender/parley)
and the `parley_engine` crate underneath it.

## Upstream reference

- Crate: `parley` + `parley_engine`, in the `parley` monorepo.
- Version egui pins: `0.7.0` / engine `0.5.0`.
- Licence: `Apache-2.0 OR MIT` — identical to egui's own dual licence.

## Layout of the port

The module tree mirrors the upstream crates one for one, so a file can always
be read next to the Rust it came from:

| Port | Rust |
| --- | --- |
| `src/lib.ts` | `parley/src/lib.rs` |
| `src/style/{mod,font,brush}.ts` | `parley/src/style/{mod,font,brush}.rs` |
| `src/attributed_text/{mod,attributed_text}.ts` | `attributed_text/src/{lib,attributed_text}.rs` |
| `src/resolve/mod.ts` | `parley/src/resolve/mod.rs` |
| `src/layout/{mod,layout,line,cluster,line_break}.ts` | `parley/src/layout/{mod,layout,line,cluster,line_break}.rs` |
| `src/context.ts`, `src/builder.ts` | `parley/src/{context,builder}.rs` |
| `src/font.ts` | `parley/src/font.rs` |
| `src/engine/{mod,bidi,analysis,itemize}.ts`, `src/engine/shape/{mod,shaper}.ts` | `parley_engine/src/{lib,bidi,analysis,itemize}.rs`, `parley_engine/src/shape/{mod,shaper}.rs` |
| `src/fontique/{mod,attributes,font,generic,fallback,matching,scan}.ts`, `src/fontique/collection/{mod,query}.ts` | `fontique/src/{lib,attributes,font,generic,fallback,matching,scan}.rs`, `fontique/src/collection/{mod,query}.rs` |
| `src/unicode.ts` | the `icu_*` crates `parley_engine` depends on |

## What this replaces, and the one thing it does not

`parley` is the text layout engine: given a string, a set of style ranges and
a font, it produces positioned glyphs per line. Its dependencies are:

| Rust dependency | Replaced by |
| --- | --- |
| `harfrust` | **HarfBuzzJS** — the official HarfBuzz project's WASM build (see below) |
| `icu_properties`, `icu_segmenter`, `icu_normalizer` | `Intl.Segmenter` + Unicode property escapes (`unicode.ts`), plus derived bidi classes and break classes |
| `parley_data` | a UAX #14 state machine over derived break classes (`layout/line_break.ts`) |
| `fontique` | `fontique/` — collection, query and CSS weight matching |
| `skrifa` | `@egui-node/skrifa-ts`, the same port used elsewhere in this tree |
| `attributed_text` | `attributed_text/` |

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

- **Styles** (`style/`, `attributed_text/`): `FontFamily`, `FontWeight`,
  `FontWidth`, `FontStyle`, `LineHeight`, `Alignment`, `TextWrapMode`,
  `OverflowWrap`, `WordBreak`, `LineBreak`, `WhiteSpaceCollapse`,
  `StyleProperty`, `Attrs`.
- **Unicode** (`unicode.ts`): script detection and direction, whitespace,
  grapheme segmentation via `Intl.Segmenter`.
- **Line breaking** (`layout/line_break.ts`): UAX #14 break opportunities over
  derived break classes.
- **Bidi** (`engine/bidi.ts`): UAX #9 in full — X1–X8 explicit levels and
  overrides, W1–W7, N0–N2, I1/I2, per-character levels for the paragraph.
- **Engine** (`engine/`, `context.ts`, `builder.ts`): style resolution,
  bidi analysis, itemization by style, script and bidi level, shaping in each
  run's direction, line breaking in logical order, and the two reordering
  passes (L1 over runs, L2 over clusters inside right-to-left runs).
- **Shaping** (`engine/shape/shaper.ts`): HarfBuzzJS wrapper, incl.
  `shapeRange` for slicing (built on plain `shape` plus cluster offsetting,
  because HarfBuzzJS exposes no range entry point).
- **Font selection** (`font.ts`, `fontique/`): family/weight/width/italic
  matching with distance scoring, vertical metrics from `hhea` and `OS/2`,
  plus fontique's collection, query and CSS weight matching.
- **Layout output** (`layout/`): `Layout`, `Line`, `Glyph`, cluster boundaries
  and advances.

## How bidi is wired in

The resolver replaces the placeholder that used to sit in `src/engine/bidi.ts`.
It runs between itemization and shaping, exactly where upstream has it,
because a run's embedding level decides both the direction HarfBuzz shapes it
in and how the runs on a line are reordered:

| Stage | Where | Rule |
| --- | --- | --- |
| bidi class + bracket derivation | `engine/analysis.ts` | replaces the ICU properties the resolver reads |
| explicit levels and overrides | `engine/bidi.ts` | X1–X8 |
| isolating run sequences, W/N/I | `engine/bidi.ts` | W1–W7, N0–N2, I1/I2 |
| run split on level | `engine/itemize.ts` | constant script *and* level, as upstream's `Segment` |
| reorder runs on a line | `engine/itemize.ts` | L1 |
| reverse clusters in an RTL run | `builder.ts` | L2 |

The data JavaScript does not expose — `Bidi_Class`,
`Bidi_Paired_Bracket_Type`, `Bidi_Mirroring_Glyph` — is derived in
`analysis.ts`; see the header there for what is exact and what is approximated.

## Not ported

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

41 tests were the baseline; the bidi port adds its own, and the suite is run
against a real font (Source Sans Pro) throughout. Coverage includes font
metric registration, family selection and fallback, glyph output, font-size
scaling, hard breaks, width wrapping, script itemization, alignment, empty
text, and two line-breaking quality checks: that wrapping happens at word
boundaries only, and that an unbreakable word overflows rather than being
split.

The bidi tests assert the resulting *visual order* — the sequence of clusters
left to right on a line — on real mixed-direction text: `abc\u0645\u062f\u0629def`,
`\u05e9\u05dc\u05d5\u05dd 123`, an RTL isolate and an RTL embedding each wrapping
Latin inside an LTR paragraph, bracket-pair resolution (N0) in both
directions, and a multi-line paragraph whose two lines have different base
directions.

The breaking tests exist because an earlier version of this port defaulted to
"break allowed" between characters, which passed the "it wraps" test while
splitting every word into per-glyph lines. A wrap test that only asserts
`lines.length > 1` cannot see that. The same reasoning applies to the bidi
tests: a paragraph that "has RTL in it" proves nothing about whether it was
reordered, so every one of them pins the cluster sequence.
