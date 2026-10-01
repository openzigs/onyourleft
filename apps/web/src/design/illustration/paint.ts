// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What colour each shape in the illustration kit is — #938, the house style of
 * epic #935 (`docs/architecture.md` §"House style for the menus").
 *
 * ⚠️ **A shape names a LAYER, never a colour.** Each paint is a class in
 * `theme.css` (§"THE ILLUSTRATION KIT'S PAINT") that sets `fill` or `stroke` to
 * one token's `var(--oyl-…)`, so the dark palette, the HUD's light pin and any
 * later palette re-point it with no edit here. No part of the kit writes a
 * `fill`, a `stroke` or a `style` colour of its own; `illustration.test.tsx`
 * fails one that does.
 *
 * The table is here, beside the parts, rather than read out of the stylesheet,
 * because the browser gate (`shell.browser.spec.ts` §"#938") needs to know
 * which token a painted pixel must equal, and a gate that re-typed the mapping
 * could agree with itself and not with the page. `illustration.test.tsx` holds
 * it to `theme.css` in both directions.
 */

import type { ColourToken } from '../tokens';

/** How a paint is applied: inside a shape, or along its outline only. */
export type PaintProperty = 'fill' | 'stroke';

export interface IllustrationPaint {
  /** The class a shape carries. */
  readonly className: string;
  /** The token it paints with, in whichever palette is showing. */
  readonly token: ColourToken;
  /** `stroke` paints a line and leaves its inside empty (`fill: none`). */
  readonly property: PaintProperty;
}

/**
 * Every paint the kit uses. The first five are #936's, which `theme.css`
 * already declared; the rest are #938's, and each reuses a token that is
 * already in the palette rather than adding one — so no new contrast pair is
 * owed (a word or a control drawn OVER art still declares its own pair
 * in `tokens.ts` §`CONTRAST_REQUIREMENTS` first).
 */
export const ILLUSTRATION_PAINTS = {
  sky: { className: 'oyl-illo__sky', token: 'illoSky', property: 'fill' },
  sun: { className: 'oyl-illo__sun', token: 'illoSun', property: 'fill' },
  hillFar: { className: 'oyl-illo__hill-far', token: 'illoHillFar', property: 'fill' },
  hillNear: { className: 'oyl-illo__hill-near', token: 'illoHillNear', property: 'fill' },
  road: { className: 'oyl-illo__road', token: 'illoRoad', property: 'fill' },
  /** Clouds, and the dashes down the road: the page's own white, or its night. */
  light: { className: 'oyl-illo__light', token: 'canvas', property: 'fill' },
  /** The rider's solid parts — the helmet, the saddle — in the ink. */
  figure: { className: 'oyl-illo__figure', token: 'ink', property: 'fill' },
  /** The rider's tubes, limbs and wheels: lines in the ink. */
  figureLine: { className: 'oyl-illo__figure-line', token: 'ink', property: 'stroke' },
  /** A sensor glyph and a workout's blocks: the accent. */
  mark: { className: 'oyl-illo__mark', token: 'accent', property: 'fill' },
} as const satisfies Readonly<Record<string, IllustrationPaint>>;

/** One of {@link ILLUSTRATION_PAINTS}. */
export type PaintName = keyof typeof ILLUSTRATION_PAINTS;

/** The class for a paint. */
export function paint(name: PaintName): string {
  return ILLUSTRATION_PAINTS[name].className;
}
