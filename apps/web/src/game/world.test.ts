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
import { VIEW_AHEAD_METRES } from './terrain';
import {
  FOG_OCCLUSION_AT_VIEW_END,
  HORIZON_HAZE,
  MINIMUM_VIEW_END_OCCLUSION,
  NEAR_FOG_LIMIT,
  SNOW_BAND_METRES,
  TREE_LINE_AT_EQUATOR_METRES,
  WORLD_HIGHEST_LAND_METRES,
  WORLD_SAMPLE_LIMIT,
  fogFactor,
  worldStyle,
} from './world';

/** How far behind the rider `three-renderer.ts` puts the chase camera. */
const CHASE_CAMERA_METRES = 8;

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
    const densest = worldStyle(routeAt({ latitude: 46, altitude: -430 })).fogDensity;

    expect(fogFactor(densest, 0)).toBeLessThan(NEAR_FOG_LIMIT);
    expect(fogFactor(densest, CHASE_CAMERA_METRES)).toBeLessThan(NEAR_FOG_LIMIT);
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
