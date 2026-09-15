// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two systems #307 added to the tokens, held to being systems.
 *
 * `contrast.a11y.test.ts` asks whether a colour is legible against another
 * colour. Neither question it asks can tell whether the surfaces form a ramp or
 * whether the sizes form a scale — a palette of four unrelated greys and a
 * ladder of four arbitrary sizes both clear WCAG AA perfectly well, and that is
 * exactly the state #307 found the client in.
 *
 * ## Why these are not `.a11y.test.ts`
 *
 * They are not accessibility assertions and naming them so would put two
 * non-accessibility failures inside the gate whose job is to report on
 * accessibility. `scripts/check-a11y-suite.mjs` rule 3 only fires for a test
 * *inside* an `a11y` or `accessibility` directory, and this file is in
 * `design/`, beside the thing it checks.
 */

import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast';
import {
  COLOUR_TOKENS,
  ELEVATION_SURFACES,
  FONT_SIZE_TOKENS,
  MAXIMUM_ELEVATION_STEP,
  MINIMUM_ELEVATION_STEP,
  TYPE_SCALE_BASE_REM,
  TYPE_SCALE_RATIO,
  TYPE_SCALE_STEPS,
} from './tokens';

describe('the elevation ramp is a ramp', () => {
  it('numbers its levels by its own order, so the two cannot disagree', () => {
    expect(ELEVATION_SURFACES.map((surface) => surface.level)).toEqual(
      ELEVATION_SURFACES.map((_, index) => index),
    );
  });

  it('holds every surface in the palette, so none can be added beside the ramp', () => {
    // Derived from the token names rather than written down. A fifth surface
    // added to COLOUR_TOKENS and used in the stylesheet, but never given a
    // level, is a colour nothing says where it sits — which is the state the
    // whole palette was in before #307.
    const surfaces = Object.keys(COLOUR_TOKENS).filter(
      (token) => token === 'canvas' || token.startsWith('surface'),
    );
    expect([...ELEVATION_SURFACES.map((surface) => surface.token)].sort()).toEqual(
      [...surfaces].sort(),
    );
  });

  it('gets darker at every step, which is the direction this theme states', () => {
    const luminances = ELEVATION_SURFACES.map((surface) =>
      relativeLuminance(COLOUR_TOKENS[surface.token]),
    );
    for (let index = 1; index < luminances.length; index += 1) {
      expect(
        luminances[index],
        `${ELEVATION_SURFACES[index]?.token ?? '?'} is lighter than the level below it, so its ` +
          'level number says one thing and the pixels say another',
      ).toBeLessThan(luminances[index - 1] as number);
    }
  });

  it('separates adjacent levels enough to be seen, and little enough to read as one ramp', () => {
    for (let index = 1; index < ELEVATION_SURFACES.length; index += 1) {
      const below = ELEVATION_SURFACES[index - 1];
      const above = ELEVATION_SURFACES[index];
      if (below === undefined || above === undefined) {
        throw new Error('the ramp is shorter than its own length');
      }
      const step = contrastRatio(COLOUR_TOKENS[above.token], COLOUR_TOKENS[below.token]);
      expect(
        step,
        `${below.token} → ${above.token} is ${step.toFixed(4)}:1, too small a step to see`,
      ).toBeGreaterThanOrEqual(MINIMUM_ELEVATION_STEP);
      expect(
        step,
        `${below.token} → ${above.token} is ${step.toFixed(4)}:1, which is not an elevation ` +
          'step but a different colour — the page reads as stripes rather than as layers',
      ).toBeLessThanOrEqual(MAXIMUM_ELEVATION_STEP);
    }
  });
});

describe('the type scale follows its stated ratio', () => {
  it('names a step for every size, and a size for every step', () => {
    expect(Object.keys(FONT_SIZE_TOKENS).sort()).toEqual(Object.keys(TYPE_SCALE_STEPS).sort());
  });

  it.each(Object.entries(TYPE_SCALE_STEPS))(
    '%s is base × ratio^%d, exactly',
    (name, step: number) => {
      // Exactly, not within a tolerance. 1.25 is 5/4 and every power used here
      // is representable, so a tolerance would buy nothing except room for a
      // size to drift back off the ladder one rounding at a time.
      const expected = `${String(TYPE_SCALE_BASE_REM * TYPE_SCALE_RATIO ** step)}rem`;
      expect(FONT_SIZE_TOKENS[name as keyof typeof FONT_SIZE_TOKENS]).toBe(expected);
    },
  );

  it('increases with the step number', () => {
    const ordered = Object.entries(TYPE_SCALE_STEPS).sort(([, a], [, b]) => a - b);
    const sizes = ordered.map(([name]) =>
      Number.parseFloat(FONT_SIZE_TOKENS[name as keyof typeof FONT_SIZE_TOKENS]),
    );
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it('is a ratio a reader can tell apart, and the reading sizes are contiguous', () => {
    // A ladder whose steps are 1.02 apart is arithmetically a scale and
    // visually one size. And the five reading sizes have to be adjacent rungs:
    // a gap in the middle of the reading range is a hierarchy with a missing
    // level, which is how `xl` came to be 1.4× its neighbour below and 2.29×
    // its neighbour above.
    expect(TYPE_SCALE_RATIO).toBeGreaterThanOrEqual(1.125);
    const reading = Object.entries(TYPE_SCALE_STEPS)
      .filter(([name]) => name !== 'metric')
      .map(([, step]) => step)
      .sort((a, b) => a - b);
    expect(reading).toEqual(reading.map((_, index) => (reading[0] as number) + index));
  });

  it('expresses every size in rem, which is the reader’s own setting', () => {
    for (const [name, value] of Object.entries(FONT_SIZE_TOKENS)) {
      expect(value, `${name} is "${value}", which does not scale with the reader`).toMatch(
        /^[\d.]+rem$/,
      );
    }
  });
});
