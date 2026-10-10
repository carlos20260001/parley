/**
 * Bidirectional reordering (UAX #9) — **not implemented**.
 *
 * `parley_engine/src/bidi.rs` is 915 lines: explicit directional isolates and
 * embeddings, implicit bidi class resolution, and the two-pass reordering that
 * turns logical order into visual order. It runs between itemization and
 * shaping, because a run's visual order is not its logical order once RTL is
 * involved.
 *
 * ## Status and consequence
 *
 * With this module absent, the port shapes and positions runs in **logical**
 * order. That is correct for:
 *
 *  - purely left-to-right text (Latin, CJK, Cyrillic, Greek),
 *  - purely right-to-left paragraphs read back to front on the screen, which
 *    is what a single-direction paragraph looks like anyway.
 *
 * It is wrong for **mixed** direction paragraphs: `abc<arabic>def` will place
 * the Arabic run after `abc` rather than between them, and the mirror forms
 * and shaping of surrounding punctuation will differ. Arabic, Hebrew, Persian
 * and Urdu text mixed with Latin or digits is the affected case.
 *
 * ## Why it is deferred rather than skipped
 *
 * UAX #9 needs no Unicode tables beyond `Bidi_Class`, which JavaScript does
 * **not** expose (unlike `Script` and `General_Category`). Implementing it
 * therefore needs either a generated bidi-class table or derivation from
 * ranges, and the algorithm itself is the bulk of the work — the two phases
 * (isolating run sequence resolution, then reverse) are subtle and easy to get
 * subtly wrong in a way that renders as plausible-but-shifted text.
 *
 * `script.ts` already exposes `isRtlScript`, so the run data is there when this
 * is implemented; the missing piece is the algorithm plus a `Bidi_Class` source.
 */

/** Placeholder so the module has an export and can be imported. */
export const BIDI_NOT_IMPLEMENTED = true;
