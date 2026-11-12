// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2508: a Delivery level's dusk and rain, as the world a frame is drawn in
 * (`weather-look.ts`). What the view does with that world — the sky dome, the
 * haze, the lamps, the ground — is the browser gate's: `delivery.browser.spec.ts`
 * §"#2508" reads a real frame back, clear against dusk and rain.
 */

import { describe, expect, it } from 'vitest';

import {
  DAY_SUN_COLOUR,
  DUSK_AMBIENT_SHARE,
  DUSK_DIRECT_SHARE,
  DUSK_GROUND_TINT,
  DUSK_HORIZON_COLOUR,
  DUSK_ROAD_TINT,
  DUSK_SKY_COLOUR,
  DUSK_SUN_COLOUR,
  DUSK_SUN_ELEVATION_DEGREES,
  RAIN_AMBIENT_SHARE,
  RAIN_DIRECT_SHARE,
  RAIN_FOG_SHARE,
  RAIN_GREY_SHARE,
  RAIN_ROAD_TINT,
  RAIN_SKY_GREY,
  roadTintIn,
  sunColourIn,
  weatheredWorld,
} from './weather-look';
import type { WorldStyle } from './world';

/** A clear day's world: a blue sky over a pale horizon, the sun 40° up in the south-west. */
const DAY: WorldStyle = {
  skyColour: 0x6fa8dc,
  groundColour: 0x6a8f4a,
  horizonColour: 0xc9dbe8,
  fogDensity: 0.002,
  sun: {
    x: Math.cos((40 * Math.PI) / 180) * Math.SQRT1_2,
    y: Math.sin((40 * Math.PI) / 180),
    z: -Math.cos((40 * Math.PI) / 180) * Math.SQRT1_2,
    ambient: 0.4,
    direct: 0.9,
  },
  snow: { bareColour: 0x777777, aboveSnowMetres: 2000, winterLoweringMetres: 300 },
};

/** sRGB channels of `colour`. */
function channels(colour: number): [number, number, number] {
  return [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
}

/** Rec. 709 luminance of sRGB channels, unlinearised: enough to order two colours. */
function brightness(colour: number): number {
  const [r, g, b] = channels(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('a Delivery level’s dusk and rain, as the world a frame is drawn in — #2508', () => {
  it('pins the dusk’s and the rain’s numbers, for the owner’s approval', () => {
    // Written here, not read, so a change there is a red test and a line in the PR.
    expect(DUSK_SKY_COLOUR).toBe(0x28335f);
    expect(DUSK_HORIZON_COLOUR).toBe(0xd98a62);
    expect(DUSK_SUN_COLOUR).toBe(0xffa060);
    expect(DAY_SUN_COLOUR).toBe(0xffffff);
    expect(DUSK_SUN_ELEVATION_DEGREES).toBe(8);
    expect(DUSK_DIRECT_SHARE).toBe(0.55);
    expect(DUSK_AMBIENT_SHARE).toBe(0.45);
    expect(DUSK_GROUND_TINT).toEqual([0.62, 0.52, 0.44]);
    expect(RAIN_FOG_SHARE).toBe(1.8);
    expect(RAIN_SKY_GREY).toBe(0x6b737c);
    expect(RAIN_GREY_SHARE).toBe(0.55);
    expect(RAIN_DIRECT_SHARE).toBe(0.5);
    expect(RAIN_AMBIENT_SHARE).toBe(0.8);
    expect(DUSK_ROAD_TINT).toEqual([0.36, 0.32, 0.28]);
    expect(RAIN_ROAD_TINT).toEqual([0.7, 0.7, 0.72]);
  });

  it('paints the unlit stylised road down at dusk and in rain, and leaves it its own colours by day', () => {
    expect(roadTintIn()).toEqual([1, 1, 1]);
    expect(roadTintIn({ rain: false, dusk: false })).toEqual([1, 1, 1]);
    expect(roadTintIn({ rain: false, dusk: true })).toEqual([...DUSK_ROAD_TINT]);
    expect(roadTintIn({ rain: true, dusk: false })).toEqual([...RAIN_ROAD_TINT]);
    roadTintIn({ rain: true, dusk: true }).forEach((value, channel) =>
      expect(value).toBeCloseTo(
        (DUSK_ROAD_TINT[channel] as number) * (RAIN_ROAD_TINT[channel] as number),
        12,
      ),
    );
  });

  it('draws clear daylight, and a frame with no weather, in the route’s own world', () => {
    expect(weatheredWorld(DAY)).toBe(DAY);
    expect(weatheredWorld(DAY, { rain: false, dusk: false })).toBe(DAY);
    expect(sunColourIn()).toBe(DAY_SUN_COLOUR);
    expect(sunColourIn({ rain: true, dusk: false })).toBe(DAY_SUN_COLOUR);
  });

  it('draws dusk as a deep blue sky over a warm horizon, a low warm sun, less light and a darker, warmer ground', () => {
    const dusk = weatheredWorld(DAY, { rain: false, dusk: true });
    // The sky: deep blue overhead, orange-pink at the horizon — warmer there than overhead.
    expect(dusk.skyColour).toBe(DUSK_SKY_COLOUR);
    expect(dusk.horizonColour).toBe(DUSK_HORIZON_COLOUR);
    const [skyRed, , skyBlue] = channels(dusk.skyColour);
    const [horizonRed, , horizonBlue] = channels(dusk.horizonColour);
    expect(skyBlue).toBeGreaterThan(skyRed);
    expect(horizonRed).toBeGreaterThan(horizonBlue);
    expect(brightness(dusk.skyColour)).toBeLessThan(brightness(DAY.skyColour) / 2);
    // The sun: 8° up, on the day's bearing, a unit vector still.
    expect(Math.asin(dusk.sun.y) * (180 / Math.PI)).toBeCloseTo(DUSK_SUN_ELEVATION_DEGREES, 9);
    expect(Math.hypot(dusk.sun.x, dusk.sun.y, dusk.sun.z)).toBeCloseTo(1, 12);
    expect(Math.atan2(dusk.sun.x, dusk.sun.z)).toBeCloseTo(Math.atan2(DAY.sun.x, DAY.sun.z), 12);
    expect(dusk.sun.direct).toBeCloseTo(DAY.sun.direct * DUSK_DIRECT_SHARE, 12);
    expect(dusk.sun.ambient).toBeCloseTo(DAY.sun.ambient * DUSK_AMBIENT_SHARE, 12);
    // What a horizontal surface receives: well under half the day's.
    const lit = (world: WorldStyle): number => world.sun.ambient + world.sun.direct * world.sun.y;
    expect(lit(dusk)).toBeLessThan(lit(DAY) * 0.35);
    // The ground: each channel its share, red least cut.
    expect(channels(dusk.groundColour)).toEqual(
      channels(DAY.groundColour).map((value, at) =>
        Math.round(value * (DUSK_GROUND_TINT[at] as number)),
      ),
    );
    // And nothing else.
    expect(dusk.fogDensity).toBe(DAY.fogDensity);
    expect(dusk.snow).toBe(DAY.snow);
    expect(sunColourIn({ rain: false, dusk: true })).toBe(DUSK_SUN_COLOUR);
  });

  it('sets an overhead sun at dusk in the north, rather than nowhere', () => {
    const overhead = { ...DAY, sun: { ...DAY.sun, x: 0, y: 1, z: 0 } };
    const { sun } = weatheredWorld(overhead, { rain: false, dusk: true });
    expect(sun.x).toBe(0);
    expect(sun.z).toBeCloseTo(Math.cos((DUSK_SUN_ELEVATION_DEGREES * Math.PI) / 180), 12);
  });

  it('draws rain as a greyer sky, a duller sun and a thicker haze', () => {
    const rain = weatheredWorld(DAY, { rain: true, dusk: false });
    expect(rain.fogDensity).toBeCloseTo(DAY.fogDensity * RAIN_FOG_SHARE, 12);
    expect(rain.sun.direct).toBeCloseTo(DAY.sun.direct * RAIN_DIRECT_SHARE, 12);
    expect(rain.sun.ambient).toBeCloseTo(DAY.sun.ambient * RAIN_AMBIENT_SHARE, 12);
    expect([rain.sun.x, rain.sun.y, rain.sun.z]).toEqual([DAY.sun.x, DAY.sun.y, DAY.sun.z]);
    // Each channel 55 % of the way to the grey.
    const toward = (from: number): number[] =>
      channels(from).map((value, at) =>
        Math.round(value + ((channels(RAIN_SKY_GREY)[at] as number) - value) * RAIN_GREY_SHARE),
      );
    expect(channels(rain.skyColour)).toEqual(toward(DAY.skyColour));
    expect(channels(rain.horizonColour)).toEqual(toward(DAY.horizonColour));
    expect(rain.groundColour).toBe(DAY.groundColour);
  });

  it('draws rain at dusk as the dusk, then the rain', () => {
    const both = weatheredWorld(DAY, { rain: true, dusk: true });
    const dusk = weatheredWorld(DAY, { rain: false, dusk: true });
    expect(both).toEqual(weatheredWorld(dusk, { rain: true, dusk: false }));
    expect(both.sun.direct).toBeCloseTo(DAY.sun.direct * DUSK_DIRECT_SHARE * RAIN_DIRECT_SHARE, 12);
    expect(sunColourIn({ rain: true, dusk: true })).toBe(DUSK_SUN_COLOUR);
  });
});
