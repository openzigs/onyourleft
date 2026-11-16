// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Overpasses and underpasses — #2661. Read back through `overpassesAt` and
 * `sceneFrame`, the path a ride's frames take to `three-renderer.ts`
 * §`BridgeBelt`: where a crossing is found and where none is, that nothing
 * of an overpass stands in the rider's way, and what a frame may carry.
 * Since #2699, that the belt draws an overpass as a bridge: read back out of
 * the instance buffers it hands the GPU.
 */

import { describe, expect, it } from 'vitest';

import { distanceOnRoute, elevationAt, metres, type RouteProfile } from '@onyourleft/domain';
import type { StreetFeature, StreetGrade } from '@onyourleft/map-features';

import { SIDE_ROAD_WIDTHS } from './cross-streets';
import { NO_LAND_CLASS } from './land-class';
import { terrainHeightAt } from './landform';
import {
  ABUTMENT_THICKNESS_METRES,
  mappedGradeCrossings,
  OVERPASS_CLEARANCE_METRES,
  OVERPASS_FRAME_PARTS,
  OVERPASS_SETBACK_METRES,
  overpassesAt,
  UNDERPASS_MARGIN_METRES,
  UNDERPASS_MAX_METRES,
  type GradeCrossing,
} from './overpasses';
import { nearestOnDrawnRoad } from './road-grid';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { BridgeBelt, OVERPASS_COLOURS } from './three-renderer';
import { corridorOrigin, drawnRoadFrame, ROAD_COLOUR, ROAD_WIDTH_METRES } from './terrain';
import { MAXIMUM_BRIDGE_PARTS, type BridgePart } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** Four kilometres of road due north, climbing 8 % — so a skew deck spans road of different heights. */
const CLIMB = northRoute(4_000, (along) => 40 + along * 0.08);
const ROAD_HALF = ROAD_WIDTH_METRES / 2;

function roadAt(profile: RouteProfile, along: number) {
  const frame = drawnRoadFrame(profile, corridorOrigin(profile), along);
  if (frame === undefined) throw new Error(`no road at ${String(along)}`);
  return { ...frame, forwardX: frame.normalZ, forwardZ: -frame.normalX };
}

/** A straight street across the road at `along`, `angle` degrees from its heading, `half` metres each side. */
function crossing(
  along: number,
  grade: StreetGrade,
  { angle = 90, half = 60, kind = 'major_road', profile = CLIMB, reversed = false } = {},
): StreetFeature {
  const here = roadAt(profile, along);
  const radians = (angle * Math.PI) / 180;
  // Drawn from the road's left to its right, or the other way round.
  const way = reversed ? -1 : 1;
  const dx = (here.forwardX * Math.cos(radians) + here.normalX * Math.sin(radians)) * way;
  const dz = (here.forwardZ * Math.cos(radians) + here.normalZ * Math.sin(radians)) * way;
  return {
    kind,
    kindDetail: '',
    grade,
    line: Float32Array.from([
      here.x - dx * half,
      here.z - dz * half,
      here.x + dx * half,
      here.z + dz * half,
    ]),
  };
}

function corridorOf(
  streets: readonly StreetFeature[],
  profile: RouteProfile = CLIMB,
  covered: (x: number, z: number) => boolean = () => true,
): WorldCorridor {
  return {
    routeId: 'overpasses-fixture',
    origin: corridorOrigin(profile),
    covered,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [],
    streets,
  };
}

function crossingsOf(
  streets: readonly StreetFeature[],
  profile: RouteProfile = CLIMB,
): readonly GradeCrossing[] {
  return mappedGradeCrossings(corridorOf(streets, profile), profile, corridorOrigin(profile));
}

/** Every box of the crossings within 100 m of `along`, the rider there. */
function boxesNear(
  crossings: readonly GradeCrossing[],
  along: number,
  profile: RouteProfile = CLIMB,
): readonly BridgePart[] {
  return overpassesAt(
    profile,
    corridorOrigin(profile),
    scatterSeed(profile),
    along - 100,
    along + 100,
    along,
    crossings,
    NO_LAND_CLASS,
  );
}

/** A box's frame as `three-renderer.ts` §`BridgeBelt.update` builds it: along, across (level) and up. */
function frameOf(part: BridgePart) {
  const length = Math.hypot(part.axisX, part.axisY, part.axisZ);
  const along = [part.axisX / length, part.axisY / length, part.axisZ / length] as const;
  // across = vertical × along, normalised.
  const ax = along[2];
  const az = -along[0];
  const al = Math.hypot(ax, az);
  const across = [ax / al, 0, az / al] as const;
  // up = along × across.
  const up = [
    along[1] * across[2] - along[2] * across[1],
    along[2] * across[0] - along[0] * across[2],
    along[0] * across[1] - along[1] * across[0],
  ] as const;
  return { along, across, up };
}

/** Points through a box's volume, a grid of `n` a side, `[x, y, z]`. */
function pointsIn(part: BridgePart, n = 9): [number, number, number][] {
  const { along, across, up } = frameOf(part);
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let k = 0; k < n; k += 1) {
        const u = (i / (n - 1) - 0.5) * part.width;
        const v = (j / (n - 1) - 0.5) * part.height;
        const w = (k / (n - 1) - 0.5) * part.length;
        out.push([
          part.x + across[0] * u + up[0] * v + along[0] * w,
          part.y + across[1] * u + up[1] * v + along[1] * w,
          part.z + across[2] * u + up[2] * v + along[2] * w,
        ]);
      }
    }
  }
  return out;
}

/** Whether `(x, y, z)` is inside a box. */
function inside(part: BridgePart, x: number, y: number, z: number): boolean {
  const { along, across, up } = frameOf(part);
  const dx = x - part.x;
  const dy = y - part.y;
  const dz = z - part.z;
  const dot = (axis: readonly number[]) =>
    dx * (axis[0] as number) + dy * (axis[1] as number) + dz * (axis[2] as number);
  return (
    Math.abs(dot(across)) <= part.width / 2 + 1e-6 &&
    Math.abs(dot(up)) <= part.height / 2 + 1e-6 &&
    Math.abs(dot(along)) <= part.length / 2 + 1e-6
  );
}

function roadHeight(profile: RouteProfile, along: number): number {
  return elevationAt(profile, distanceOnRoute(profile, along)) - corridorOrigin(profile).elevation;
}

describe('where a mapped street crosses the route over or under it — #2661', () => {
  it('finds an overpass on a bridge and an underpass in a tunnel, and nothing at grade', () => {
    const found = crossingsOf([
      crossing(1_000, 'bridge', { kind: 'highway' }),
      // Mapped from the road's right to its left.
      crossing(1_400, 'tunnel', { angle: 60, half: 30, reversed: true }),
      crossing(1_800, 'ground'),
    ]);
    expect(found.map((each) => each.grade)).toEqual(['bridge', 'tunnel']);
    expect(found[0]?.along).toBeCloseTo(1_000, 0);
    expect(found[1]?.along).toBeCloseTo(1_400, 0);
    // A motorway on a bridge is the audit's case, and keeps its width.
    expect(found[0]?.widthClass).toBe('highway');
    // Its heading is the street's, towards the road's right.
    const road = roadAt(CLIMB, 1_400);
    const tunnel = found[1] as GradeCrossing;
    expect(tunnel.dx * road.normalX + tunnel.dz * road.normalZ).toBeCloseTo(
      Math.sin(Math.PI / 3),
      2,
    );
    // Where it crosses is on the drawn centreline.
    expect(
      nearestOnDrawnRoad(CLIMB, corridorOrigin(CLIMB), tunnel.x, tunnel.z, 2)?.distance,
    ).toBeLessThan(0.1);
  });

  it('finds none for a street along the route, a tunnel too long to see, or one off the land read', () => {
    // A bridge carrying the route's own street: it crosses the centreline at 10°.
    expect(crossingsOf([crossing(1_000, 'bridge', { angle: 10, half: 40 })])).toEqual([]);
    // The control: the same street at 40° is one.
    expect(crossingsOf([crossing(1_000, 'bridge', { angle: 40, half: 40 })])).toHaveLength(1);
    // A bored tunnel under the route, longer than anything a rider sees from it.
    expect(crossingsOf([crossing(1_000, 'tunnel', { half: UNDERPASS_MAX_METRES })])).toEqual([]);
    expect(
      crossingsOf([crossing(1_000, 'tunnel', { half: UNDERPASS_MAX_METRES / 2 - 1 })]),
    ).toHaveLength(1);
    // Outside the land the corridor read.
    const unread = corridorOf([crossing(1_000, 'bridge')], CLIMB, () => false);
    expect(mappedGradeCrossings(unread, CLIMB, corridorOrigin(CLIMB))).toEqual([]);
  });

  it('counts a way traced twice once, and two carriageways apart as two', () => {
    const twice = crossingsOf([crossing(1_000, 'bridge'), crossing(1_000.5, 'bridge')]);
    expect(twice).toHaveLength(1);
    const dual = crossingsOf([crossing(1_000, 'bridge'), crossing(1_020, 'bridge')]);
    expect(dual).toHaveLength(2);
  });

  it('is built once a corridor', () => {
    const corridor = corridorOf([crossing(1_000, 'bridge')]);
    const origin = corridorOrigin(CLIMB);
    expect(mappedGradeCrossings(corridor, CLIMB, origin)).toBe(
      mappedGradeCrossings(corridor, CLIMB, origin),
    );
  });
});

describe('an overpass — #2661', () => {
  for (const angle of [90, 35, 145]) {
    it(`stands nothing in the carriageway under its clearance, crossing at ${String(angle)}°`, () => {
      const found = crossingsOf([crossing(1_000, 'bridge', { angle, kind: 'highway' })]);
      const parts = boxesNear(found, 1_000);
      // A deck, two edge beams with their parapets, and two abutments.
      expect(parts).toHaveLength(5);
      const origin = corridorOrigin(CLIMB);
      let tested = 0;
      for (const part of parts) {
        for (const [x, y, z] of pointsIn(part)) {
          const near = nearestOnDrawnRoad(CLIMB, origin, x, z, ROAD_HALF + 0.5);
          if (near === undefined || near.distance > ROAD_HALF) continue;
          tested += 1;
          expect(y - roadHeight(CLIMB, near.along)).toBeGreaterThanOrEqual(
            OVERPASS_CLEARANCE_METRES - 1e-3,
          );
        }
      }
      // The deck does span the carriageway, so the check had points to hold.
      expect(tested).toBeGreaterThan(0);
    });

    it(`spans the road and stands on an abutment each side, crossing at ${String(angle)}°`, () => {
      const found = crossingsOf([crossing(1_000, 'bridge', { angle })]);
      const parts = boxesNear(found, 1_000);
      const deck = parts[0] as BridgePart;
      const there = found[0] as GradeCrossing;
      const underside = deck.y - deck.height / 2;
      // Its lowest — since #2699 its edge beams' feet — the clearance over the
      // highest road it spans, and no more than a metre and a half past it.
      const lowest = Math.min(...parts.slice(0, 3).map((part) => part.y - part.height / 2));
      expect(lowest - roadHeight(CLIMB, 1_000)).toBeGreaterThanOrEqual(OVERPASS_CLEARANCE_METRES);
      expect(lowest - roadHeight(CLIMB, 1_000)).toBeLessThan(OVERPASS_CLEARANCE_METRES + 1.5);
      expect(underside).toBeGreaterThan(lowest);
      // Over the middle of the road, over both its edges, and over both abutments' places.
      const sine = Math.sin((angle * Math.PI) / 180);
      const outer = ROAD_HALF + OVERPASS_SETBACK_METRES + ABUTMENT_THICKNESS_METRES;
      for (const lateral of [-outer, -ROAD_HALF, 0, ROAD_HALF, outer]) {
        const x = there.x + (there.dx * lateral) / sine;
        const z = there.z + (there.dz * lateral) / sine;
        expect(inside(deck, x, underside + 0.05, z), `lateral ${String(lateral)}`).toBe(true);
      }
      // Each abutment is beside the road, its face the setback off the edge,
      // from under the ground up to the deck's underside, and under the deck.
      const abutments = parts.slice(3);
      expect(abutments).toHaveLength(2);
      const origin = corridorOrigin(CLIMB);
      const seed = scatterSeed(CLIMB);
      for (const abutment of abutments) {
        const near = nearestOnDrawnRoad(CLIMB, origin, abutment.x, abutment.z, 20);
        expect(Math.abs(near?.lateral ?? 0)).toBeCloseTo(
          ROAD_HALF + OVERPASS_SETBACK_METRES + ABUTMENT_THICKNESS_METRES / 2,
          1,
        );
        expect(abutment.y + abutment.height / 2).toBeCloseTo(underside, 6);
        // Below the ground at both its ends and its middle, on a climbing road.
        const bottom = abutment.y - abutment.height / 2;
        for (const end of [-0.5, 0, 0.5]) {
          const x = abutment.x + abutment.axisX * abutment.length * end;
          const z = abutment.z + abutment.axisZ * abutment.length * end;
          const under = nearestOnDrawnRoad(CLIMB, origin, x, z, 20);
          expect(bottom, `end ${String(end)}`).toBeLessThan(
            terrainHeightAt(
              CLIMB,
              origin,
              seed,
              under?.along ?? 0,
              under?.lateral ?? 0,
              NO_LAND_CLASS,
            ),
          );
        }
        // Its top's middle is under the deck.
        expect(inside(deck, abutment.x, underside + 0.01, abutment.z)).toBe(true);
      }
    });
  }
});

describe('an underpass — #2661', () => {
  it('runs a parapet along each edge of the road over the street, outside the carriageway', () => {
    const angle = 50;
    const found = crossingsOf([crossing(2_000, 'tunnel', { angle, half: 30 })]);
    const parts = boxesNear(found, 2_000);
    expect(parts.length).toBeGreaterThan(0);
    const origin = corridorOrigin(CLIMB);
    const reach =
      SIDE_ROAD_WIDTHS.major / 2 / Math.sin((angle * Math.PI) / 180) + UNDERPASS_MARGIN_METRES;
    const sides = new Set<number>();
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const part of parts) {
      for (const [x, y, z] of pointsIn(part, 5)) {
        const near = nearestOnDrawnRoad(CLIMB, origin, x, z, ROAD_HALF + 2);
        expect(near, 'beside the road').toBeDefined();
        if (near === undefined) continue;
        // Never in the carriageway, and standing on the road's own height.
        expect(Math.abs(near.lateral)).toBeGreaterThanOrEqual(ROAD_HALF - 1e-3);
        expect(y - roadHeight(CLIMB, near.along)).toBeGreaterThan(-0.2);
        expect(y - roadHeight(CLIMB, near.along)).toBeLessThan(1.2);
        sides.add(Math.sign(near.lateral));
        from = Math.min(from, near.along);
        to = Math.max(to, near.along);
      }
    }
    expect([...sides].sort()).toEqual([-1, 1]);
    // Over the whole of the street's width on the road, and its margin.
    expect(from).toBeLessThanOrEqual(2_000 - reach + 0.5);
    expect(to).toBeGreaterThanOrEqual(2_000 + reach - 0.5);
  });
});

describe('what a frame carries — #2661', () => {
  it('draws only the crossings near the rider, nearest first, whole, and within its share of the belt', () => {
    const streets: StreetFeature[] = [];
    for (let along = 600; along < 1_400; along += 20) streets.push(crossing(along, 'bridge'));
    const found = crossingsOf(streets);
    expect(found.length).toBeGreaterThan(OVERPASS_FRAME_PARTS / 5);
    const parts = overpassesAt(
      CLIMB,
      corridorOrigin(CLIMB),
      scatterSeed(CLIMB),
      600,
      1_400,
      1_000,
      found,
      NO_LAND_CLASS,
    );
    expect(parts.length).toBeLessThanOrEqual(OVERPASS_FRAME_PARTS);
    expect(parts.length % 5).toBe(0);
    expect(parts.length).toBeGreaterThan(OVERPASS_FRAME_PARTS - 5);
    // Nearest the rider: the first deck is the one at 1 000 m.
    const near = nearestOnDrawnRoad(
      CLIMB,
      corridorOrigin(CLIMB),
      parts[0]?.x ?? 0,
      parts[0]?.z ?? 0,
      2,
    );
    expect(near?.along).toBeCloseTo(1_000, 0);
    // Out of the span, none.
    expect(
      overpassesAt(
        CLIMB,
        corridorOrigin(CLIMB),
        scatterSeed(CLIMB),
        2_000,
        2_400,
        2_200,
        found,
        NO_LAND_CLASS,
      ),
    ).toEqual([]);
  });

  it('finds a crossing on every lap of a loop', () => {
    const loop = circuitRoute(400, () => 40);
    const found = crossingsOf([crossing(500, 'bridge', { profile: loop })], loop);
    expect(found).toHaveLength(1);
    const total = loop.totalDistance;
    const lapTwo = overpassesAt(
      loop,
      corridorOrigin(loop),
      scatterSeed(loop),
      total + 400,
      total + 600,
      total + 500,
      found,
      NO_LAND_CLASS,
    );
    expect(lapTwo).toHaveLength(5);
    // And across the line, where the span starts on one lap and ends on the next.
    const early = crossingsOf([crossing(30, 'bridge', { profile: loop })], loop);
    const acrossTheLine = overpassesAt(
      loop,
      corridorOrigin(loop),
      scatterSeed(loop),
      total - 150,
      total + 150,
      total,
      early,
      NO_LAND_CLASS,
    );
    expect(acrossTheLine).toHaveLength(5);
  });

  it('reaches the frame’s bridges, which the renderer draws, and only with map data', () => {
    const corridor = corridorOf([crossing(1_000, 'bridge', { kind: 'highway' })]);
    const start = atStartLine(CLIMB);
    const input = {
      profile: CLIMB,
      origin: corridorOrigin(CLIMB),
      state: { ...start, ride: { ...start.ride, distance: metres(950) } },
    };
    const overhead = (bridges: readonly BridgePart[]): number =>
      bridges.filter((part) => part.y - roadHeight(CLIMB, 1_000) > OVERPASS_CLEARANCE_METRES)
        .length;
    const mapped = sceneFrame({ ...input, worldCorridor: corridor });
    expect(overhead(mapped.water.bridges)).toBeGreaterThanOrEqual(3);
    expect(mapped.water.bridges.length).toBeLessThanOrEqual(MAXIMUM_BRIDGE_PARTS);
    const without = sceneFrame(input);
    expect(overhead(without.water.bridges)).toBe(0);
    // And the belt the view draws them with has every box — since #2699 an
    // overpass's in its own mesh — the deck where the frame put it.
    const belt = new BridgeBelt();
    belt.update(mapped.water.bridges);
    const overpasses = mapped.water.bridges.filter((part) => part.finish !== undefined);
    expect(overpasses.length).toBeGreaterThanOrEqual(5);
    expect(belt.mesh.count + belt.overpassMesh.count).toBe(mapped.water.bridges.length);
    expect(belt.overpassMesh.count).toBe(overpasses.length);
    expect(belt.overpassMesh.visible).toBe(true);
    const deck = overpasses.findIndex(
      (part) => part.y - roadHeight(CLIMB, 1_000) > OVERPASS_CLEARANCE_METRES && part.width > 9,
    );
    expect(deck).toBeGreaterThanOrEqual(0);
    const read = belt.overpassMesh.instanceMatrix.array as Float32Array;
    expect(read[deck * 16 + 13]).toBeCloseTo(overpasses[deck]?.y ?? 0, 4);
    belt.dispose();
  });
});

/** A hex colour's channels in the linear space three holds a `Color` in. */
function linearOf(hex: number): [number, number, number] {
  const channel = (byte: number): number => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((hex >> 16) & 0xff), channel((hex >> 8) & 0xff), channel(hex & 0xff)];
}

function luminanceOf([r, g, b]: readonly number[]): number {
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** One drawn box, read back out of the instance buffers `BridgeBelt.update` filled. */
interface DrawnBox {
  readonly centre: [number, number, number];
  /** Unit axes: across (level), up and along, the matrix's three columns. */
  readonly across: [number, number, number];
  readonly along: [number, number, number];
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly bottom: number;
  readonly top: number;
  readonly colour: [number, number, number];
}

function drawnBoxes(mesh: BridgeBelt['overpassMesh']): DrawnBox[] {
  const matrices = mesh.instanceMatrix.array as Float32Array;
  const colours = mesh.instanceColor?.array as Float32Array | undefined;
  const out: DrawnBox[] = [];
  for (let index = 0; index < mesh.count; index += 1) {
    const e = matrices.subarray(index * 16, index * 16 + 16);
    const column = (c: number): { unit: [number, number, number]; size: number } => {
      const x = e[c * 4] as number;
      const y = e[c * 4 + 1] as number;
      const z = e[c * 4 + 2] as number;
      const size = Math.hypot(x, y, z);
      return { unit: [x / size, y / size, z / size], size };
    };
    const across = column(0);
    const up = column(1);
    const along = column(2);
    const y = e[13] as number;
    out.push({
      centre: [e[12] as number, y, e[14] as number],
      across: across.unit,
      along: along.unit,
      width: across.size,
      height: up.size,
      length: along.size,
      bottom: y - (up.size * up.unit[1]) / 2,
      top: y + (up.size * up.unit[1]) / 2,
      colour: [
        colours?.[index * 3] ?? Number.NaN,
        colours?.[index * 3 + 1] ?? Number.NaN,
        colours?.[index * 3 + 2] ?? Number.NaN,
      ],
    });
  }
  return out;
}

function sameColour(found: readonly number[], hex: number): boolean {
  return linearOf(hex).every((channel, at) => Math.abs((found[at] as number) - channel) < 1e-4);
}

describe('an overpass reads as a bridge from the bike — #2699', () => {
  for (const angle of [90, 35]) {
    it(`draws a road-coloured deck with a concrete edge each side and supports to the ground, crossing at ${String(angle)}°`, () => {
      const found = crossingsOf([crossing(1_000, 'bridge', { angle })]);
      const belt = new BridgeBelt();
      belt.update(boxesNear(found, 1_000));
      // None of it in the stream bridges' stone, which #2687 read as a brown slab.
      expect(belt.mesh.count).toBe(0);
      expect(belt.overpassMesh.visible).toBe(true);
      const boxes = drawnBoxes(belt.overpassMesh);
      expect(boxes).toHaveLength(5);

      // The deck: the road's own colour, being the road the street runs on.
      const decks = boxes.filter((box) => sameColour(box.colour, ROAD_COLOUR));
      expect(decks).toHaveLength(1);
      const deck = decks[0] as DrawnBox;
      const concrete = boxes.filter((box) => sameColour(box.colour, OVERPASS_COLOURS.concrete));
      expect(concrete).toHaveLength(4);
      // The concrete reads against the deck: at least 3 : 1 in luminance.
      expect(
        (luminanceOf(concrete[0]?.colour ?? []) + 0.05) / (luminanceOf(deck.colour) + 0.05),
      ).toBeGreaterThanOrEqual(3);

      // An edge each side of the deck: along all of it, proud of its side,
      // hanging below its underside and standing above its top as the parapet.
      const offset = (box: DrawnBox): number =>
        (box.centre[0] - deck.centre[0]) * deck.across[0] +
        (box.centre[2] - deck.centre[2]) * deck.across[2];
      const parallel = (box: DrawnBox): number =>
        Math.abs(
          box.along[0] * deck.along[0] +
            box.along[1] * deck.along[1] +
            box.along[2] * deck.along[2],
        );
      const edges = concrete.filter((box) => parallel(box) > 0.999);
      expect(edges.map((box) => Math.sign(offset(box))).sort()).toEqual([-1, 1]);
      for (const edge of edges) {
        expect(Math.abs(offset(edge)) + edge.width / 2).toBeGreaterThan(deck.width / 2 + 0.1);
        expect(Math.abs(offset(edge)) - edge.width / 2).toBeLessThan(deck.width / 2);
        expect(edge.bottom).toBeLessThan(deck.bottom - 0.2);
        expect(edge.top).toBeGreaterThan(deck.top + 0.5);
        expect(edge.length).toBeGreaterThanOrEqual(deck.length - 1e-3);
      }

      // A support each side of the road, from under the ground up to the deck.
      const origin = corridorOrigin(CLIMB);
      const seed = scatterSeed(CLIMB);
      const supports = concrete.filter((box) => parallel(box) <= 0.999);
      const sides = new Set<number>();
      for (const support of supports) {
        const near = nearestOnDrawnRoad(CLIMB, origin, support.centre[0], support.centre[2], 20);
        expect(near).toBeDefined();
        if (near === undefined) continue;
        sides.add(Math.sign(near.lateral));
        expect(Math.abs(near.lateral)).toBeGreaterThan(ROAD_HALF);
        // Into the ground along the whole of its foot, on a climbing road: no gap under either end.
        for (const end of [-0.5, 0, 0.5]) {
          const x = support.centre[0] + support.along[0] * support.length * end;
          const z = support.centre[2] + support.along[2] * support.length * end;
          const under = nearestOnDrawnRoad(CLIMB, origin, x, z, 20);
          expect(under, `end ${String(end)}`).toBeDefined();
          expect(support.bottom, `end ${String(end)}`).toBeLessThan(
            terrainHeightAt(
              CLIMB,
              origin,
              seed,
              under?.along ?? 0,
              under?.lateral ?? 0,
              NO_LAND_CLASS,
            ),
          );
        }
        expect(support.top).toBeGreaterThanOrEqual(deck.bottom - 1e-3);
      }
      expect([...sides].sort()).toEqual([-1, 1]);
      belt.dispose();
    });
  }

  it('keeps the overpass out of the stone on a realistic rung, and the stream bridges in it', () => {
    const belt = new BridgeBelt();
    // Stand-ins, as `terrain-belt.test.ts`'s stone test uses: this file may not import three.
    const stone = { colour: { name: 'colour' } as never, normal: { name: 'normal' } as never };
    belt.setWorld('realistic', stone);
    expect(belt.wearsStone).toBe(true);
    const material = belt.overpassMesh.material as unknown as { readonly map: unknown };
    expect(material).not.toBe(belt.mesh.material);
    expect(material.map ?? null).toBeNull();
    belt.dispose();
  });
});
