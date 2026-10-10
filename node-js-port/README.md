# Node.js port: `fontique` replacement

TypeScript replacement for [`fontique`](https://github.com/linebender/parley/tree/main/fontique).

## Why

`fontique` handles **font discovery and matching**: enumerate fonts, group
them into families, and pick the best face for a given family + weight + style
+ `FontTweak`. `epaint` uses it through `fonts.rs` and `font_definitions.rs`,
backed by a `FontProvider` trait.

## Upstream reference

- Crate: `fontique`, in the `parley` monorepo (`fontique/`).
- Version egui pins: `0.11.1`.
- Licence: `Apache-2.0 OR MIT` — identical to egui's own dual licence.

## Modules to port

| Rust module | Purpose | TS status |
|---|---|---|
| `matching.rs` | weight/stretch/style matching + `FontTweak` | TODO |
| `family.rs` / `family_name.rs` | family grouping and names | TODO |
| `attributes.rs` | typed style attributes (weight, stretch, slant, size) | TODO |
| `fallback.rs` | fallback chain for a codepoint | TODO |
| `script.rs` | script / language tagging | TODO |
| `source.rs`, `source_cache.rs` | font sources and caching | TODO |
| `scan.rs`, `collection/`, `backend/` | OS font enumeration | partial |

`backend/` is the hard part upstream: `fontique` enumerates system fonts via
`fontconfig` on Linux, CoreText on macOS, `DirectWrite` on Windows. A Node
port cannot rely on those, so `epaint` already has the `FontProvider` trait as
the seam. The port should provide:

- a filesystem scanner (walk font directories, parse names/metrics), and
- let embedders register fonts explicitly (egui's demo/test already do).

This is the crate where Node is genuinely weaker than Rust upstream; see the
"Known gaps" section below.

## Known gaps

egui can call `egui_system_fonts` (native) for discovered fonts. That crate is
out of scope for this port (see `PORTING.md` in the main `egui-node` repo), so
the Node port ships the filesystem scanner + explicit registration only. A
GUI embedding this must supply its own font provider.

## Licence

This port is `MIT OR Apache-2.0`, matching the upstream crate.