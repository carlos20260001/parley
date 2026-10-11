// Copyright 2021 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/**
 * The brush, replacing `parley::style::Brush`.
 *
 * Upstream `Brush<B>` is a trait: a style is generic over whatever the caller
 * wants to draw with (a pen colour, a gradient, an image). Every parley API
 * that touches styles is therefore generic over that type.
 *
 * A port has to pick one concrete type to keep the API non-generic, and the
 * whole tree already represents colours as packed 32-bit integers elsewhere
 * (the `ecolor` port), so that is what this is. `attributed_text`'s own
 * `Color` and parley's re-export of it collapse onto it.
 */
export type Brush = number;
