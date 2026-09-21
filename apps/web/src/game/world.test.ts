// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The world a route implies — #241.
 *
 * ⚠️ **These assertions are about properties, not about hues.** A test that
 * pinned `skyColour` to a literal would go red the moment somebody adjusted a
 * colour and would say nothing at all about whether the world is derived from
 * the route — which is the only claim #240 actually makes. So what is asserted
 * here is: the function is pure, two different places produce two different
 * worlds, the sky reads as sky everywhere on both axes, the ground brightens
 * monotonically as a route climbs out of the trees, and the fog is dense enough
 * to hide the corridor's cut end and thin enough to leave the road under the
 * rider alone.
 *
 * `relativeLuminance` comes from `design/contrast.ts` — the same WCAG formula
 * the accessibility gate uses — because "brighter" needs a definition that is
 * not a reviewer's eye.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { relativeLuminance } from '../design/contrast';
import { CAMERA_BEHIND_METRES } from './camera';
import { VIEW_AHEAD_METRES } from './terrain';
import {
  FOG_OCCLUSION_AT_VIEW_END,
  HORIZON_HAZE,
  MINIMUM_VIEW_END_OCCLUSION,
  NEAR_FOG_LIMIT,
  PEAK_IRRADIANCE,
  SNOW_BAND_METRES,
  SUN_AMBIENT_SHARE,
  SUN_AZIMUTH_DEGREES,
  SUN_ELEVATION_AT_EQUATOR_DEGREES,
  SUN_ELEVATION_AT_POLE_DEGREES,
  TREE_LINE_AT_EQUATOR_METRES,
  WORLD_HIGHEST_LAND_METRES,
  WORLD_SAMPLE_LIMIT,
  fogFactor,
  irradianceOn,
  worldStyle,
} from './world';

/**
 * A straight route at a latitude and an altitude, of a given length.
 *
 * ⚠️ It runs **east**, along a parallel, so every point carries exactly the
 * latitude asked for. A north-running fixture would make the mean latitude a
 * function of the route's length, and the two tests below that compare a long
 * route against a short one at "the same place" would be comparing two
 * different places without saying so.
 */
function routeAt(options: {
  readonly latitude: number;
  readonly altitude: number;
  readonly points?: number;
}): RouteProfile {
  const count = options.points ?? 60;
  const metresPerDegreeLongitude = 111_320 * Math.cos((options.latitude * Math.PI) / 180);
  const points: RoutePoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(options.latitude),
        degreesLongitude((index * 10) / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(options.altitude),
    });
  }
  return routeProfile(points);
}

/** `0x7fb4e0` → `'#7fb4e0'`, which is what `design/contrast.ts` parses. */
function hex(packed: number): string {
  return `#${packed.toString(16).padStart(6, '0')}`;
}

function channels(packed: number): { r: number; g: number; b: number } {
  return { r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff };
}

/** How far apart two packed colours are, per channel. */
function distance(a: number, b: number): number {
  const from = channels(a);
  const to = channels(b);
  return Math.hypot(from.r - to.r, from.g - to.g, from.b - to.b);
}

describe('worldStyle is a pure function of the route', () => {
  it('returns the same world for the same profile, twice', () => {
    const profile = routeAt({ latitude: 46, altitude: 1200 });

    expect(worldStyle(profile)).toEqual(worldStyle(profile));
  });

  it('returns the same world for a second, structurally identical profile', () => {
    // Stronger than calling twice with one object: this also fails if the
    // result were ever memoised on identity, or carried a value from outside
    // the profile — a clock, a counter, a random seed.
    expect(worldStyle(routeAt({ latitude: 46, altitude: 1200 }))).toEqual(
      worldStyle(routeAt({ latitude: 46, altitude: 1200 })),
    );
  });

  it('gives a sea-level coastal route and an alpine one different colours', () => {
    // #240's own example, and the criterion a constant fails: "a sea-level
    // coastal route and a 2,000 m alpine route must not look identical, and the
    // difference must come from the route".
    const coastal = worldStyle(routeAt({ latitude: 5, altitude: 0 }));
    const alpine = worldStyle(routeAt({ latitude: 46, altitude: 2000 }));

    expect(coastal.skyColour).not.toBe(alpine.skyColour);
    expect(coastal.groundColour).not.toBe(alpine.groundColour);
    expect(coastal.horizonColour).not.toBe(alpine.horizonColour);
  });

  it('moves the sky on latitude alone, at one altitude', () => {
    // Separated from the test above so that an implementation which read only
    // the altitude could not pass by accident.
    expect(worldStyle(routeAt({ latitude: 5, altitude: 0 })).skyColour).not.toBe(
      worldStyle(routeAt({ latitude: 60, altitude: 0 })).skyColour,
    );
  });

  it('moves the sky on altitude alone, at one latitude', () => {
    expect(worldStyle(routeAt({ latitude: 46, altitude: 0 })).skyColour).not.toBe(
      worldStyle(routeAt({ latitude: 46, altitude: 2000 })).skyColour,
    );
  });

  it('moves the ground on latitude alone, at one altitude', () => {
    expect(worldStyle(routeAt({ latitude: 5, altitude: 0 })).groundColour).not.toBe(
      worldStyle(routeAt({ latitude: 60, altitude: 0 })).groundColour,
    );
  });
});

describe('the colours are ones a renderer can use', () => {
  const places = [
    { latitude: 0, altitude: 0 },
    { latitude: 5, altitude: 300 },
    { latitude: 46, altitude: 2000 },
    { latitude: 68, altitude: 50 },
    { latitude: 89, altitude: 0 },
    { latitude: 31, altitude: -400 },
    { latitude: 28, altitude: WORLD_HIGHEST_LAND_METRES },
  ] as const;

  it.each(places)('packs three whole bytes at %j', (place) => {
    const style = worldStyle(routeAt(place));

    for (const colour of [style.skyColour, style.groundColour, style.horizonColour]) {
      expect(Number.isInteger(colour)).toBe(true);
      expect(colour).toBeGreaterThanOrEqual(0);
      expect(colour).toBeLessThanOrEqual(0xff_ff_ff);
    }
  });

  it.each(places)('keeps the sky blue-dominant at %j', (place) => {
    // The property that has to survive being blended on two axes at once: a
    // blend of blue-dominant endpoints is blue-dominant, so the sky reads as
    // sky everywhere. A fourth endpoint added without this property would go
    // red here rather than in a reviewer's eye.
    const { r, g, b } = channels(worldStyle(routeAt(place)).skyColour);

    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it('brightens the ground monotonically as a route climbs out of the trees', () => {
    const at = (altitude: number): number =>
      relativeLuminance(hex(worldStyle(routeAt({ latitude: 0, altitude })).groundColour));

    const valley = at(0);
    const treeLine = at(TREE_LINE_AT_EQUATOR_METRES);
    const snow = at(TREE_LINE_AT_EQUATOR_METRES + SNOW_BAND_METRES);

    expect(treeLine).toBeGreaterThan(valley);
    expect(snow).toBeGreaterThan(treeLine);
  });

  it('reads the tree line off the latitude, not off a single altitude', () => {
    // 2 000 m is deep in the forest at the equator and well above it at 60°.
    // An implementation with one global tree-line threshold gives these two the
    // same ground and fails here.
    const equatorial = worldStyle(routeAt({ latitude: 0, altitude: 2000 })).groundColour;
    const northern = worldStyle(routeAt({ latitude: 60, altitude: 2000 })).groundColour;

    expect(relativeLuminance(hex(northern))).toBeGreaterThan(relativeLuminance(hex(equatorial)));
  });

  it('draws a horizon band that is not simply the sky', () => {
    // Without this there is nothing for the fogged ground to fade into and no
    // horizon at all: the distant road would meet the sky at its own colour.
    const sea = worldStyle(routeAt({ latitude: 46, altitude: 0 }));

    expect(sea.horizonColour).not.toBe(sea.skyColour);
  });

  it('moves the horizon from the haze towards the sky as the air thins', () => {
    // Measured as a fraction of the whole haze-to-sky span, because the sky
    // itself moves a long way on the altitude axis: the absolute gap can widen
    // while the horizon is unambiguously closer to its own sky.
    const towardsSky = (style: { horizonColour: number; skyColour: number }): number =>
      distance(style.horizonColour, style.skyColour) / distance(HORIZON_HAZE, style.skyColour);

    expect(towardsSky(worldStyle(routeAt({ latitude: 46, altitude: 4000 })))).toBeLessThan(
      towardsSky(worldStyle(routeAt({ latitude: 46, altitude: 0 }))),
    );
  });
});

describe('the fog is derived, and is bounded at both ends', () => {
  it('is thinner where the air is thinner', () => {
    // The clear-day / hazy-day pair. The argument is physical rather than
    // decorative: `@onyourleft/physics`'s ISO 2533 model says there is 26 %
    // less air at 2 500 m, and there is correspondingly less to see through.
    const hazy = worldStyle(routeAt({ latitude: 46, altitude: 0 })).fogDensity;
    const clear = worldStyle(routeAt({ latitude: 46, altitude: 2500 })).fogDensity;

    expect(clear).toBeLessThan(hazy);
  });

  it('is never negative, anywhere on earth', () => {
    for (const altitude of [-430, 0, 1000, 4000, WORLD_HIGHEST_LAND_METRES]) {
      expect(worldStyle(routeAt({ latitude: 46, altitude })).fogDensity).toBeGreaterThan(0);
    }
  });

  it('leaves the road under the rider alone', () => {
    // #241's stated bound, at zero depth and at the distance the chase camera
    // actually sits from the rider's own marker.
    //
    // ⚠️ **The zero-depth line cannot fail, and is here because the criterion
    // asks for it in those literal words.** `fogFactor(d, 0)` is
    // `1 − exp(−(d·0)²)` = 0 for every density, `Infinity` included, so it
    // pins the shape of the formula and nothing about this world. The line
    // under it is the one doing the work: it has about a 15× margin against
    // `NEAR_FOG_LIMIT` and goes red if the density rises to meet it.
    const densest = worldStyle(routeAt({ latitude: 46, altitude: -430 })).fogDensity;

    expect(fogFactor(densest, 0)).toBeLessThan(NEAR_FOG_LIMIT);
    expect(fogFactor(densest, CAMERA_BEHIND_METRES)).toBeLessThan(NEAR_FOG_LIMIT);
  });

  it('hides the cut end of the corridor at sea level', () => {
    // The reason to prefer fog to a longer corridor at all. Solved from
    // `FOG_OCCLUSION_AT_VIEW_END` and `terrain.ts`'s own view distance, so this
    // goes red if either moves without the other.
    const style = worldStyle(routeAt({ latitude: 46, altitude: 0 }));

    expect(fogFactor(style.fogDensity, VIEW_AHEAD_METRES)).toBeCloseTo(
      FOG_OCCLUSION_AT_VIEW_END,
      5,
    );
  });

  it('still hides the cut end on the highest land there is', () => {
    // Thinner air means a longer visual range, which is correct and is also the
    // case where the cut end would stop being hidden. The floor is what stops
    // that, and without it this reads 0.36 rather than 0.75.
    const style = worldStyle(routeAt({ latitude: 28, altitude: WORLD_HIGHEST_LAND_METRES }));

    expect(fogFactor(style.fogDensity, VIEW_AHEAD_METRES)).toBeGreaterThanOrEqual(
      MINIMUM_VIEW_END_OCCLUSION,
    );
  });

  it('never thickens the fog as a route climbs', () => {
    // The floor must not invert the derivation it bounds: it caps how thin the
    // fog gets and never makes a higher route hazier than a lower one.
    const densities = [-430, 0, 1000, 2500, 4000, WORLD_HIGHEST_LAND_METRES].map(
      (altitude) => worldStyle(routeAt({ latitude: 46, altitude })).fogDensity,
    );

    expect(densities).toEqual([...densities].sort((a, b) => b - a));
  });

  it('survives an elevation no place on earth has', () => {
    // A GPX is user-supplied input. The ISO 2533 model refuses an altitude
    // above the troposphere, and an unclamped mean would throw on the render
    // path — a blank screen mid-ride from a bad import.
    const absurd = routeProfile([
      {
        position: geographicPosition(degreesLatitude(46), degreesLongitude(2)),
        elevation: altitudeMetres(50_000),
      },
      {
        position: geographicPosition(degreesLatitude(46.01), degreesLongitude(2)),
        elevation: altitudeMetres(50_000),
      },
    ]);

    const style = worldStyle(absurd);

    expect(Number.isFinite(style.fogDensity)).toBe(true);
    expect(style.fogDensity).toBeGreaterThan(0);
    expect(Number.isInteger(style.skyColour)).toBe(true);
  });
});

describe('the cost of a frame does not grow with the length of the route', () => {
  it('reads at most WORLD_SAMPLE_LIMIT points however long the route is', () => {
    let reads = 0;
    const long = routeAt({ latitude: 46, altitude: 500, points: 4000 });
    const counted: RouteProfile = {
      ...long,
      positions: new Proxy(long.positions, {
        get(target, key, receiver): unknown {
          if (typeof key === 'string' && /^\d+$/.test(key)) {
            reads += 1;
          }
          return Reflect.get(target, key, receiver) as unknown;
        },
      }),
    };

    worldStyle(counted);

    expect(long.positions.length).toBeGreaterThan(WORLD_SAMPLE_LIMIT);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(WORLD_SAMPLE_LIMIT);
  });

  it('still describes the same place when it strides', () => {
    // Striding must not change the answer for a route that is uniform, which is
    // what says the bound is a sampling decision and not a different function.
    expect(worldStyle(routeAt({ latitude: 46, altitude: 500, points: 4000 }))).toEqual(
      worldStyle(routeAt({ latitude: 46, altitude: 500, points: 60 })),
    );
  });
});

/**
 * The world has one light direction — #286.
 *
 * ⚠️ **Properties, not numbers, and each one is a constant that could
 * otherwise be set to zero with the suite still green.** That is #241's own
 * lesson quoted back by #286: `fog.density = 0` left all nineteen browser
 * tests passing, and the three constants added here — the ambient share, the
 * two ends of the elevation band — are exactly the same shape. So every
 * assertion below is written so that zeroing the constant it rests on turns it
 * red, and the mutation list in the pull request says which.
 *
 * The arithmetic is {@link irradianceOn}, which is `@unwired` on purpose: it
 * is this file's copy of the Lambert term three's own shader computes, exactly
 * as {@link fogFactor} is its copy of `FogExp2`. What the *renderer* does with
 * the two intensities is `three-renderer.test.ts`'s claim, and what reaches a
 * real drawing buffer is `game.browser.spec.ts`'s.
 */
describe('the sun', () => {
  /** Straight up, which is the ground plane's and the road's own normal. */
  const UP = [0, 1, 0] as const;

  it('points somewhere real, as a unit vector', () => {
    for (const latitude of [0, 23, 46, 68, 89]) {
      const { sun } = worldStyle(routeAt({ latitude, altitude: 300 }));

      expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 12);
      // Above the horizon on every route there is: a sun at or below it lights
      // nothing a rider is looking at, and `direct` would diverge.
      expect(sun.y).toBeGreaterThan(0);
    }
  });

  it('is not straight overhead, so a vertical face has a lit side', () => {
    // The flatness #286 exists to remove is a *vertical* face with no lit
    // side, which is exactly what a sun at the zenith gives every tree on the
    // route. So the sun keeps a horizontal component everywhere.
    for (const latitude of [0, 45, 89]) {
      const { sun } = worldStyle(routeAt({ latitude, altitude: 0 }));

      expect(Math.hypot(sun.x, sun.z)).toBeGreaterThan(0.3);
    }
  });

  it('sinks toward the horizon as the route moves toward a pole', () => {
    // The one fact in this file's sun that is not a choice — the same one
    // `warmth` already rests on. Asserted as a monotone fall rather than as
    // two numbers, so it survives the band being retuned.
    const elevations = [0, 20, 40, 60, 80, 89].map(
      (latitude) => worldStyle(routeAt({ latitude, altitude: 0 })).sun.y,
    );

    for (let index = 1; index < elevations.length; index += 1) {
      expect(elevations[index] as number).toBeLessThan(elevations[index - 1] as number);
    }
  });

  it('stays inside the band both ends of it were chosen for', () => {
    const radians = (degrees: number) => Math.sin((degrees * Math.PI) / 180);

    for (const latitude of [0, 31, 62, 89]) {
      const { sun } = worldStyle(routeAt({ latitude, altitude: 1200 }));

      expect(sun.y).toBeGreaterThanOrEqual(radians(SUN_ELEVATION_AT_POLE_DEGREES) - 1e-12);
      expect(sun.y).toBeLessThanOrEqual(radians(SUN_ELEVATION_AT_EQUATOR_DEGREES) + 1e-12);
    }
  });

  it('leaves a horizontal surface at exactly the light it would have unlit', () => {
    // ⚠️ **The property the whole change rests on.** The ground plane and the
    // road stay `MeshBasicMaterial`, which draws a colour with no light on it
    // at all; everything standing on them is lit. The two only agree because
    // `direct` is *solved* from this identity rather than written down, and a
    // hand-written pair of intensities would put the scenery at a different
    // brightness from the ground under it on every route but one.
    for (const latitude of [0, 12, 37, 55, 74, 89]) {
      for (const altitude of [-430, 0, 900, 3400, 8849]) {
        const { sun } = worldStyle(routeAt({ latitude, altitude }));

        expect(irradianceOn(sun, UP[0], UP[1], UP[2])).toBeCloseTo(1, 12);
      }
    }
  });

  it('leaves a shaded face readable rather than black', () => {
    // The lower bound on `SUN_AMBIENT_SHARE`. Set it to 0 and a face turned
    // away from the sun receives nothing at all, and the scenery reads as
    // silhouettes — which on a phone in sunlight is worse than the flat scene
    // #286 replaced, not better.
    const { sun } = worldStyle(routeAt({ latitude: 51, altitude: 100 }));
    const away = irradianceOn(sun, -sun.x, -sun.y, -sun.z);

    expect(away).toBe(SUN_AMBIENT_SHARE);
    expect(away).toBeGreaterThan(0.2);
  });

  it('gives a sunward face a real lead over a shaded one', () => {
    // The upper bound on `SUN_AMBIENT_SHARE`, and #286's first criterion in
    // arithmetic: *a form-giving difference between a lit and an unlit face*.
    // Set the share to 1 and `direct` is 0, every face receives the same
    // light, and the scene is exactly as flat as it was before #286 — with a
    // shading pass paid for and nothing bought.
    for (const latitude of [0, 45, 89]) {
      const { sun } = worldStyle(routeAt({ latitude, altitude: 0 }));
      // A vertical face turned to the sun's own compass bearing, which is the
      // brightest a tree trunk or a building wall ever gets.
      const across = Math.hypot(sun.x, sun.z);
      const lit = irradianceOn(sun, sun.x / across, 0, sun.z / across);
      const shaded = irradianceOn(sun, -sun.x / across, 0, -sun.z / across);

      expect(shaded).toBe(SUN_AMBIENT_SHARE);
      expect(lit / shaded).toBeGreaterThan(1.4);
    }
  });

  it('never lights anything harder than PEAK_IRRADIANCE says', () => {
    // What `three-renderer.test.ts` multiplies through the palette. A face
    // square-on to the sun is the worst case by construction, and the worst
    // route is the one with the lowest sun — so this states the bound over
    // both, in this file, where the colours are invisible.
    for (const latitude of [0, 28, 59, 89]) {
      const { sun } = worldStyle(routeAt({ latitude, altitude: 0 }));

      expect(irradianceOn(sun, sun.x, sun.y, sun.z)).toBeLessThanOrEqual(PEAK_IRRADIANCE + 1e-12);
    }
    // And it is above 1, or a horizontal surface could not be at exactly 1.
    expect(PEAK_IRRADIANCE).toBeGreaterThan(1);
  });

  it('stands where the azimuth says, not on an axis of the corridor', () => {
    // A sun on the corridor's own x or z axis lights a road running that way
    // head-on and gives its two verges the same shade. Both components are
    // therefore required to be real, which is what `SUN_AZIMUTH_DEGREES` is
    // for — and setting it to 0 or 90 turns this red.
    const { sun } = worldStyle(routeAt({ latitude: 51, altitude: 0 }));
    const across = Math.hypot(sun.x, sun.z);

    expect(Math.abs(sun.x) / across).toBeGreaterThan(0.2);
    expect(Math.abs(sun.z) / across).toBeGreaterThan(0.2);
    // And it is the azimuth this file names rather than some other bearing:
    // atan2(east, north), which is a compass bearing clockwise from north.
    const bearing = (Math.atan2(sun.x, sun.z) * 180) / Math.PI;
    expect(((bearing % 360) + 360) % 360).toBeCloseTo(SUN_AZIMUTH_DEGREES, 9);
  });

  it('is a function of the route like everything else here', () => {
    // #240's FR-2: the world is derived from the rider's own GPX and from
    // nothing else, so two routes in different places get different suns and
    // the same route twice gets the same one.
    const alpine = worldStyle(routeAt({ latitude: 46, altitude: 1800 })).sun;
    const tropical = worldStyle(routeAt({ latitude: 2, altitude: 40 })).sun;

    expect(alpine.y).not.toBeCloseTo(tropical.y, 3);
    expect(worldStyle(routeAt({ latitude: 46, altitude: 1800 })).sun).toEqual(alpine);
  });
});
