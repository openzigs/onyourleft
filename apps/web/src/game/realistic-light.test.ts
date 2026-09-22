// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { AA_LARGE_TEXT_OR_NON_TEXT, relativeLuminance } from '../design/contrast';
import {
  AGX_WHITE_INPUT,
  environmentIntensity,
  halfToFloat,
  PHOTOGRAPHIC_ROAD_GRAIN,
  reflectedSkyColour,
  skyBandRadiance,
  skyRotation,
  skySunU,
  WATER_HORIZON_BAND,
  WATER_ZENITH_BAND,
  upwardRadiance,
  type SkyPixels,
} from './realistic-light';
import { GRADIENT_TINT_FULL_SCALE_PERCENT, MINIMUM_TINT_CONTRAST_RATIO, roadTint } from './terrain';
import { PEAK_IRRADIANCE, SUN_AMBIENT_SHARE, worldStyle } from './world';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
} from '@onyourleft/domain';

/** A short level route at the fixtures' latitude: what `world.ts` needs to put a sun somewhere. */
function harnessRoute(): ReturnType<typeof routeProfile> {
  return routeProfile(
    Array.from({ length: 20 }, (_, step) => ({
      position: geographicPosition(
        degreesLatitude(51.5 + (step * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    })),
  );
}

/** A sky of `width` × `height` texels, each `radiance(row, column)`. */
function sky(
  width: number,
  height: number,
  radiance: (row: number, column: number) => number,
): SkyPixels {
  return {
    width,
    height,
    channel: (index) => {
      const texel = Math.floor(index / 4);
      return radiance(Math.floor(texel / width), texel % width);
    },
  };
}

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

describe('reading an HDR sky — ADR 0026 D-9', () => {
  it('decodes half-precision floats as IEEE 754 binary16 defines them', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0x4000)).toBe(2);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0x0001)).toBeCloseTo(2 ** -24, 30);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
  });

  it('answers a uniform sky’s own radiance, whatever its size or sampling step', () => {
    expect(upwardRadiance(sky(64, 32, () => 2.5))).toBeCloseTo(2.5, 10);
    expect(
      upwardRadiance(
        sky(128, 64, () => 0.4),
        1,
      ),
    ).toBeCloseTo(0.4, 10);
  });

  it('reads only the upper hemisphere — the ground under a horizon lights no horizontal surface', () => {
    const lowerIsBright = sky(64, 32, (row) => (row < 16 ? 1 : 1000));
    expect(upwardRadiance(lowerIsBright, 1)).toBeCloseTo(1, 10);
  });

  it('weights a band by how much of a horizontal surface’s view it fills', () => {
    // Solid angle grows toward the horizon and the cosine toward the zenith,
    // so their product peaks at 45°: a bright band there counts for more than
    // one of the same height at the horizon.
    const middle = upwardRadiance(
      sky(64, 64, (row) => (row >= 12 && row < 20 ? 10 : 1)),
      1,
    );
    const horizon = upwardRadiance(
      sky(64, 64, (row) => (row >= 24 && row < 32 ? 10 : 1)),
      1,
    );
    expect(middle).toBeGreaterThan(horizon);
  });

  it('finds the sun as the brightest texel of the upper hemisphere', () => {
    const sunny = sky(64, 32, (row, column) => (row === 4 && column === 40 ? 500 : 1));
    expect(skySunU(sunny, 1)).toBeCloseTo((40 + 0.5) / 64, 10);
    // A brighter texel BELOW the horizon is a reflection or a lamp, not the sun.
    const reflected = sky(64, 32, (row, column) =>
      row === 4 && column === 40 ? 500 : row === 20 && column === 3 ? 9000 : 1,
    );
    expect(skySunU(reflected, 1)).toBeCloseTo((40 + 0.5) / 64, 10);
  });
});

describe('one sky and one sun — ADR 0026 D-9', () => {
  it('turns the sky so its sun stands at the world sun’s azimuth, by three’s own convention', () => {
    // three samples the picture at Rᵀ·d, and a picture column u is the azimuth
    // (u − 0.5)·2π from +X towards +Z. So after turning by θ, the world
    // direction toward the sun must sample the picture's sun column.
    const sun = worldStyle(harnessRoute()).sun;
    for (const sunU of [0.1, 0.37, 0.5, 0.83]) {
      const turn = skyRotation(sunU, sun.x, sun.z);
      const worldAzimuth = Math.atan2(sun.z, sun.x);
      const sampledU = ((((worldAzimuth + turn) / (2 * Math.PI) + 0.5) % 1) + 1) % 1;
      expect(sampledU).toBeCloseTo(sunU, 10);
    }
  });

  it('scales the environment to give a horizontal surface exactly the ambient share', () => {
    // The environment replaces the ambient lamp, so albedo · I · C must be
    // albedo · SUN_AMBIENT_SHARE for a sky whose cosine-convolved radiance is C.
    for (const upward of [0.2, 1, 3.7]) {
      expect(environmentIntensity(SUN_AMBIENT_SHARE, upward) * upward).toBeCloseTo(
        SUN_AMBIENT_SHARE,
        12,
      );
    }
    expect(() => environmentIntensity(SUN_AMBIENT_SHARE, 0)).toThrow(/no light/);
  });
});

describe('what the realistic path can clip — ADR 0026 D-10', () => {
  it('puts AgX’s white point where three 0.185.1’s shader does', () => {
    // log2(pow(2, 6.5) * 0.18)
    expect(Math.log2(AGX_WHITE_INPUT)).toBeCloseTo(Math.log2(2 ** 6.5 * 0.18), 5);
  });

  it('keeps every lit surface an order of magnitude under the white point', () => {
    // An albedo cannot be over 1, and `world.ts` allows no irradiance over its
    // peak; the brightest a lit surface can be handed is the product, and a
    // physically based surface's specular lobe at the roughness this path uses
    // adds a few per cent to it. Ten times that is still under white.
    const brightestSurface = 1 * PEAK_IRRADIANCE * 1.1;
    expect(brightestSurface * 10).toBeLessThan(AGX_WHITE_INPUT);
  });
});

describe('the photograph is a grain on the road’s gradient tint, never its colour — #242, #425', () => {
  it('bounds the photograph exactly as the procedural grain is bounded', () => {
    expect(PHOTOGRAPHIC_ROAD_GRAIN).toBeGreaterThan(0);
    expect(PHOTOGRAPHIC_ROAD_GRAIN).toBeLessThanOrEqual(0.2);
  });

  it('still separates the steepest climb from the steepest descent with the grain at its worst', () => {
    // The worst case for the cue before any light: the descent darkened by the
    // whole grain and the climb lightened by it. What light and AgX then do is
    // read off a real drawing buffer by `game.browser.spec.ts`.
    const climb = relativeLuminance(hex(roadTint(GRADIENT_TINT_FULL_SCALE_PERCENT)));
    const descent = relativeLuminance(hex(roadTint(-GRADIENT_TINT_FULL_SCALE_PERCENT)));
    const worst =
      (descent * (1 - PHOTOGRAPHIC_ROAD_GRAIN) + 0.05) /
      (climb * (1 + PHOTOGRAPHIC_ROAD_GRAIN) + 0.05);
    expect(worst).toBeGreaterThanOrEqual(MINIMUM_TINT_CONTRAST_RATIO);
    expect(MINIMUM_TINT_CONTRAST_RATIO).toBe(AA_LARGE_TEXT_OR_NON_TEXT);
  });
});

describe('what the realistic water reflects — #475', () => {
  /** A sky whose three channels differ, so a hue is something to get wrong. */
  function coloured(
    width: number,
    height: number,
    colour: (row: number) => readonly [number, number, number],
  ): SkyPixels {
    return {
      width,
      height,
      channel: (index) => {
        const texel = Math.floor(index / 4);
        const channel = index % 4;
        return channel === 3 ? 1 : (colour(Math.floor(texel / width))[channel] ?? 0);
      },
    };
  }

  it('averages only the rows inside the band, as the rows of the picture they are', () => {
    // 180 rows: a degree each. Above 30° is blue, below it is orange.
    const picture = coloured(8, 180, (row) => (90 - (row + 0.5) > 30 ? [0, 0, 1] : [1, 0.5, 0]));
    expect(skyBandRadiance(picture, WATER_ZENITH_BAND[0], WATER_ZENITH_BAND[1])).toEqual([0, 0, 1]);
    expect(skyBandRadiance(picture, WATER_HORIZON_BAND[0], WATER_HORIZON_BAND[1])).toEqual([
      1, 0.5, 0,
    ]);
  });

  it('weights a row by the sky it covers, which shrinks towards the zenith', () => {
    // Half the band bright and half dark: the lower, wider rows win.
    const picture = coloured(4, 180, (row) => (90 - (row + 0.5) > 60 ? [1, 1, 1] : [0, 0, 0]));
    const [r] = skyBandRadiance(picture, 30, 90);
    expect(r).toBeLessThan(0.5);
    expect(r).toBeGreaterThan(0.2);
  });

  it('reads a sky too coarse to have a row in the band at the nearest row', () => {
    const picture = coloured(4, 8, (row) => [row, row, row]);
    // 0° to 10°: no row centre falls inside 8 rows' 22.5° spacing; row 3 (11.25°) is nearest.
    expect(skyBandRadiance(picture, 0, 10)).toEqual([3, 3, 3]);
  });

  it('refuses a band with nothing finite in it', () => {
    const picture = coloured(4, 180, () => [Number.NaN, 0, 0]);
    expect(() => skyBandRadiance(picture, 0, 10)).toThrow(/no texel/);
  });

  it('keeps the band’s hue and takes the brightness it is asked for', () => {
    const [r, g, b] = reflectedSkyColour([4, 2, 1], 0.3);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(0.3, 10);
    expect(r / g).toBeCloseTo(2, 10);
    expect(g / b).toBeCloseTo(2, 10);
    expect(reflectedSkyColour([0, 0, 0], 0.3)).toEqual([0, 0, 0]);
  });
});
