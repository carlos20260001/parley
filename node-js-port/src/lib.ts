/**
 * A TypeScript port of the `parley` text layout engine.
 *
 * This is a direct replacement for the `parley` crate and the `parley_engine`
 * crate underneath it, in the same way the other ports in this repository
 * replace their Rust counterparts. The module tree mirrors upstream's crate
 * tree:
 *
 *  - `style/`            → `parley::style` (`mod`, `font`, `brush`)
 *  - `attributed_text/`  → the `attributed_text` crate (`Attrs`)
 *  - `resolve/`          → `parley::resolve`
 *  - `layout/`           → `parley::layout` (line, cluster, layout, line-break)
 *  - `context.ts`        → `parley::LayoutContext` (`parley/src/context.rs`)
 *  - `builder.ts`        → `parley::RangedBuilder` (`parley/src/builder.rs`)
 *  - `font.ts`           → `parley::FontContext` (`parley/src/font.rs`)
 *  - `engine/`           → `parley_engine` (bidi, analysis, itemize, shape)
 *  - `fontique/`         → the `fontique` crate
 *  - `unicode.ts`        → the `icu_*` / `parley_data` replacements
 *
 * Not everything upstream provides is here; `README.md` lists what is and is
 * not ported, and why.
 */

export * from './style/mod.js';
export * from './attributed_text/mod.js';
export * from './fontique/mod.js';

export * from './resolve/mod.js';
export * from './layout/mod.js';

export { LayoutContext } from './context.js';
export { RangedBuilder } from './builder.js';
export { FontContext, runScale, shapeRun } from './font.js';
export type { RegisteredFont, ResolvedRun } from './font.js';

export * from './engine/mod.js';

export * from './unicode.js';
