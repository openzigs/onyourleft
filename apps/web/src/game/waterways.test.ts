// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `waterways.ts` — streams where the route's own elevation has a valley floor,
 * lakes beside its long flat low stretches, and bridges that carry the road
 * over the streams (#459).
 *
 * Every placement here is read off the route and a seed; the fixtures are
 * arithmetic, and a route with no valley is the control for a route with one.
 */

import { describe, expect, it } from 'vitest';

import {
  createSimulationDriver,
  elevationAt,
  gradeAt,
  metres,
  seconds,
  unixSeconds,
  type RouteProfile,
} from '@onyourleft/domain';

import { createGradientSession } from './gradient';
import { terrainHeightAt } from './landform';
import {
  circuitRoute,
  hillRoute,
  lakeValleyRoute,
  northRoute,
  rollingRoute,
  steadyClimb,
  valleyRoute,
} from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, roadCorridor } from './terrain';
import type { GradientTrainer } from './trainer-port';
import {
  BRIDGE_CLEARANCE_METRES,
  BRIDGE_HALF_SPAN_METRES,
  PARAPET_HEIGHT_METRES,
  STREAM_DEPTH_METRES,
  bridgeParts,
  inWater,
  waterSurface,
  waterways,
  type Waterways,
} from './waterways';

function waysOf(profile: RouteProfile): Waterways {
  return waterways(profile, scatterSeed(profile));
}

function frameAt(profile: RouteProfile, odometer: number) {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
  });
}

/** Whether a point in plan lies on a triangle of a surface. */
function onSurface(
  surface: { readonly vertices: Float32Array; readonly indices: Uint32Array },
  x: number,
  z: number,
): boolean {
  const { vertices: v, indices } = surface;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]].map(
      (index) => (index as number) * 3,
    ) as [number, number, number];
    const area =
      ((v[b] as number) - (v[a] as number)) * ((v[c + 2] as number) - (v[a + 2] as number)) -
      ((v[c] as number) - (v[a] as number)) * ((v[b + 2] as number) - (v[a + 2] as number));
    if (Math.abs(area) < 1e-9) continue;
    const u =
      (((v[b] as number) - x) * ((v[c + 2] as number) - z) -
        ((v[c] as number) - x) * ((v[b + 2] as number) - z)) /
      area;
    const w =
      (((v[c] as number) - x) * ((v[a + 2] as number) - z) -
        ((v[a] as number) - x) * ((v[c + 2] as number) - z)) /
      area;
    if (u >= 0 && w >= 0 && 1 - u - w >= 0) return true;
  }
  return false;
}

describe('where a stream crosses the road — #459', () => {
  it('finds one at the valley floor of a route that has one', () => {
    const profile = valleyRoute();
    const { crossings } = waysOf(profile);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]?.distance ?? 0).toBeCloseTo(1_000, -1);
    expect(crossings[0]?.waterElevation ?? 0).toBeCloseTo(
      elevationAt(profile, crossings[0]?.distance ?? 0) - BRIDGE_CLEARANCE_METRES,
      6,
    );
  });

  it('finds none on a route with no valley — the control', () => {
    // A steady climb has no floor at all; #458's hill has its lows at its two
    // ENDS, which have ground rising on one side only; a level road has no
    // floor to speak of.
    // ⚠️ And a descent onto a level plain: its foot IS the lowest point for
    // 300 m either way, but the ground rises on one side of it only, so water
    // would run on along the plain rather than cross the road.
    const ontoAPlain = northRoute(2_000, (along) => Math.max(0, 30 - along * 0.05));
    for (const profile of [steadyClimb(), hillRoute(), northRoute(2_000, () => 0), ontoAPlain]) {
      expect(waysOf(profile).crossings).toEqual([]);
    }
  });

  it('finds one in every trough of a rolling road and none on its crests', () => {
    const troughs = waysOf(rollingRoute()).crossings.map((each) => each.distance);
    // 12 sin(2π · d / 600) is lowest at 450 + 600 k — to within the profile's
    // own grid, whose despiking flattens a trough's bottom sample or two.
    expect(troughs).toHaveLength(4);
    [450, 1_050, 1_650, 2_250].forEach((trough, index) => {
      expect(Math.abs((troughs[index] ?? 0) - trough)).toBeLessThanOrEqual(10);
    });
  });

  it('lays a lake beside a level valley floor, and none beside a level plain', () => {
    const lakes = waysOf(lakeValleyRoute()).lakes;
    expect(lakes.length).toBeGreaterThan(0);
    for (const lake of lakes) {
      expect(lake.from).toBeGreaterThanOrEqual(690);
      expect(lake.to).toBeLessThanOrEqual(1_710);
    }
    // The same kilometre of level road with nothing rising round it.
    expect(waysOf(northRoute(2_600, () => 0)).lakes).toEqual([]);
  });

  it('is the same water on every lap', () => {
    // A circuit with a deep, narrow valley on it: the same crossing, and the
    // same surface, a whole lap apart.
    const radius = 400;
    const circumference = 2 * Math.PI * radius;
    const profile = circuitRoute(radius, (along) => {
      const from = Math.abs(along - circumference / 2);
      return Math.min(30, from * 0.1);
    });
    const crossings = waysOf(profile).crossings;
    expect(crossings).toHaveLength(1);
    const origin = corridorOrigin(profile);
    const near = (crossings[0]?.distance ?? 0) - 200;
    const surface = (odometer: number) =>
      waterSurface(profile, origin, roadCorridor(profile, origin, odometer), waysOf(profile));
    const first = surface(near);
    const third = surface(near + 2 * profile.totalDistance);
    expect(first.indices.length).toBeGreaterThan(0);
    expect([...third.vertices]).toEqual([...first.vertices]);
  });
});

describe('the bridge — #459', () => {
  const profile = valleyRoute();
  const origin = corridorOrigin(profile);
  const ways = waysOf(profile);
  const crossing = ways.crossings[0]?.distance ?? 0;
  const water = (ways.crossings[0]?.waterElevation ?? 0) - origin.elevation;

  it('carries the road over the water at the route’s own height', () => {
    // ⚠️ The deck is the ROAD — `terrain.ts`'s ribbon, unchanged — so what is
    // asserted is that the road stands above the water by the clearance, and
    // that the ground under it has been cut down to the channel's bed.
    const road = elevationAt(profile, crossing) - origin.elevation;
    expect(road - water).toBeCloseTo(BRIDGE_CLEARANCE_METRES, 6);
    const seed = scatterSeed(profile);
    for (const lateral of [4, -4, 10, -10, 40, -40]) {
      expect(terrainHeightAt(profile, origin, seed, crossing, lateral)).toBeLessThan(water);
    }
    // And away from the stream the ground is back beside the road.
    expect(terrainHeightAt(profile, origin, seed, crossing - 120, 8)).toBeGreaterThan(water + 2);
  });

  it('stands parapets on the deck and abutments into the bed, beside the road and never on it', () => {
    const parts = bridgeParts(profile, origin, roadCorridor(profile, origin, crossing - 50), ways);
    const road = elevationAt(profile, crossing) - origin.elevation;
    const parapets = parts.filter(
      (part) => Math.abs(part.height - (PARAPET_HEIGHT_METRES + 0.1)) < 1e-9,
    );
    expect(parapets.length).toBeGreaterThan(4);
    expect(road).toBeLessThan(elevationAt(profile, crossing - 30) - origin.elevation);
    for (const parapet of parapets) {
      // Its top is the parapet's height over the deck where it stands — the
      // route runs north, so where it stands along the road is its `z`.
      const deck = elevationAt(profile, parapet.z) - origin.elevation;
      // A piece is straight between its two ends, so over the valley's
      // bottom its middle sits a few centimetres off the curve.
      expect(
        Math.abs(parapet.y + parapet.height / 2 - (deck + PARAPET_HEIGHT_METRES)),
      ).toBeLessThan(0.1);
      // And it stands beside the carriageway: the route runs north, so beside
      // is a matter of x.
      expect(Math.abs(parapet.x)).toBeGreaterThan(3.5);
    }
    const tallest = Math.max(...parts.map((part) => part.height));
    const abutment = parts.find((part) => part.height === tallest);
    expect(abutment).toBeDefined();
    expect((abutment?.y ?? 0) - tallest / 2).toBeLessThan(water - STREAM_DEPTH_METRES);
    // Nothing is placed in view of a corridor that cannot see the bridge.
    expect(bridgeParts(profile, origin, roadCorridor(profile, origin, 2_600), ways)).toEqual([]);
  });

  it('tells the trainer the route’s gradient at the bridge, not a level deck’s', async () => {
    // #459's third criterion. The session is the one `GameView` drives, handed
    // the SAME profile the bridge was drawn from, and ridden across it; what it
    // sends is compared with what #90's driver makes of the route directly.
    const written: number[] = [];
    const trainer: GradientTrainer = {
      setSimulationParameters: async (parameters) => {
        written.push(parameters.grade);
        return Promise.resolve();
      },
      letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
    };
    const session = createGradientSession({ profile, control: trainer });
    const reference = createSimulationDriver({ profile });
    const expected: number[] = [];
    let clock = 0;
    for (let at = crossing - BRIDGE_HALF_SPAN_METRES - 60; at <= crossing + 60; at += 2) {
      clock += 1;
      session.sample(seconds(clock), at);
      const setpoint = reference.sample({ at: unixSeconds(clock), distance: metres(at) });
      if (setpoint !== undefined) expected.push(setpoint.grade);
      await session.settled();
    }
    expect(written.length).toBeGreaterThan(3);
    expect(written).toEqual(expected);
    // And the road is not level there: the valley's own sides slope 5 % down
    // into it and 5 % up out, so a deck flattened for the bridge would be
    // visible here as a run of zeros.
    expect(Math.max(...written.map(Math.abs))).toBeGreaterThan(1);
    expect(gradeAt(profile, crossing - 60)).toBeLessThan(-1);
  });
});

describe('nothing stands in the water — #459', () => {
  it('places no scenery on a stream or a lake, in plan', () => {
    let near = 0;
    let checked = 0;
    for (const profile of [valleyRoute(), lakeValleyRoute(), rollingRoute()]) {
      const ways = waysOf(profile);
      for (let at = 0; at < profile.totalDistance; at += 61) {
        const frame = frameAt(profile, at);
        for (const each of frame.scatter) {
          checked += 1;
          expect(
            onSurface(frame.water.surface, each.x, each.z),
            `${each.kind} at ${String(at)}`,
          ).toBe(false);
        }
        // Non-vacuity: this frame has water where scenery would stand — within
        // the scatter's own band, beside the road.
        const surface = frame.water.surface;
        for (let vertex = 0; vertex < surface.vertices.length / 3; vertex += 1) {
          if (Math.abs(surface.vertices[vertex * 3] as number) < 21.5) near += 1;
        }
      }
      expect(ways.crossings.length + ways.lakes.length).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(1_000);
    expect(near).toBeGreaterThan(0);
  });

  it('refuses the channel and its banks, and nothing away from them', () => {
    const profile = valleyRoute();
    const ways = waysOf(profile);
    const crossing = ways.crossings[0]?.distance ?? 0;
    expect(inWater(ways, profile, crossing, 10)).toBe(true);
    expect(inWater(ways, profile, crossing + 25, -18)).toBe(true);
    expect(inWater(ways, profile, crossing + 80, 10)).toBe(false);
    expect(inWater(ways, profile, 200, 10)).toBe(false);
  });
});
