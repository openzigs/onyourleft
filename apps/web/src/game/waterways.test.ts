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
import {
  TERRAIN_COLUMN_OFFSETS,
  VERGE_DROP_METRES,
  WET_GROUND_TINT,
  terrainHeightAt,
} from './landform';
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
import { ROAD_WIDTH_METRES, corridorOrigin, roadCorridor } from './terrain';
import type { GradientTrainer } from './trainer-port';
import {
  BRIDGE_CLEARANCE_METRES,
  BRIDGE_HALF_SPAN_METRES,
  CHANNEL_BANK_METRES,
  COPING_DEPTH_METRES,
  COPING_OVERHANG_METRES,
  PARAPET_HEIGHT_METRES,
  PARAPET_THICKNESS_METRES,
  STREAM_DEPTH_METRES,
  STREAM_SURFACE_HALF_WIDTH_METRES,
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
    // ⚠️ Copied out before the second build: since #469 the surface's arrays
    // are lent views of storage the next build writes over.
    const first = surface(near);
    expect(first.indices.length).toBeGreaterThan(0);
    const firstVertices = [...first.vertices];
    const third = surface(near + 2 * profile.totalDistance);
    expect([...third.vertices]).toEqual(firstVertices);
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

  it('never leaves the road over an open trench beyond the abutments — #468 review B2', () => {
    // The channel lowers the ground at the road's edge for CHANNEL_BANK_METRES
    // either side of the stream; the bridge spans BRIDGE_HALF_SPAN_METRES. On
    // #468's first head the road stood 3.7 m over the ground 10 m out and
    // 1.9 m at 20 m, with nothing under it. So: wherever the DRAWN ground at
    // the foot of the verge is below the road by more than the verge's own
    // drop, and it is not the bridge's opening, some part must stand there
    // from the road down to that ground, under the road's edge.
    const columns = TERRAIN_COLUMN_OFFSETS.length;
    const roadEdge = TERRAIN_COLUMN_OFFSETS[1] as number;
    let open = 0;
    let held = 0;
    // The corridor's rows slide with the rider, so ask from several places.
    for (let rider = crossing - 80; rider <= crossing - 50; rider += 3) {
      const frame = frameAt(profile, rider);
      const ground = frame.terrain.mesh;
      const parts = frame.water.bridges;
      frame.corridor.centre.forEach((point, row) => {
        const u = Math.abs(point.along - crossing);
        if (u > CHANNEL_BANK_METRES + 10) return;
        for (let side = 0; side < 2; side += 1) {
          const y = ground.vertices[(row * columns * 2 + side * columns + 1) * 3 + 1] as number;
          if (y >= point.y - VERGE_DROP_METRES - 0.05) continue;
          if (u <= BRIDGE_HALF_SPAN_METRES) {
            open += 1;
            continue;
          }
          // The route runs north, so along the road is z and across it is x.
          // A part that follows the road's slope is higher at one end: read
          // its top and bottom where this row is, not at its middle.
          const holding = parts.some((part) => {
            if (Math.abs(part.z - point.z) > part.length / 2 + 1e-6) return false;
            const rise = part.axisZ === 0 ? 0 : ((point.z - part.z) * part.axisY) / part.axisZ;
            return (
              part.width / 2 >= roadEdge &&
              part.y + rise + part.height / 2 >= point.y - 0.1 &&
              part.y + rise - part.height / 2 <= y + 0.05
            );
          });
          expect(holding, `the road ${u.toFixed(1)} m from the stream, side ${String(side)}`).toBe(
            true,
          );
          held += 1;
        }
      });
    }
    // Non-vacuity: the channel really is under the opening, and really does
    // lower the ground at the road's edge past the abutments.
    expect(open).toBeGreaterThan(10);
    expect(held).toBeGreaterThan(10);
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

describe('the road is continuous across the bridge — #501', () => {
  // Validation 0002 Z10: *"a light seam runs across the road where the bridge
  // deck starts"*. The deck is the road, so a line across it is something of
  // the bridge's showing THROUGH it. What was found: the abutment was a LEVEL
  // box three metres long under a road that slopes down into the valley, so
  // its top stood above the road over the half of it on the downhill side —
  // 4.5 cm on this 5 % valley, 9 cm on the soak route's 8 %, and a lit stone
  // face is lighter than tarmac. So: no part of any bridge may stand above the
  // road DRAWN over it, anywhere under the carriageway.

  /** How far a bridge part's top stands above the drawn road, at worst, under the carriageway. */
  function worstRise(profile: RouteProfile, rider: number): { rise: number; sampled: number } {
    const frame = frameAt(profile, rider);
    const rows = frame.corridor.centre;
    let rise = Number.NEGATIVE_INFINITY;
    let sampled = 0;
    for (const part of frame.water.bridges) {
      // The box's own frame, as `three-renderer.ts` §`BridgeBelt.update` builds it.
      const length = Math.hypot(part.axisX, part.axisY, part.axisZ);
      const along = [part.axisX / length, part.axisY / length, part.axisZ / length] as const;
      const flat = Math.hypot(along[0], along[2]);
      const across = [along[2] / flat, 0, -along[0] / flat] as const;
      const up = [
        along[1] * across[2] - along[2] * across[1],
        along[2] * across[0] - along[0] * across[2],
        along[0] * across[1] - along[1] * across[0],
      ] as const;
      for (let i = -1; i <= 1; i += 0.25) {
        for (let j = -1; j <= 1; j += 0.25) {
          const x =
            part.x +
            (along[0] * i * part.length + across[0] * j * part.width + up[0] * part.height) / 2;
          const y =
            part.y +
            (along[1] * i * part.length + across[1] * j * part.width + up[1] * part.height) / 2;
          const z =
            part.z +
            (along[2] * i * part.length + across[2] * j * part.width + up[2] * part.height) / 2;
          // The route runs north: across the carriageway is x, along it z.
          // (A parapet's inner face stands ON the road's edge, and above it.)
          if (Math.abs(x) >= ROAD_WIDTH_METRES / 2 - 0.01) continue;
          const next = rows.findIndex((row) => row.z >= z);
          if (next <= 0) continue;
          const [a, b] = [rows[next - 1], rows[next]] as const;
          if (a === undefined || b === undefined) continue;
          const road = a.y + ((b.y - a.y) * (z - a.z)) / (b.z - a.z);
          rise = Math.max(rise, y - road);
          sampled += 1;
        }
      }
    }
    return { rise, sampled };
  }

  it('stands no part of a bridge above the road drawn over it, wherever the rows fall', () => {
    // The 5 % valley, and a rolling road whose troughs are 12 % either side.
    for (const profile of [valleyRoute(), rollingRoute()]) {
      const crossing = waysOf(profile).crossings[0]?.distance ?? 0;
      let sampled = 0;
      for (let rider = crossing - 80; rider <= crossing - 70; rider += 1) {
        const worst = worstRise(profile, rider);
        expect(worst.rise, `rider at ${rider.toFixed(0)} m`).toBeLessThanOrEqual(0);
        sampled += worst.sampled;
      }
      // Non-vacuity: points under the carriageway were read — the deck slab's
      // and the abutments' tops among them.
      expect(sampled).toBeGreaterThan(100);
    }
  });
});

describe('the water has a bank — #501', () => {
  // Validation 0002 Z10: *"the water meets the grass with a hard, straight
  // edge and no bank"*. The surface now runs on under the bank, so the edge of
  // the quad is never what a rider sees: the drawn ground comes up out of the
  // water, and stands a visible height over it a little further out.

  /** The drawn ground at `u` metres along the road from the stream, column by column. */
  function groundAcross(
    profile: RouteProfile,
    rider: number,
    crossing: number,
    u: number,
  ): readonly number[] {
    const frame = frameAt(profile, rider);
    const rows = frame.corridor.centre;
    const mesh = frame.terrain.mesh;
    const columns = TERRAIN_COLUMN_OFFSETS.length;
    const next = rows.findIndex((row) => row.along >= crossing + u);
    const [a, b] = [rows[next - 1], rows[next]];
    if (next <= 0 || a === undefined || b === undefined) return [];
    const share = (crossing + u - a.along) / (b.along - a.along);
    const heights: number[] = [];
    for (let side = 0; side < 2; side += 1) {
      // From the foot of the verge out: the road's edge is the road's.
      for (let column = 2; column < columns; column += 1) {
        const y = (row: number): number =>
          mesh.vertices[(row * columns * 2 + side * columns + column) * 3 + 1] as number;
        heights.push(y(next - 1) + (y(next) - y(next - 1)) * share);
      }
    }
    return heights;
  }

  it('hides the edge of the stream’s surface under the ground, and rises out of it', () => {
    for (const profile of [valleyRoute(), rollingRoute()]) {
      const origin = corridorOrigin(profile);
      const ways = waysOf(profile);
      const crossing = ways.crossings[0]?.distance ?? 0;
      const water = (ways.crossings[0]?.waterElevation ?? 0) - origin.elevation;
      let read = 0;
      // The rows slide with the rider: every phase of them.
      for (let rider = crossing - 80; rider <= crossing - 70; rider += 1) {
        for (const side of [-1, 1]) {
          const edge = groundAcross(
            profile,
            rider,
            crossing,
            side * STREAM_SURFACE_HALF_WIDTH_METRES,
          );
          for (const height of edge) expect(height).toBeGreaterThan(water);
          // A visible drop: ten metres further out the ground stands over the
          // water by more than a rider on a bicycle's wheel is tall.
          const bank = groundAcross(
            profile,
            rider,
            crossing,
            side * (STREAM_SURFACE_HALF_WIDTH_METRES + 10),
          );
          for (const height of bank) expect(height).toBeGreaterThan(water + 1);
          read += edge.length + bank.length;
        }
      }
      expect(read).toBeGreaterThan(400);
      // And the water really is water where it is seen: the ground at the
      // stream itself is under it.
      for (const height of groundAcross(profile, crossing - 75, crossing, 0)) {
        expect(height).toBeLessThan(water);
      }
    }
  });

  it('darkens the ground just above the water to a wet margin, and nowhere dry', () => {
    const profile = valleyRoute();
    const frame = frameAt(profile, (waysOf(profile).crossings[0]?.distance ?? 0) - 75);
    const { colours } = frame.terrain.mesh;
    let wet = 0;
    let grey = 0;
    for (let at = 0; at < colours.length; at += 3) {
      const [r, g, b] = [colours[at], colours[at + 1], colours[at + 2]] as [number, number, number];
      if (r === g && g === b) {
        grey += 1;
        continue;
      }
      // Browner as well as darker: red over green over blue, as the tint is.
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      if (r < 0.7) wet += 1;
    }
    expect(wet).toBeGreaterThan(4);
    expect(grey).toBeGreaterThan(wet);
    // The ground under the water and at its edge is the wet tint itself.
    let darkest = 0;
    for (let at = 3; at < colours.length; at += 3) {
      if ((colours[at] as number) < (colours[darkest] as number)) darkest = at;
    }
    expect((colours[darkest + 2] as number) / (colours[darkest] as number)).toBeCloseTo(
      WET_GROUND_TINT[2] / WET_GROUND_TINT[0],
      3,
    );
    // The control: ground with no water near it is its own mottle, grey.
    const dry = frameAt(hillRoute(), 600).terrain.mesh.colours;
    for (let at = 0; at < dry.length; at += 3) {
      expect(dry[at]).toBe(dry[at + 2]);
    }
  });
});

describe('the parapets are a country bridge’s — #501', () => {
  it('lays a coping along the top of every parapet, proud of its outer face only', () => {
    const profile = valleyRoute();
    const origin = corridorOrigin(profile);
    const ways = waysOf(profile);
    const crossing = ways.crossings[0]?.distance ?? 0;
    const parts = bridgeParts(profile, origin, roadCorridor(profile, origin, crossing - 50), ways);
    const parapets = parts.filter(
      (part) => Math.abs(part.height - (PARAPET_HEIGHT_METRES + 0.1)) < 1e-9,
    );
    const copings = parts.filter((part) => Math.abs(part.height - COPING_DEPTH_METRES) < 1e-9);
    expect(parapets.length).toBeGreaterThan(4);
    expect(copings).toHaveLength(parapets.length);
    for (const parapet of parapets) {
      const coping = copings.find(
        (each) => Math.abs(each.z - parapet.z) < 1e-6 && Math.sign(each.x) === Math.sign(parapet.x),
      );
      expect(coping).toBeDefined();
      if (coping === undefined) continue;
      // Its top is the parapet's: no taller a wall.
      expect(coping.y + coping.height / 2).toBeCloseTo(parapet.y + parapet.height / 2, 6);
      // Wider, and the extra is all on the outside.
      expect(coping.width).toBeCloseTo(PARAPET_THICKNESS_METRES + COPING_OVERHANG_METRES, 9);
      const inner = (part: { x: number; width: number }): number =>
        Math.abs(part.x) - part.width / 2;
      expect(inner(coping)).toBeCloseTo(inner(parapet), 6);
      expect(Math.abs(coping.x) + coping.width / 2).toBeGreaterThan(
        Math.abs(parapet.x) + parapet.width / 2,
      );
    }
  });
});
