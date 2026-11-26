// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2508: a Delivery level's dusk and rain, as the world a frame is drawn in
 * (`weather-look.ts`). What the view does with that world — the sky dome, the
 * haze, the lamps, the ground — is the browser gate's: `delivery.browser.spec.ts`
 * §"#2508" reads a real frame back, clear against dusk and rain.
 */

import { getHeapStatistics, GCProfiler } from 'node:v8';

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
  DUSK_LIT_ROOM_SHARE,
  DUSK_WINDOW_GLOW,
  RAIN_DUSK_FOG_SHARE,
  RAIN_FOG_SHARE,
  RAIN_GREY_SHARE,
  RAIN_ROAD_TINT,
  RAIN_SKY_GREY,
  roadTintIn,
  sunShareIn,
  sceneryShadeIn,
  sunColourIn,
  weatheredWorld,
  WeatherShading,
  windowGlowIn,
} from './weather-look';
import { LOW_LIGHT_REVEAL_METRES } from './delivery/in-view';
import { litAtDuskAt, litRoomAt } from './facade';
import { REALISTIC_DUSK_EXPOSURE_SHARE, REALISTIC_VALLEY_HAZE } from './realistic-light';
import { VIEW_AHEAD_METRES } from './terrain';
import { FOG_OCCLUSION_AT_VIEW_END, type WorldStyle } from './world';

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
    expect(DUSK_DIRECT_SHARE).toBe(0.65);
    expect(DUSK_AMBIENT_SHARE).toBe(0.6);
    expect(DUSK_GROUND_TINT).toEqual([0.74, 0.63, 0.54]);
    expect(RAIN_FOG_SHARE).toBe(1.8);
    // #2968: the rain's haze at dusk, and the lit rooms' glow.
    expect(RAIN_DUSK_FOG_SHARE).toBe(1.2);
    expect(DUSK_WINDOW_GLOW).toEqual([0.95, 0.62, 0.28]);
    expect(RAIN_SKY_GREY).toBe(0x6b737c);
    expect(RAIN_GREY_SHARE).toBe(0.55);
    expect(RAIN_DIRECT_SHARE).toBe(0.5);
    expect(RAIN_AMBIENT_SHARE).toBe(0.8);
    expect(DUSK_ROAD_TINT).toEqual([0.46, 0.41, 0.36]);
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
    // #2968: but for the haze, which the rain thickens less at dusk.
    expect(both).toEqual({
      ...weatheredWorld(dusk, { rain: true, dusk: false }),
      fogDensity: dusk.fogDensity * RAIN_DUSK_FOG_SHARE,
    });
    expect(both.sun.direct).toBeCloseTo(DAY.sun.direct * DUSK_DIRECT_SHARE * RAIN_DIRECT_SHARE, 12);
    expect(sunColourIn({ rain: true, dusk: true })).toBe(DUSK_SUN_COLOUR);
  });
});

/** An sRGB channel, 0 to 255, in linear light. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A packed sRGB colour in linear light. */
function linearRgb(colour: number): [number, number, number] {
  return [linear((colour >> 16) & 0xff), linear((colour >> 8) & 0xff), linear(colour & 0xff)];
}

/**
 * PR #2522's stated range: a tree's darkening at dusk, each channel, within
 * this share of the ground's own.
 */
const SHADE_TOLERANCE = 0.05;

describe('the scenery goes down at dusk with the ground it stands on — PR #2522', () => {
  it('shades the scenery at dusk by the ground’s own darkening, each channel, and by nothing otherwise', () => {
    for (const world of [
      DAY,
      { ...DAY, groundColour: 0x3f5a2b },
      { ...DAY, groundColour: 0x8a7a55 },
    ]) {
      const shade = sceneryShadeIn(world, { dusk: true, rain: false });
      const day = linearRgb(world.groundColour);
      const dusk = linearRgb(weatheredWorld(world, { dusk: true, rain: false }).groundColour);
      for (const channel of [0, 1, 2] as const) {
        const ground = dusk[channel] / day[channel];
        expect(Math.abs(shade[channel] / ground - 1)).toBeLessThan(SHADE_TOLERANCE);
      }
      // Darker, and warmer: red keeps the most of itself, blue the least.
      expect(shade[0]).toBeLessThan(0.6);
      expect(shade[0]).toBeGreaterThan(shade[1]);
      expect(shade[1]).toBeGreaterThan(shade[2]);
      // And at dusk in rain the same, since rain does not tint the ground.
      expect(sceneryShadeIn(world, { dusk: true, rain: true })).toEqual(shade);
    }
    expect(sceneryShadeIn(DAY)).toEqual([1, 1, 1]);
    expect(sceneryShadeIn(DAY, { dusk: false, rain: false })).toEqual([1, 1, 1]);
    expect(sceneryShadeIn(DAY, { dusk: false, rain: true })).toEqual([1, 1, 1]);
  });

  it('takes the tint’s own share for a channel the ground has none of', () => {
    const shade = sceneryShadeIn({ ...DAY, groundColour: 0x406000 }, { dusk: true, rain: false });
    expect(shade[2]).toBeCloseTo(
      DUSK_GROUND_TINT[2] <= 0.04045
        ? DUSK_GROUND_TINT[2] / 12.92
        : ((DUSK_GROUND_TINT[2] + 0.055) / 1.055) ** 2.4,
      9,
    );
  });
});

describe('what the lamps do not reach is lit by the frame’s share of the route’s light — PR #2522', () => {
  const lightIn = (weather?: { dusk: boolean; rain: boolean }) =>
    sunShareIn(DAY.sun, weatheredWorld(DAY, weather).sun, weather);

  it('gives the whole of it in clear daylight', () => {
    expect(lightIn()).toEqual([1, 1, 1]);
    expect(lightIn({ dusk: false, rain: false })).toEqual([1, 1, 1]);
  });

  it('gives the sky’s share and half the sun’s, the sun in its colour, over the day’s', () => {
    const whole = DAY.sun.ambient + DAY.sun.direct / 2;
    const rain = lightIn({ dusk: false, rain: true });
    const greyed =
      (DAY.sun.ambient * RAIN_AMBIENT_SHARE + (DAY.sun.direct * RAIN_DIRECT_SHARE) / 2) / whole;
    for (const channel of rain) expect(channel).toBeCloseTo(greyed, 9);
    const dusk = lightIn({ dusk: true, rain: false });
    const sun = linearRgb(DUSK_SUN_COLOUR);
    const drawn = weatheredWorld(DAY, { dusk: true, rain: false }).sun;
    for (const channel of [0, 1, 2] as const) {
      expect(dusk[channel]).toBeCloseTo(
        (drawn.ambient + (drawn.direct / 2) * sun[channel]) / whole,
        9,
      );
    }
  });

  it('is dimmer in daytime rain, dimmer and warm at dusk, dimmest at dusk in rain', () => {
    const luma = ([r, g, b]: readonly number[]) =>
      0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    const rain = lightIn({ dusk: false, rain: true });
    const dusk = lightIn({ dusk: true, rain: false });
    const both = lightIn({ dusk: true, rain: true });
    expect(luma(rain)).toBeLessThan(0.8);
    // Grey in rain: every channel alike.
    expect(rain[0]).toBeCloseTo(rain[2], 9);
    expect(luma(dusk)).toBeLessThan(luma(rain));
    expect(dusk[0]).toBeGreaterThan(dusk[2] * 1.2);
    expect(luma(both)).toBeLessThan(luma(dusk));
  });

  it('gives all of it for a route with no light to share', () => {
    const dark = { ...DAY.sun, ambient: 0, direct: 0 };
    expect(sunShareIn(dark, dark)).toEqual([1, 1, 1]);
  });
});

describe('a frame’s shade and share are held, not worked out again — PR #2522, #240 NFR-3', () => {
  const WEATHERS = [
    undefined,
    { dusk: false, rain: false },
    { dusk: false, rain: true },
    { dusk: true, rain: false },
    { dusk: true, rain: true },
  ];
  /** Frames in a measured window. */
  const WINDOW_FRAMES = 100_000;
  /** What a window may leave on the heap: ten bytes a frame would be a megabyte. */
  const WINDOW_BYTES = 64 * 1024;
  /** Windows a weather is measured over. */
  const WINDOWS = 8;
  /** Windows tried before a weather fails, so that a collection may spoil some. */
  const MAX_ATTEMPTS = 16;

  it('allocates nothing on a frame, in every weather', () => {
    for (const weather of WEATHERS) {
      const light = new WeatherShading();
      // The window holds the frame's own work and nothing else: a read of a
      // double in the harness's loop can box a number of its own.
      const frames = (count: number): void => {
        for (let i = 0; i < count; i += 1) light.update(DAY, weather);
      };
      /** Heap growth across `count` frames, and the collections that ran meanwhile. */
      const measure = (count: number): { grew: number; collected: number } => {
        const profiler = new GCProfiler();
        profiler.start();
        const before = getHeapStatistics().used_heap_size;
        frames(count);
        const after = getHeapStatistics().used_heap_size;
        return { grew: after - before, collected: profiler.stop().statistics.length };
      };
      // Warm up, so the measured windows run optimised code as a ride does.
      frames(300_000);
      // The first measurement of anything costs the harness its own first use.
      measure(0);
      // #2637: one window was one sample, and on a busy runner it carried
      // 107 232 bytes the frames did not make (a compiler installing code
      // late, the harness's own bookkeeping). So the frames are measured over
      // several windows and the bound is held by the lot of them: what they
      // left behind together, under the windows' bounds together, which is
      // the same 64 KiB for 100 000 frames. A one-off is shared with the
      // windows that carry none. An allocation on every frame is in every
      // window, or forces a collection that spoils it; growth that comes in
      // steps (an array whose store is copied as it doubles) is in some
      // windows only, and is in the sum. Each window is less an empty window
      // taken just before it, so what the measuring itself costs is taken
      // off. A window in which the heap shrank (a compiler dropping code)
      // counts as none, so that it cannot hide what another left behind.
      const attempts: string[] = [];
      const leftBehind: number[] = [];
      for (let attempt = 0; attempt < MAX_ATTEMPTS && leftBehind.length < WINDOWS; attempt += 1) {
        const empty = measure(0);
        const run = measure(WINDOW_FRAMES);
        // A collection inside the window would hide an allocation: measure again.
        if (run.collected > 0 || empty.collected > 0) {
          attempts.push(`collected ${run.collected + empty.collected}×`);
          continue;
        }
        attempts.push(`${run.grew - empty.grew} B`);
        leftBehind.push(Math.max(0, run.grew - empty.grew));
      }
      const said = `${JSON.stringify(weather)}: ${attempts.join(', ')}`;
      expect(leftBehind.length, said).toBe(WINDOWS);
      const total = leftBehind.reduce((sum, bytes) => sum + bytes, 0);
      expect(total, said).toBeLessThan(WINDOWS * WINDOW_BYTES);
      // Non-vacuity: the frames worked out this weather's shade and share.
      expect(light.shade).toEqual(sceneryShadeIn(DAY, weather));
      expect(light.share).toEqual(sunShareIn(DAY.sun, weatheredWorld(DAY, weather).sun, weather));
    }
  });

  it('holds what the functions give, and works them out again when the ground, the sun or the weather changes', () => {
    const light = new WeatherShading();
    const expectAsGiven = (world: WorldStyle, weather?: { dusk: boolean; rain: boolean }) => {
      light.update(world, weather);
      expect(light.shade).toEqual(sceneryShadeIn(world, weather));
      expect(light.share).toEqual(
        sunShareIn(world.sun, weatheredWorld(world, weather).sun, weather),
      );
    };
    // Each step changes one thing the answer follows, and the answer moves with it.
    expectAsGiven(DAY);
    expect(light.shade).toEqual([1, 1, 1]);
    expectAsGiven(DAY, { dusk: true, rain: false });
    expect(light.shade[0]).toBeLessThan(1);
    expectAsGiven(DAY, { dusk: true, rain: true });
    expectAsGiven(DAY, { dusk: false, rain: true });
    expect(light.shade).toEqual([1, 1, 1]);
    expect(light.share[0]).toBeLessThan(1);
    expectAsGiven(DAY, { dusk: true, rain: true });
    expectAsGiven({ ...DAY, groundColour: 0x3f5a2b }, { dusk: true, rain: true });
    expectAsGiven(
      { ...DAY, groundColour: 0x3f5a2b, sun: { ...DAY.sun, ambient: DAY.sun.ambient / 2 } },
      { dusk: true, rain: true },
    );
    expectAsGiven(
      {
        ...DAY,
        groundColour: 0x3f5a2b,
        sun: { ...DAY.sun, ambient: DAY.sun.ambient / 2, direct: DAY.sun.direct / 2 },
      },
      { dusk: true, rain: true },
    );
    // And it hands out the same two tuples every frame, which the renderer reads.
    const { shade, share } = light;
    expectAsGiven(DAY);
    expect(light.shade).toBe(shade);
    expect(light.share).toBe(share);
  });
});

describe('the Evening Round, lighter, less hazy, its houses lit — #2968', () => {
  /**
   * A route's haze at sea level, its densest (`world.ts` §`SEA_LEVEL_FOG_DENSITY`,
   * restated from its two inputs), in the realistic world's valley, where it is
   * thickest (`realistic-light.ts` §`REALISTIC_VALLEY_HAZE`).
   */
  const SEA_LEVEL = Math.sqrt(-Math.log(1 - FOG_OCCLUSION_AT_VIEW_END)) / VIEW_AHEAD_METRES;
  const ROUTE: WorldStyle = { ...DAY, fogDensity: SEA_LEVEL };
  /** How much of a house `metres` off the haze takes (three's `FogExp2`), in the valley. */
  const hazeAt = (world: WorldStyle, metres: number): number =>
    1 - Math.exp(-((world.fogDensity * REALISTIC_VALLEY_HAZE * metres) ** 2));

  it('lets a house at the marker distance through the haze in rain at dusk: at most 7 %, half what it was', () => {
    const now = hazeAt(weatheredWorld(ROUTE, { rain: true, dusk: true }), LOW_LIGHT_REVEAL_METRES);
    // Before #2968 the rain's haze at dusk was its daytime 1.8 times.
    const before =
      1 - Math.exp(-((SEA_LEVEL * 1.8 * REALISTIC_VALLEY_HAZE * LOW_LIGHT_REVEAL_METRES) ** 2));
    expect(now).toBeLessThan(0.07);
    expect(now).toBeLessThan(before / 2);
    // And the distance thins: at 150 m it takes under two thirds of a house, where it took nearly all.
    expect(hazeAt(weatheredWorld(ROUTE, { rain: true, dusk: true }), 150)).toBeLessThan(0.65);
    expect(1 - Math.exp(-((SEA_LEVEL * 1.8 * REALISTIC_VALLEY_HAZE * 150) ** 2))).toBeGreaterThan(
      0.85,
    );
    // Rainy Round, rain by day, keeps its haze: the owner's complaint was the two stacked.
    expect(weatheredWorld(ROUTE, { rain: true, dusk: false }).fogDensity).toBeCloseTo(
      SEA_LEVEL * RAIN_FOG_SHARE,
      12,
    );
  });

  it('lights a house at dusk with over twice the share of its daylight it had', () => {
    /** A house's light at dusk, as a share of its daylight: the exposure, the weather's shade and the sun. */
    const houseLight = (exposure: number, world: WorldStyle): number => {
      const shade = sceneryShadeIn(DAY, { rain: false, dusk: true });
      const luminance = 0.2126 * shade[0] + 0.7152 * shade[1] + 0.0722 * shade[2];
      const sun = (world.sun.ambient + world.sun.direct) / (DAY.sun.ambient + DAY.sun.direct);
      return exposure * luminance * sun;
    };
    const now = houseLight(
      REALISTIC_DUSK_EXPOSURE_SHARE,
      weatheredWorld(DAY, { rain: false, dusk: true }),
    );
    expect(now).toBeGreaterThan(0.15);
    // Still evening: well under half its daylight.
    expect(now).toBeLessThan(0.5);
    // Before #2968: an exposure of 0.7, the sun's and the sky's 0.55 and 0.45,
    // and the ground's [0.62, 0.52, 0.44] in sRGB, about 0.25 of its light.
    const beforeSun =
      (DAY.sun.ambient * 0.45 + DAY.sun.direct * 0.55) / (DAY.sun.ambient + DAY.sun.direct);
    const linear = (share: number): number => share ** 2.2;
    const beforeShade = 0.2126 * linear(0.62) + 0.7152 * linear(0.52) + 0.0722 * linear(0.44);
    expect(now).toBeGreaterThan(2 * 0.7 * beforeShade * beforeSun);
  });

  it('lights 45 % of windows at dusk on the day’s own hash, every room lit by day among them', () => {
    expect(DUSK_LIT_ROOM_SHARE).toBe(0.45);
    let lit = 0;
    let both = 0;
    let day = 0;
    const tint: [number, number, number] = [0.31, 0.72, 0.5];
    for (let x = 0; x < 60; x += 1) {
      for (let y = 0; y < 50; y += 1) {
        const dusk = litAtDuskAt([x, y], tint, DUSK_LIT_ROOM_SHARE);
        const byDay = litRoomAt([x, y], tint);
        if (dusk) lit += 1;
        if (byDay) day += 1;
        if (dusk && byDay) both += 1;
      }
    }
    expect(lit / 3000).toBeGreaterThan(0.4);
    expect(lit / 3000).toBeLessThan(0.5);
    // A room lit by day stays lit.
    expect(both).toBe(day);
  });

  it('glows a lit room’s window at dusk, warm, and never by day or in rain alone', () => {
    expect(windowGlowIn({ rain: false, dusk: true })).toEqual(DUSK_WINDOW_GLOW);
    expect(windowGlowIn({ rain: true, dusk: true })).toEqual(DUSK_WINDOW_GLOW);
    expect(windowGlowIn({ rain: true, dusk: false })).toEqual([0, 0, 0]);
    expect(windowGlowIn({ rain: false, dusk: false })).toEqual([0, 0, 0]);
    expect(windowGlowIn()).toEqual([0, 0, 0]);
    // Warm: red over green over blue.
    const [r, g, b] = DUSK_WINDOW_GLOW;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });
});
