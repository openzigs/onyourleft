// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Overpasses and underpasses — #2661. Read back through `gradeCrossingsAt` and
 * `sceneFrame`, the path a ride's frames take to `three-renderer.ts`
 * §`BridgeBelt`: where a crossing is found and where none is, that nothing
 * of an overpass stands in the rider's way, and what a frame may carry.
 * Since #2699, that the belt draws an overpass as a bridge: read back out of
 * the instance buffers it hands the GPU. And since the owner's "there are no
 * roads connected to it", that its street runs on off both ends of the deck:
 * read back out of the buffers `three-renderer.ts` §`SideRoadBelt` uploads.
 * And since the fourth round's "make supports less blocky", that each end of
 * the deck stands on a short seat in a grassy bank, with nothing standing as
 * a wall beside the bridge: read back out of `TerrainBelt`'s embankment mesh.
 */

import { describe, expect, it } from 'vitest';

import { distanceOnRoute, elevationAt, metres, type RouteProfile } from '@onyourleft/domain';
import type { StreetFeature, StreetGrade } from '@onyourleft/map-features';

import {
  SIDE_ROAD_END_WIDTH_SHARE,
  SIDE_ROAD_WIDTHS,
  TARMAC,
  type SideRoad,
} from './cross-streets';
import { NO_LAND_CLASS } from './land-class';
import { terrainHeightAt } from './landform';
import {
  ABUTMENT_FACE_METRES,
  ABUTMENT_THICKNESS_METRES,
  APPROACH_FADE_METRES,
  APPROACH_METRES,
  APPROACH_REACH_METRES,
  APPROACH_TRIANGLES_PER_OVERPASS,
  EMBANKMENT_FRAME_TRIANGLES,
  EMBANKMENT_MAX_RUN_METRES,
  EMBANKMENT_RUN,
  EMBANKMENT_TRIANGLES_PER_OVERPASS,
  gradeCrossingsAt,
  mappedGradeCrossings,
  OVERPASS_CLEAR_VERGE_METRES,
  OVERPASS_CLEARANCE_METRES,
  OVERPASS_EDGE_PROUD_METRES,
  OVERPASS_FRAME_PARTS,
  OVERPASS_ROAD_FRAME_TRIANGLES,
  OVERPASS_VERGE_HEIGHT_METRES,
  UNDERPASS_MARGIN_METRES,
  UNDERPASS_MAX_METRES,
  type Embankment,
  type GradeCrossing,
} from './overpasses';
import { nearestOnDrawnRoad } from './road-grid';
import { circuitRoute, northRoute, valleyRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  BridgeBelt,
  OVERPASS_COLOURS,
  PavementBelt,
  SideRoadBelt,
  TerrainBelt,
} from './three-renderer';
import { corridorOrigin, drawnRoadFrame, ROAD_COLOUR, ROAD_WIDTH_METRES } from './terrain';
import { MAXIMUM_BRIDGE_PARTS, waterways, type BridgePart } from './waterways';
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

/** The boxes of the crossings in view: what `scene.ts` hands the frame's bridges. */
function overpassesAt(
  ...args: Parameters<typeof gradeCrossingsAt>
): ReturnType<typeof gradeCrossingsAt>['parts'] {
  return gradeCrossingsAt(...args).parts;
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

/** The drawn embankments of the crossings within 100 m of `along`, the rider there: read back out of the ground's belt. */
function banksNear(crossings: readonly GradeCrossing[], along: number): BankTriangle[] {
  const inView = gradeCrossingsAt(
    CLIMB,
    corridorOrigin(CLIMB),
    scatterSeed(CLIMB),
    along - 100,
    along + 100,
    along,
    crossings,
    NO_LAND_CLASS,
  );
  const ground = new TerrainBelt();
  ground.updateEmbankments(inView.embankments);
  const triangles = bankTriangles(ground);
  ground.dispose();
  return triangles;
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

/** `0` at `0`, `1` at `1`, level at both ends, clamped — as `overpasses.ts` fades an approach. */
function smoothstep(share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return s * s * (3 - 2 * s);
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
      // A deck, two edge beams with their parapets, and two seats.
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
      // Each abutment is a seat beside the road, its front past the verge's
      // line, its back at the deck's end.
      const abutments = parts.slice(3);
      expect(abutments).toHaveLength(2);
      const origin = corridorOrigin(CLIMB);
      const laterals = abutments.map(
        (abutment) => nearestOnDrawnRoad(CLIMB, origin, abutment.x, abutment.z, 80)?.lateral ?? 0,
      );
      expect(laterals.map(Math.sign).sort()).toEqual([-1, 1]);
      for (const lateral of laterals) {
        expect(
          Math.abs(lateral) - ABUTMENT_THICKNESS_METRES / 2 - ROAD_HALF,
        ).toBeGreaterThanOrEqual(OVERPASS_CLEAR_VERGE_METRES);
      }
      // On the 8 % climb, the highest of the road it spans is as far up it as
      // the deck is over the carriageway, skew — since #2699's fourth round
      // not as far as its ends, which are over the banks, so a deck that
      // reaches further does not stand higher.
      const reach = (ROAD_HALF + 1) / Math.tan((Math.min(angle, 180 - angle) * Math.PI) / 180) + 10;
      expect(lowest - roadHeight(CLIMB, 1_000)).toBeLessThan(
        OVERPASS_CLEARANCE_METRES + 0.08 * reach,
      );
      expect(underside).toBeGreaterThan(lowest);
      // Over the middle of the road, over both its edges, and to the backs of both seats.
      const sine = Math.sin((angle * Math.PI) / 180);
      const backs = laterals.map(
        (lateral) => lateral + (Math.sign(lateral) * ABUTMENT_THICKNESS_METRES) / 2,
      );
      for (const lateral of [...backs, -ROAD_HALF, 0, ROAD_HALF]) {
        const x = there.x + (there.dx * lateral) / sine;
        const z = there.z + (there.dz * lateral) / sine;
        expect(inside(deck, x, underside + 0.05, z), `lateral ${String(lateral)}`).toBe(true);
      }
      for (const abutment of abutments) {
        // Since #2699's fourth round, a short seat: up into the slab, and down
        // into its bank by more than the face it shows (read off the drawn
        // bank in the fourth round's own tests).
        const top = abutment.y + abutment.height / 2;
        expect(top).toBeGreaterThan(underside);
        expect(top).toBeLessThan(deck.y + deck.height / 2);
        expect(abutment.height).toBeGreaterThan(ABUTMENT_FACE_METRES);
        // Its top's middle is inside the deck.
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
        // Past the deck's ends, so no two faces share a plane and fight over it.
        expect(edge.length).toBeGreaterThanOrEqual(deck.length + 0.03);
      }

      // A support each side of the road, from inside its bank up to the deck —
      // since #2699's fourth round a seat in a spill-through bank, read off the
      // drawn bank: in it along the whole of its foot, no gap under either end
      // — or where the ground has risen to its crest, in the ground.
      const origin = corridorOrigin(CLIMB);
      const banks = banksNear(found, 1_000);
      const supports = concrete.filter((box) => parallel(box) <= 0.999);
      const sides = new Set<number>();
      for (const support of supports) {
        const near = nearestOnDrawnRoad(CLIMB, origin, support.centre[0], support.centre[2], 80);
        expect(near).toBeDefined();
        if (near === undefined) continue;
        sides.add(Math.sign(near.lateral));
        expect(Math.abs(near.lateral)).toBeGreaterThan(ROAD_HALF + OVERPASS_CLEAR_VERGE_METRES);
        for (const end of [-0.5, 0, 0.5]) {
          const x = support.centre[0] + support.along[0] * support.length * end;
          const z = support.centre[2] + support.along[2] * support.length * end;
          const under = Math.max(bankAt(banks, x, z) ?? Number.NEGATIVE_INFINITY, groundAt(x, z));
          expect(support.bottom, `end ${String(end)}`).toBeLessThan(under);
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
    // Lit, as the realistic world lights a primitive: not an unlit material.
    expect((material as { readonly isMeshStandardMaterial?: boolean }).isMeshStandardMaterial).toBe(
      true,
    );
    belt.dispose();
  });

  it('gives the overpass mesh materials of its own, so neither draw changes program for the other', () => {
    const belt = new BridgeBelt();
    for (const world of ['stylised', 'realistic'] as const) {
      belt.setWorld(world);
      expect(belt.overpassMesh.material).not.toBe(belt.mesh.material);
    }
    belt.dispose();
  });

  it('puts the overpass mesh back on the lit then flat material after a realistic rung', () => {
    const belt = new BridgeBelt();
    belt.setWorld('realistic');
    const physical = belt.overpassMesh.material;
    belt.setWorld('stylised');
    expect(belt.overpassMesh.material).not.toBe(physical);
    const lit = belt.overpassMesh.material;
    belt.setShading('flat');
    expect(belt.overpassMesh.material).not.toBe(lit);
    belt.dispose();
  });

  it('uploads the overpass colours again each time the boxes change', () => {
    const found = crossingsOf([crossing(1_000, 'bridge', { angle: 90 })]);
    const belt = new BridgeBelt();
    const before = belt.overpassMesh.instanceColor?.version ?? 0;
    belt.update(boxesNear(found, 1_000));
    const once = belt.overpassMesh.instanceColor?.version ?? 0;
    expect(once).toBeGreaterThan(before);
    belt.update(boxesNear(found, 1_000));
    expect(belt.overpassMesh.instanceColor?.version ?? 0).toBeGreaterThan(once);
    belt.dispose();
  });
});

// --- The road an overpass carries — #2699, the owner's "there are no roads connected to it" ---

/**
 * A material to hand the side-road belt, without importing `three` here
 * (`three-seam.test.ts`), as `cross-streets-renderer.test.ts` takes one.
 */
function aMaterial(): ConstructorParameters<typeof SideRoadBelt>[0] {
  return new PavementBelt('stylised').mesh.material as ConstructorParameters<
    typeof SideRoadBelt
  >[0];
}

/** The bend in {@link carriedStreet}'s mapped street, {@link BEND_METRES} out on each side. */
const BEND_RADIANS = (25 * Math.PI) / 180;

/**
 * How far out from the crossing {@link carriedStreet}'s street bends: **60 m**,
 * past where the approach has moved onto the mapped street from the deck's
 * line, at 35° as at 90° (the deck reaching 15 m past the carriageway's edge).
 */
const BEND_METRES = 60;

/**
 * Where {@link carriedStreet}'s street bends: {@link BEND_METRES}, or since
 * #2699's fourth round, where the deck reaches further than that (a skew deck
 * over falling ground), 20 m past its further end.
 */
function bendFor(along: number, angle: number): number {
  const found = crossingsOf([crossing(along, 'bridge', { angle })]);
  const deck = boxesNear(found, along)[0] as BridgePart;
  const there = found[0] as GradeCrossing;
  const middle = (deck.x - there.x) * there.dx + (deck.z - there.z) * there.dz;
  return Math.max(BEND_METRES, deck.length / 2 + Math.abs(middle) + 20);
}

/**
 * A street carried over the road at `along`, `angle` degrees from its
 * heading, as a map has it: a bridge way 25 m each side of the road, and a
 * ground way on from each end of it, bending 25° {@link BEND_METRES} out — the one on the
 * road's right drawn outwards, the one on its left drawn inwards.
 */
function carriedStreet(along: number, angle: number) {
  const here = roadAt(CLIMB, along);
  const bend = bendFor(along, angle);
  const radians = (angle * Math.PI) / 180;
  const dx = here.forwardX * Math.cos(radians) + here.normalX * Math.sin(radians);
  const dz = here.forwardZ * Math.cos(radians) + here.normalZ * Math.sin(radians);
  const rx = dx * Math.cos(BEND_RADIANS) - dz * Math.sin(BEND_RADIANS);
  const rz = dx * Math.sin(BEND_RADIANS) + dz * Math.cos(BEND_RADIANS);
  // Outwards on the left, the same turn: −(dx, dz) turned by 25°.
  const lx = -rx;
  const lz = -rz;
  /** Along the deck's line, `u` metres from the crossing: signed, positive on the road's right. */
  const straight = (u: number): [number, number] => [here.x + dx * u, here.z + dz * u];
  /** Along the mapped street, `u` metres from the crossing on `side`. */
  const mapped = (side: -1 | 1, u: number): [number, number] => {
    if (u <= bend) return straight(side * u);
    const [bx, bz] = straight(side * bend);
    return side > 0
      ? [bx + rx * (u - bend), bz + rz * (u - bend)]
      : [bx + lx * (u - bend), bz + lz * (u - bend)];
  };
  /** The mapped street's heading there, outwards. */
  const heading = (side: -1 | 1, u: number): [number, number] =>
    u <= bend ? [dx * side, dz * side] : side > 0 ? [rx, rz] : [lx, lz];
  const street = (grade: StreetGrade, points: [number, number][]): StreetFeature => ({
    kind: 'major_road',
    kindDetail: '',
    grade,
    line: Float32Array.from(points.flat()),
  });
  return {
    here,
    straight,
    mapped,
    heading,
    bend,
    streets: [
      street('bridge', [straight(-25), straight(25)]),
      street('ground', [straight(25), straight(bend), mapped(1, 250)]),
      street('ground', [mapped(-1, 250), straight(-bend), straight(-25)]),
    ],
  };
}

/** One drawn triangle, read back out of the buffers `SideRoadBelt.update` uploaded. */
interface DrawnTriangle {
  readonly corners: readonly (readonly [number, number, number])[];
  readonly colour: readonly number[];
}

function drawnTriangles(belt: SideRoadBelt): DrawnTriangle[] {
  const geometry = belt.mesh.geometry;
  const position = geometry.getAttribute('position').array as Float32Array;
  const colour = geometry.getAttribute('color').array as Float32Array;
  const index = geometry.index?.array ?? new Uint32Array(0);
  const out: DrawnTriangle[] = [];
  for (let at = 0; at + 2 < index.length; at += 3) {
    const corners = [0, 1, 2].map((k) => {
      const v = index[at + k] as number;
      return [
        position[v * 3] as number,
        position[v * 3 + 1] as number,
        position[v * 3 + 2] as number,
      ] as const;
    });
    const first = index[at] as number;
    out.push({
      corners,
      colour: [
        colour[first * 3] as number,
        colour[first * 3 + 1] as number,
        colour[first * 3 + 2] as number,
      ],
    });
  }
  return out;
}

/** Points over a triangle, a grid of tenths of the way between its corners. */
function pointsOnTriangle(triangle: DrawnTriangle): [number, number, number][] {
  const [a, b, c] = triangle.corners as [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  const out: [number, number, number][] = [];
  for (let i = 0; i <= 10; i += 1) {
    for (let j = 0; i + j <= 10; j += 1) {
      const u = i / 10;
      const v = j / 10;
      const w = 1 - u - v;
      out.push([
        a[0] * u + b[0] * v + c[0] * w,
        a[1] * u + b[1] * v + c[1] * w,
        a[2] * u + b[2] * v + c[2] * w,
      ]);
    }
  }
  return out;
}

function isTarmac(triangle: DrawnTriangle): boolean {
  return triangle.colour.every((channel, at) => Math.abs(channel - (TARMAC[at] as number)) < 1e-4);
}

/** One drawn embankment triangle, read back out of the buffers `TerrainBelt.updateEmbankments` built. */
interface BankTriangle {
  readonly corners: readonly (readonly [number, number, number])[];
  /** The normal each corner was given. */
  readonly normals: readonly (readonly [number, number, number])[];
  /** The ground's fields each corner was given: route distance and signed lateral. */
  readonly fields: readonly (readonly [number, number])[];
}

function bankTriangles(belt: TerrainBelt): BankTriangle[] {
  const geometry = belt.embankmentMesh.geometry;
  const position = geometry.getAttribute('position').array as Float32Array;
  const normal = geometry.getAttribute('normal').array as Float32Array;
  const fields = geometry.getAttribute('fields').array as Float32Array;
  const index = geometry.index?.array ?? new Uint32Array(0);
  const out: BankTriangle[] = [];
  const three = (array: Float32Array, v: number) =>
    [array[v * 3] as number, array[v * 3 + 1] as number, array[v * 3 + 2] as number] as const;
  for (let at = 0; at + 2 < index.length; at += 3) {
    const vertices = [0, 1, 2].map((k) => index[at + k] as number);
    out.push({
      corners: vertices.map((v) => three(position, v)),
      normals: vertices.map((v) => three(normal, v)),
      fields: vertices.map((v) => [fields[v * 2] as number, fields[v * 2 + 1] as number] as const),
    });
  }
  return out;
}

/** A triangle's own normal, from its winding: the side three draws as its front. */
function facing(corners: readonly (readonly [number, number, number])[]): [number, number, number] {
  const [a, b, c] = corners as [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const length = Math.hypot(...n);
  return length > 0 ? [n[0] / length, n[1] / length, n[2] / length] : [0, 0, 0];
}

function areaOf(corners: readonly (readonly [number, number, number])[]): number {
  const [a, b, c] = corners as [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** The highest embankment over `(x, z)`, or `undefined` for none. */
function bankAt(triangles: readonly BankTriangle[], x: number, z: number): number | undefined {
  return surfaceAt(
    triangles.map((triangle) => ({ corners: triangle.corners, colour: TARMAC })),
    x,
    z,
  );
}

/** The highest embankment face over `(x, z)`: its height there and its drawn normal's rise, or `undefined` for none. */
function bankFaceAt(
  triangles: readonly BankTriangle[],
  x: number,
  z: number,
): { readonly height: number; readonly normalY: number } | undefined {
  let found: { height: number; normalY: number } | undefined;
  for (const triangle of triangles) {
    const height = bankAt([triangle], x, z);
    if (height !== undefined && (found === undefined || height > found.height)) {
      found = { height, normalY: triangle.normals[0]?.[1] ?? Number.NaN };
    }
  }
  return found;
}

/** The drawn road's height over `(x, z)`: the highest tarmac triangle there, or `undefined` for none. */
function surfaceAt(triangles: readonly DrawnTriangle[], x: number, z: number): number | undefined {
  let highest: number | undefined;
  for (const triangle of triangles) {
    if (!isTarmac(triangle)) continue;
    const [a, b, c] = triangle.corners as [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ];
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (highest === undefined || y > highest) highest = y;
  }
  return highest;
}

function groundAt(x: number, z: number): number {
  const origin = corridorOrigin(CLIMB);
  const near = nearestOnDrawnRoad(CLIMB, origin, x, z, 1_000);
  if (near === undefined) throw new Error('no road near');
  return terrainHeightAt(
    CLIMB,
    origin,
    scatterSeed(CLIMB),
    near.along,
    near.lateral,
    NO_LAND_CLASS,
  );
}

/** The road a crossing at `along` is drawn with, and its deck: through `gradeCrossingsAt` and the belt. */
function carriedRoad(
  streets: readonly StreetFeature[],
  along: number,
  covered: (x: number, z: number) => boolean = () => true,
) {
  const corridor = corridorOf(streets, CLIMB, covered);
  const found = mappedGradeCrossings(corridor, CLIMB, corridorOrigin(CLIMB));
  expect(found).toHaveLength(1);
  const inView = gradeCrossingsAt(
    CLIMB,
    corridorOrigin(CLIMB),
    scatterSeed(CLIMB),
    along - 100,
    along + 100,
    along,
    found,
    NO_LAND_CLASS,
  );
  expect(inView.roads).toHaveLength(1);
  expect(inView.embankments).toHaveLength(1);
  const belt = new SideRoadBelt(aMaterial());
  belt.update(inView.roads);
  const ground = new TerrainBelt();
  ground.updateEmbankments(inView.embankments);
  const deck = inView.parts[0] as BridgePart;
  return {
    corridor,
    road: inView.roads[0] as SideRoad,
    embankment: inView.embankments[0] as Embankment,
    belt,
    ground,
    triangles: drawnTriangles(belt),
    banks: bankTriangles(ground),
    deck,
    abutments: inView.parts.slice(3),
    deckTop: deck.y + deck.height / 2,
    /** How far the deck reaches from the crossing along the street on `side`: since #2699's fourth round, each end its own. */
    spanOf: (side: -1 | 1): number => {
      const there = found[0] as GradeCrossing;
      const middle = (deck.x - there.x) * there.dx + (deck.z - there.z) * there.dz;
      return deck.length / 2 + side * middle;
    },
  };
}

/**
 * How far past the deck's end an approach along `street` on `side` runs, as
 * its stations step: to {@link APPROACH_METRES}, or to where the street leaves
 * {@link APPROACH_REACH_METRES} of the route.
 */
function approachLengthOf(
  street: ReturnType<typeof carriedStreet>,
  side: -1 | 1,
  halfSpan: number,
  line: 'mapped' | 'straight' = 'mapped',
): number {
  const origin = corridorOrigin(CLIMB);
  let past = 0;
  while (past + 4 <= APPROACH_METRES) {
    const [x, z] =
      line === 'mapped'
        ? street.mapped(side, halfSpan + past + 4)
        : street.straight(side * (halfSpan + past + 4));
    const near = nearestOnDrawnRoad(CLIMB, origin, x, z, 1_000);
    if (near === undefined || near.distance > APPROACH_REACH_METRES) break;
    past += 4;
  }
  return past;
}

describe('an overpass carries its road off both ends of the deck — #2699', () => {
  for (const angle of [90, 35]) {
    it(`draws the road over the deck and down to the ground along the mapped street, crossing at ${String(angle)}°`, () => {
      const street = carriedStreet(1_000, angle);
      const { belt, ground, triangles, banks, deckTop, spanOf } = carriedRoad(
        street.streets,
        1_000,
      );
      expect(belt.mesh.visible).toBe(true);
      const origin = corridorOrigin(CLIMB);

      // The deck's top is road, and nothing of the road is in the
      // carriageway under the clearance.
      const over = surfaceAt(triangles, street.here.x, street.here.z);
      expect(over).toBeDefined();
      expect((over ?? 0) - deckTop).toBeGreaterThan(0);
      expect((over ?? 0) - deckTop).toBeLessThan(0.1);
      let overRoad = 0;
      for (const triangle of triangles) {
        for (const [x, y, z] of pointsOnTriangle(triangle)) {
          const near = nearestOnDrawnRoad(CLIMB, origin, x, z, ROAD_HALF + 0.5);
          if (near === undefined || near.distance > ROAD_HALF) continue;
          overRoad += 1;
          expect(y - roadHeight(CLIMB, near.along)).toBeGreaterThanOrEqual(
            OVERPASS_CLEARANCE_METRES,
          );
        }
      }
      expect(overRoad).toBeGreaterThan(0);

      // The sides whose bank was measured.
      let banked = 0;
      for (const side of [-1, 1] as const) {
        const label = `side ${String(side)}`;
        // On at the deck's height past its end: no step at the seat.
        const [nx, nz] = street.mapped(side, spanOf(side) + 0.05);
        expect(surfaceAt(triangles, nx, nz), label).toBeGreaterThan(deckTop - 0.1);
        // Along the mapped street, never under the ground before its fade and
        // never above the deck, and down to the ground somewhere on the way.
        let reached = false;
        const length = approachLengthOf(street, side, spanOf(side));
        expect(length, label).toBeGreaterThan(APPROACH_FADE_METRES);
        // On the ground by where its fade begins, or halfway along a short one: within the view.
        const fade = Math.min(APPROACH_FADE_METRES, length / 2);
        // Every 4 m, to the first row past where it must have landed: its
        // rows are 4 m apart, and since #2699's fourth round a short approach
        // can have to land between two of them.
        const pasts: number[] = [];
        for (let past = 4; past < length - fade + 4; past += 4) pasts.push(past);
        for (const past of pasts) {
          const [x, z] = street.mapped(side, spanOf(side) + past);
          const surface = surfaceAt(triangles, x, z);
          const where = `${label} at ${String(past)} m`;
          expect(surface, where).toBeDefined();
          const ground = groundAt(x, z);
          // The highest of the ground under the road's width there, edge to edge.
          const [hx, hz] = street.heading(side, spanOf(side) + past);
          const half = SIDE_ROAD_WIDTHS.major / 2;
          const highest = Math.max(
            ground,
            groundAt(x + hz * half, z - hx * half),
            groundAt(x - hz * half, z + hx * half),
          );
          // Above the ground at its edges, where its vertices read it; in its
          // middle the ground between them is not read, as a side road's is not.
          // Its edges where it is drawn: narrowing over its fade.
          const narrowing = smoothstep(
            (past - (length - APPROACH_FADE_METRES)) / APPROACH_FADE_METRES,
          );
          const edgeHalf = half * (1 - (1 - SIDE_ROAD_END_WIDTH_SHARE) * narrowing);
          // (Before where it must land: past it, its edges are on the ground.)
          for (const sign of past <= length - fade ? [-1, 1] : []) {
            const ex = x + hz * edgeHalf * 0.9 * sign;
            const ez = z - hx * edgeHalf * 0.9 * sign;
            expect(
              surfaceAt(triangles, ex, ez) ?? 0,
              `${where}, edge ${String(sign)}`,
            ).toBeGreaterThan(groundAt(ex, ez));
          }
          expect(surface ?? 0, where).toBeGreaterThan(ground - 0.15);
          expect(surface ?? 0, where).toBeLessThan(Math.max(deckTop + 0.05, highest + 0.15));
          // Since #2699's fourth round never steeper than its own bank, 1 : 2.
          expect(surface ?? 0, where).toBeGreaterThan(
            Math.min(deckTop - past / EMBANKMENT_RUN - 0.15, highest - 0.15),
          );
          if ((surface ?? 0) - highest < 0.15) reached = true;
        }
        // It lands where a 1 : 2 ramp can: a deck far over falling ground (the
        // skew case's left, here) stands too high for one to within the view.
        const [lx, lz] = street.mapped(side, spanOf(side) + length - fade);
        const landable = (deckTop - groundAt(lx, lz)) * EMBANKMENT_RUN <= length - fade;
        const debug: string[] = [];
        for (const past of [...pasts, length]) {
          const [x, z] = street.mapped(side, spanOf(side) + past);
          debug.push(
            `${String(past)}:${(surfaceAt(triangles, x, z) ?? NaN).toFixed(2)}/${groundAt(x, z).toFixed(2)}`,
          );
        }
        if (landable) {
          expect(reached, `${label} deck ${deckTop.toFixed(2)} ${debug.join(' ')}`).toBe(true);
        }
        // #2699's third round: a sloped bank each side of it while it stands
        // above the ground, not a wall — from the road's edge outwards and
        // down, at the bank's slope, to under the ground.
        // At the first row from the deck's end, before its fade, standing more
        // than a metre and a half up and no more than the tallest bank drawn
        // at 1 : 2 — since #2699's fourth round the deck reaches far enough
        // that rising ground brings the road down by 12 m out on one side,
        // and on the skew case's left, falling ground leaves it fading from
        // over 20 m up, where no row is that.
        const half = SIDE_ROAD_WIDTHS.major / 2;
        const tallest = EMBANKMENT_MAX_RUN_METRES / EMBANKMENT_RUN;
        let bankAtPast: number | undefined;
        for (let past = 4; past <= length - APPROACH_FADE_METRES; past += 4) {
          const [x, z] = street.mapped(side, spanOf(side) + past);
          const up = (surfaceAt(triangles, x, z) ?? 0) - groundAt(x, z);
          if (up > 1.5 && up < tallest - 1) {
            bankAtPast = past;
            break;
          }
        }
        if (bankAtPast === undefined) continue;
        banked += 1;
        const [wx, wz] = street.mapped(side, spanOf(side) + bankAtPast);
        const [hx, hz] = street.heading(side, spanOf(side) + bankAtPast);
        for (const sign of [-1, 1]) {
          const edgeLabel = `${label}, edge ${String(sign)}`;
          const ox = hz * sign;
          const oz = -hx * sign;
          const edge = surfaceAt(triangles, wx + ox * half * 0.99, wz + oz * half * 0.99) ?? 0;
          expect(edge - groundAt(wx + ox * half, wz + oz * half), edgeLabel).toBeGreaterThan(1);
          // Just off the road's edge the bank is there, a hair under the road.
          const [ix, iz] = [wx + ox * (half + 0.3), wz + oz * (half + 0.3)];
          const inner = bankAt(banks, ix, iz);
          expect(inner, edgeLabel).toBeDefined();
          expect(edge - (inner ?? 0), edgeLabel).toBeLessThan(0.3);
          // Two metres further out it is lower, and a 1 : 2 slope: not a wall.
          // Since #2699's fourth round it falls away from the road's edge, or —
          // near the deck's end, where the approach falls faster than its
          // bank — round the spill-through bank at the deck's corner.
          const [mx, mz] = [wx + ox * (half + 2.3), wz + oz * (half + 2.3)];
          const middle = bankFaceAt(banks, mx, mz);
          expect(middle, edgeLabel).toBeDefined();
          expect((inner ?? 0) - (middle?.height ?? 0), edgeLabel).toBeGreaterThan(0);
          expect((inner ?? 0) - (middle?.height ?? 0), edgeLabel).toBeLessThan(
            2 / EMBANKMENT_RUN + 0.1,
          );
          // About 1 : 2: a cell of the spill-through round the corner is a
          // little steeper or gentler than the cone it is drawn over (1 : 1.1
          // to 1 : 3).
          expect(middle?.normalY ?? 0, edgeLabel).toBeGreaterThan(0.75);
          expect(middle?.normalY ?? 0, edgeLabel).toBeLessThan(0.95);
          // Its foot is under the ground, where the slope comes down to it.
          const toe = (edge - groundAt(wx + ox * half, wz + oz * half)) * EMBANKMENT_RUN;
          let footed = false;
          for (let out = 0.25; out <= toe * 3 + 2; out += 0.25) {
            const [fx, fz] = [wx + ox * (half + out), wz + oz * (half + out)];
            const bank = bankAt(banks, fx, fz);
            if (bank === undefined) {
              // Or it ran towards the route and was cut off at the verge's line.
              const near = nearestOnDrawnRoad(CLIMB, origin, fx, fz, 200);
              const line = ROAD_HALF + OVERPASS_CLEAR_VERGE_METRES;
              if (Math.abs((near?.distance ?? 0) - line) < 0.3) footed = true;
              break;
            }
            if (bank < groundAt(fx, fz)) footed = true;
          }
          expect(footed, edgeLabel).toBe(true);
        }
      }
      // Square, both sides; skew, the ground on the right rises to the deck
      // (no bank) and on the left the deck is too high for a row before the
      // fade to be — so there the banks are held by the tests further down.
      if (angle === 90) expect(banked).toBe(2);
      expect(ground.embankmentMesh.visible).toBe(true);

      // The mapped street's bend is followed each side, not the deck's line past it.
      for (const side of [-1, 1] as const) {
        // Near its far end, where the bend has taken the street well off the deck's line.
        const bent = spanOf(side) + approachLengthOf(street, side, spanOf(side)) - 4;
        const [bx, bz] = street.mapped(side, bent);
        expect(surfaceAt(triangles, bx, bz), `side ${String(side)}`).toBeDefined();
        const [sx, sz] = street.straight(side * bent);
        expect(surfaceAt(triangles, sx, sz), `side ${String(side)}`).toBeUndefined();
      }
      belt.dispose();
      ground.dispose();
    });
  }

  it('carries it on along the deck’s line past the land read, and fades it into the ground at its far end', () => {
    const street = carriedStreet(1_000, 90);
    // The land read stops 40 m from the road: the ways on are not read past it.
    const { triangles, spanOf } = carriedRoad(
      street.streets,
      1_000,
      (x, z) => Math.hypot(x - street.here.x, z - street.here.z) < 40,
    );
    const full = SIDE_ROAD_WIDTHS.major / 2;
    for (const side of [-1, 1] as const) {
      const label = `side ${String(side)}`;
      const length = approachLengthOf(street, side, spanOf(side), 'straight');
      // Where the unread way has bent well off the deck's line, in the fade.
      const far = spanOf(side) + length - 4;
      // Along the deck's line, not the unread way's bend.
      const [x, z] = street.straight(side * far);
      expect(surfaceAt(triangles, x, z), label).toBeDefined();
      // The unread way's bend is out past the road's edge by then: push the
      // mapped street's point out along its offset from the deck's line, past it.
      const [mx, mz] = street.mapped(side, far);
      const offset = Math.hypot(mx - x, mz - z);
      expect(offset, label).toBeGreaterThan(1);
      const push = (full + 1.5) / offset;
      expect(surfaceAt(triangles, x + (mx - x) * push, z + (mz - z) * push), label).toBeUndefined();
      // Into the ground at its far end, not stopping square.
      const [ex, ez] = street.straight(side * (spanOf(side) + length - 1));
      const end = surfaceAt(triangles, ex, ez);
      expect(end, label).toBeDefined();
      expect(end ?? 0, label).toBeLessThan(groundAt(ex, ez));
      // And narrowing: 60 % of the way to its edge is road before the fade, and none at its end.
      const [hx, hz] = street.heading(side, 0);
      const offEdge = (u: number): number | undefined => {
        const [cx, cz] = street.straight(side * u);
        return surfaceAt(triangles, cx + hz * full * 0.6, cz - hx * full * 0.6);
      };
      expect(offEdge(spanOf(side) + length - APPROACH_FADE_METRES - 20), label).toBeDefined();
      expect(offEdge(spanOf(side) + length - 1), label).toBeUndefined();
    }
  });

  it('carries it on along the deck’s line where nothing of the street is mapped past the bridge', () => {
    const street = carriedStreet(1_000, 35);
    const { triangles, spanOf } = carriedRoad(street.streets.slice(0, 1), 1_000);
    for (const side of [-1, 1] as const) {
      const halfway = approachLengthOf(street, side, spanOf(side), 'straight') / 2;
      expect(halfway, `side ${String(side)}`).toBeGreaterThan(APPROACH_FADE_METRES / 2);
      const [x, z] = street.straight(side * (spanOf(side) + halfway));
      expect(surfaceAt(triangles, x, z), `side ${String(side)}`).toBeDefined();
    }
  });

  it('stops it short of the route where the mapped street turns back onto it', () => {
    const street = carriedStreet(1_000, 90);
    const { here } = street;
    // On the road's right, out 60 m, then back across the route 100 m further up it.
    const back: StreetFeature = {
      kind: 'major_road',
      kindDetail: '',
      grade: 'ground',
      line: Float32Array.from([
        ...street.straight(25),
        ...street.straight(60),
        here.x + here.forwardX * 60 + here.normalX * 30,
        here.z + here.forwardZ * 60 + here.normalZ * 30,
        here.x + here.forwardX * 120 - here.normalX * 30,
        here.z + here.forwardZ * 120 - here.normalZ * 30,
      ]),
    };
    const streets = [street.streets[0] as StreetFeature, back, street.streets[2] as StreetFeature];
    const { triangles } = carriedRoad(streets, 1_000);
    const origin = corridorOrigin(CLIMB);
    let checked = 0;
    for (const triangle of triangles) {
      for (const [x, y, z] of pointsOnTriangle(triangle)) {
        const near = nearestOnDrawnRoad(CLIMB, origin, x, z, ROAD_HALF + 1);
        if (near === undefined || near.distance > ROAD_HALF + 0.6) continue;
        checked += 1;
        // Only the deck is over the road, at its clearance.
        expect(y - roadHeight(CLIMB, near.along), `at ${near.along.toFixed(0)} m`).toBeGreaterThan(
          OVERPASS_CLEARANCE_METRES,
        );
      }
    }
    expect(checked).toBeGreaterThan(0);
    // And it did follow the street out before it turned.
    const [ox, oz] = street.straight(50);
    expect(surfaceAt(triangles, ox, oz)).toBeDefined();
  });

  it('draws its embankment in the ground’s own material, whichever the ground wears', () => {
    const belt = new TerrainBelt();
    const bridges = new BridgeBelt();
    expect(belt.embankmentMesh.material).toBe(belt.mesh.material);
    belt.setShading('flat');
    expect(belt.embankmentMesh.material).toBe(belt.mesh.material);
    // A realistic rung's photographed ground: a lit standard material, which this file may
    // not build itself (`three-seam.test.ts`), so the bridges' own stands in for it.
    bridges.setWorld('realistic');
    const photographed = bridges.overpassMesh.material as Parameters<
      TerrainBelt['setPhotographic']
    >[0];
    belt.setPhotographic(photographed);
    expect(belt.mesh.material).toBe(photographed);
    expect(belt.embankmentMesh.material).toBe(photographed);
    belt.setPhotographic(undefined);
    expect(belt.embankmentMesh.material).toBe(belt.mesh.material);
    expect(belt.embankmentMesh.material).not.toBe(photographed);
    belt.dispose();
    bridges.dispose();
  });

  it('reaches the frame’s side roads, which keep the scenery off it, only with map data', () => {
    // At 1 400 m, where the scenery stands close enough to the road to be on it.
    const street = carriedStreet(1_400, 90);
    const { corridor, road, embankment, banks, triangles } = carriedRoad(street.streets, 1_400);
    const start = atStartLine(CLIMB);
    const input = {
      profile: CLIMB,
      origin: corridorOrigin(CLIMB),
      state: { ...start, ride: { ...start.ride, distance: metres(1_380) } },
    };
    const mapped = sceneFrame({ ...input, worldCorridor: corridor });
    // The same object the belt drew: the side roads' mesh draws it, and the
    // ground's draws its embankment.
    expect(mapped.sideRoads).toContain(road);
    expect(mapped.terrain.embankments).toContain(embankment);
    const belt = new SideRoadBelt(aMaterial());
    belt.update(mapped.sideRoads);
    const [cx, cz] = street.straight(0);
    expect(surfaceAt(drawnTriangles(belt), cx, cz)).toBeGreaterThan(
      roadHeight(CLIMB, 1_400) + OVERPASS_CLEARANCE_METRES,
    );
    belt.dispose();
    // Nothing scattered stands on it — and without it, something would: read
    // off the drawn road, since #2699's fourth round widened its clearances
    // over the spill-through banks.
    const onIt = (items: readonly { x: number; z: number }[]): number =>
      items.filter((item) => surfaceAt(triangles, item.x, item.z) !== undefined).length;
    expect(onIt(mapped.scatter)).toBe(0);
    const without = sceneFrame(input);
    expect(without.sideRoads).not.toContain(road);
    expect(without.terrain.embankments).toEqual([]);
    expect(onIt(without.scatter)).toBeGreaterThan(0);
    // Nor on its embankment, out to the bank's foot: read off the drawn banks.
    const onBank = (items: readonly { x: number; z: number }[]): number =>
      items.filter((item) => bankAt(banks, item.x, item.z) !== undefined).length;
    expect(onBank(mapped.scatter)).toBe(0);
    expect(onBank(without.scatter)).toBeGreaterThan(0);
  });

  it('keeps a frame’s overpass roads to their triangle budget, one road an overpass', () => {
    const streets: StreetFeature[] = [];
    for (let along = 600; along < 1_400; along += 20) streets.push(crossing(along, 'bridge'));
    const inView = gradeCrossingsAt(
      CLIMB,
      corridorOrigin(CLIMB),
      scatterSeed(CLIMB),
      600,
      1_400,
      1_000,
      crossingsOf(streets),
      NO_LAND_CLASS,
    );
    expect(inView.roads).toHaveLength(inView.parts.length / 5);
    const belt = new SideRoadBelt(aMaterial());
    belt.update(inView.roads);
    const triangles = (belt.mesh.geometry.index?.count ?? 0) / 3;
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(OVERPASS_ROAD_FRAME_TRIANGLES);
    for (const road of inView.roads) {
      expect(road.mesh.indices.length / 3).toBeLessThanOrEqual(APPROACH_TRIANGLES_PER_OVERPASS);
    }
    belt.dispose();
    // And their embankments, one an overpass, in the ground's second mesh.
    expect(inView.embankments).toHaveLength(inView.roads.length);
    const ground = new TerrainBelt();
    ground.updateEmbankments(inView.embankments);
    const banks = (ground.embankmentMesh.geometry.index?.count ?? 0) / 3;
    expect(banks).toBeGreaterThan(0);
    expect(banks).toBeLessThanOrEqual(EMBANKMENT_FRAME_TRIANGLES);
    for (const embankment of inView.embankments) {
      expect(embankment.indices.length / 3).toBeLessThanOrEqual(EMBANKMENT_TRIANGLES_PER_OVERPASS);
    }
    ground.dispose();
    // An underpass carries none.
    const under = gradeCrossingsAt(
      CLIMB,
      corridorOrigin(CLIMB),
      scatterSeed(CLIMB),
      1_900,
      2_100,
      2_000,
      crossingsOf([crossing(2_000, 'tunnel', { half: 30 })]),
      NO_LAND_CLASS,
    );
    expect(under.parts.length).toBeGreaterThan(0);
    expect(under.roads).toEqual([]);
    expect(under.embankments).toEqual([]);
  });
});

describe('an overpass approach stops where it must — #2699', () => {
  it('ends within the ground the reduced rungs draw, not out over nothing', () => {
    const street = carriedStreet(1_000, 90);
    const { triangles } = carriedRoad(street.streets, 1_000);
    const origin = corridorOrigin(CLIMB);
    let furthest = 0;
    for (const triangle of triangles) {
      for (const [x, , z] of pointsOnTriangle(triangle)) {
        const near = nearestOnDrawnRoad(CLIMB, origin, x, z, 1_000);
        if (near !== undefined) furthest = Math.max(furthest, near.distance);
      }
    }
    expect(furthest).toBeGreaterThan(APPROACH_REACH_METRES / 2);
    // A road's own width past the last station's centre.
    expect(furthest).toBeLessThanOrEqual(APPROACH_REACH_METRES + SIDE_ROAD_WIDTHS.major);
  });

  it('stops short of water, as a side road does', () => {
    const valley = valleyRoute();
    expect(waterways(valley, scatterSeed(valley)).crossings.length).toBeGreaterThan(0);
    const roadsAt = (along: number) => {
      const found = crossingsOf([crossing(along, 'bridge', { profile: valley })], valley);
      return gradeCrossingsAt(
        valley,
        corridorOrigin(valley),
        scatterSeed(valley),
        along - 100,
        along + 100,
        along,
        found,
        NO_LAND_CLASS,
      ).roads;
    };
    const trianglesOf = (roads: readonly SideRoad[]): number =>
      roads.reduce((sum, road) => sum + road.mesh.indices.length / 3, 0);
    // The stream crosses at the valley's floor, 1 000 m: an overpass over its channel
    // has water at once beside it; one well clear of it has a whole approach.
    const clear = trianglesOf(roadsAt(1_500));
    expect(clear).toBeGreaterThan(40);
    expect(trianglesOf(roadsAt(1_005))).toBeLessThan(clear / 4);
  });

  it('follows the ends the map joins, to a bounded number of ways at one point', () => {
    const street = carriedStreet(1_000, 90);
    const [bx, bz] = street.straight(25);
    const [cx, cz] = street.straight(-25);
    const decoy = (x: number, z: number): StreetFeature => ({
      kind: 'major_road',
      kindDetail: '',
      grade: 'ground',
      // Short, and at right angles to the street: never the way on.
      line: Float32Array.from([x, z, x + street.here.normalX * 5, z + street.here.normalZ * 5]),
    });
    const crowd: StreetFeature[] = [];
    for (let i = 0; i < 12; i += 1) crowd.push(decoy(bx, bz), decoy(cx, cz));
    const bent = (streets: readonly StreetFeature[]): boolean[] => {
      const { triangles, spanOf } = carriedRoad(streets, 1_000);
      return ([-1, 1] as const).map((side) => {
        const u = spanOf(side) + approachLengthOf(street, side, spanOf(side)) - 4;
        const [x, z] = street.mapped(side, u);
        return surfaceAt(triangles, x, z) !== undefined;
      });
    };
    expect(bent(street.streets)).toEqual([true, true]);
    // Twelve ways at the join push the way on past the cap: the approach runs straight on instead.
    expect(bent([...crowd, ...street.streets])).toEqual([false, false]);
  });
});

describe('what a frame holds of overpass roads and boxes — #2699', () => {
  it('keeps a frame’s roads in the order of the road, not of the rider’s distance', () => {
    const streets = [crossing(800, 'bridge'), crossing(1_200, 'bridge')];
    const found = crossingsOf(streets);
    const roadsFor = (rider: number) =>
      gradeCrossingsAt(
        CLIMB,
        corridorOrigin(CLIMB),
        scatterSeed(CLIMB),
        600,
        1_400,
        rider,
        found,
        NO_LAND_CLASS,
      );
    const before = roadsFor(990);
    const after = roadsFor(1_010);
    expect(before.roads).toHaveLength(2);
    // The boxes stay nearest first: 800 m's before, 1 200 m's after.
    expect(before.parts[0]?.z).not.toBe(after.parts[0]?.z);
    expect(after.roads[0]).toBe(before.roads[0]);
    expect(after.roads[1]).toBe(before.roads[1]);
  });

  it('draws whole crossings only, in the room it is given', () => {
    const streets: StreetFeature[] = [];
    for (let along = 600; along < 1_400; along += 20) streets.push(crossing(along, 'bridge'));
    const inView = gradeCrossingsAt(
      CLIMB,
      corridorOrigin(CLIMB),
      scatterSeed(CLIMB),
      600,
      1_400,
      1_000,
      crossingsOf(streets),
      NO_LAND_CLASS,
      12,
    );
    expect(inView.parts).toHaveLength(10);
    expect(inView.roads).toHaveLength(2);
  });
});

// --- #2699's third round: slopes, not walls; a visible ramp; nothing over the verge ---

/**
 * A street carried over the road at 1 000 m, square to it, whose map turns
 * it on the road's right to run beside the route — a frontage road or a slip
 * road — 40 m out, for 175 m. On the left it carries straight on.
 */
function frontageStreet() {
  const here = roadAt(CLIMB, 1_000);
  /** `along` metres up the route from the crossing and `lateral` to its right. */
  const at = (along: number, lateral: number): [number, number] => [
    here.x + here.forwardX * along + here.normalX * lateral,
    here.z + here.forwardZ * along + here.normalZ * lateral,
  ];
  const street = (grade: StreetGrade, points: [number, number][]): StreetFeature => ({
    kind: 'major_road',
    kindDetail: '',
    grade,
    line: Float32Array.from(points.flat()),
  });
  return {
    here,
    at,
    streets: [
      street('bridge', [at(0, -30), at(0, 30)]),
      street('ground', [at(0, 30), at(8, 37), at(25, 40), at(200, 40)]),
      street('ground', [at(0, -30), at(0, -230)]),
    ],
  };
}

/** Whether `(x, z)` is under the deck, in plan: the bridge itself, which the verge rule leaves out. */
function underDeck(deck: BridgePart, x: number, z: number): boolean {
  return inside(deck, x, deck.y, z);
}

/** Every point of the road and the embankment more than the verge allows above the ground, with where it is. */
function overTheVerge(
  triangles: readonly DrawnTriangle[],
  banks: readonly BankTriangle[],
  deck: BridgePart,
): string[] {
  const origin = corridorOrigin(CLIMB);
  const found: string[] = [];
  const corners = [
    ...triangles.map((triangle) => ({ corners: triangle.corners, colour: TARMAC, kind: 'road' })),
    ...banks.map((triangle) => ({ corners: triangle.corners, colour: TARMAC, kind: 'bank' })),
  ];
  for (const triangle of corners) {
    for (const [x, y, z] of pointsOnTriangle(triangle)) {
      if (underDeck(deck, x, z)) continue;
      const near = nearestOnDrawnRoad(CLIMB, origin, x, z, ROAD_HALF + OVERPASS_CLEAR_VERGE_METRES);
      if (near === undefined) continue;
      // A centimetre's grace on the line itself, where a bank is cut off.
      if (near.distance - ROAD_HALF > OVERPASS_CLEAR_VERGE_METRES - 0.01) continue;
      const height = y - groundAt(x, z);
      if (height > OVERPASS_VERGE_HEIGHT_METRES) {
        found.push(
          `${triangle.kind} ${height.toFixed(2)} m up, ${(near.distance - ROAD_HALF).toFixed(2)} m off, ${(near.along - 1_000).toFixed(1)} m along`,
        );
      }
    }
  }
  return found;
}

describe('an overpass’s approach slopes down to the ground, and nothing walls the verge — #2699', () => {
  for (const angle of [90, 35]) {
    it(`keeps all but the bridge under a metre within 15 m of the carriageway, crossing at ${String(angle)}°`, () => {
      const street = carriedStreet(1_000, angle);
      const { triangles, banks, deck, abutments, belt, ground } = carriedRoad(
        street.streets,
        1_000,
      );
      expect(banks.length).toBeGreaterThan(0);
      expect(overTheVerge(triangles, banks, deck)).toEqual([]);
      // The seats stand past the line — since #2699's fourth round far enough
      // that the bank in front of each is down to a metre by it.
      const origin = corridorOrigin(CLIMB);
      for (const abutment of abutments) {
        const near = nearestOnDrawnRoad(CLIMB, origin, abutment.x, abutment.z, 80);
        expect(
          Math.abs(near?.lateral ?? 0) - abutment.width / 2 - ROAD_HALF,
        ).toBeGreaterThanOrEqual(OVERPASS_CLEAR_VERGE_METRES);
      }
      belt.dispose();
      ground.dispose();
    });

    it(`lights each bank face as the slope it is, and sinks its foot into the ground, crossing at ${String(angle)}°`, () => {
      const street = carriedStreet(1_000, angle);
      const { road, banks, belt, ground } = carriedRoad(street.streets, 1_000);
      const origin = corridorOrigin(CLIMB);
      const bankOver = binned(banks);
      const roadEdges = road.mesh.positions;
      const isRoadEdge = ([x, y, z]: readonly [number, number, number]): boolean => {
        for (let v = 0; v < roadEdges.length / 3; v += 1) {
          if (
            Math.abs((roadEdges[v * 3] as number) - x) < 1e-3 &&
            Math.abs((roadEdges[v * 3 + 1] as number) - y) < 1e-3 &&
            Math.abs((roadEdges[v * 3 + 2] as number) - z) < 1e-3
          ) {
            return true;
          }
        }
        return false;
      };
      let tall = 0;
      for (const triangle of banks) {
        const face = facing(triangle.corners);
        // Faces up, the way three draws it, and every corner carries that normal.
        expect(face[1]).toBeGreaterThan(0);
        for (const normal of triangle.normals) {
          expect(normal[0] * face[0] + normal[1] * face[1] + normal[2] * face[2]).toBeGreaterThan(
            0.999,
          );
        }
        if (areaOf(triangle.corners) < 0.2) continue;
        const heights = triangle.corners.map(([, y]) => y);
        // Seen: not under another of the banks, as a spill-through bank's
        // cell past the deck's end is under the approach's own banks.
        const [cx, cy, cz] = [0, 1, 2].map(
          (k) => triangle.corners.reduce((sum, corner) => sum + (corner[k] as number), 0) / 3,
        ) as [number, number, number];
        const seen = (bankOver(cx, cz) ?? cy) <= cy + 0.02;
        if (seen && Math.max(...heights) - Math.min(...heights) > 1) {
          // A wall's face is all but vertical; a bank's, where two of its
          // steps fan out round a bend, is at worst a sliver some way off it.
          expect(face[1]).toBeGreaterThan(0.2);
          // A face down from the road's edge: not lit as level ground — its
          // normal leans out, as its face does. (A spill-through bank's cell,
          // since #2699's fourth round, can be tall and gentle, round a corner.)
          if (triangle.corners.some(isRoadEdge)) {
            tall += 1;
            expect(triangle.normals[0]?.[1] ?? 1).toBeLessThan(0.95);
          }
        }
        // Its fields are the ground's: where it is, along the route and across it.
        for (const [index, [x, , z]] of triangle.corners.entries()) {
          const near = nearestOnDrawnRoad(CLIMB, origin, x, z, 200);
          const [along, lateral] = triangle.fields[index] as readonly [number, number];
          expect(Math.abs(along - (near?.along ?? 0))).toBeLessThan(1.5);
          expect(Math.abs(lateral - (near?.lateral ?? 0))).toBeLessThan(1.5);
        }
      }
      expect(tall).toBeGreaterThan(0);
      belt.dispose();
      ground.dispose();
    });
  }

  it('does not follow a street that turns to run beside the route, and brings the road down away from it', () => {
    const street = frontageStreet();
    const { triangles, banks, deck, abutments, belt, ground } = carriedRoad(street.streets, 1_000);
    // Not along the frontage road, 40 m out beside the route.
    for (const along of [50, 80, 110]) {
      const [x, z] = street.at(along, 40);
      expect(surfaceAt(triangles, x, z), `${String(along)} m up`).toBeUndefined();
      expect(bankAt(banks, x, z), `${String(along)} m up`).toBeUndefined();
    }
    // Nothing raised more than a metre runs along the route past the deck's
    // ends further than a 1 : 2 bank from them comes down — since #2699's
    // fourth round, the spill-through banks round the seats' ends: no wall
    // beside the rider.
    const origin = corridorOrigin(CLIMB);
    const seatHalf = Math.max(...abutments.map((abutment) => abutment.length / 2));
    const deckTop = deck.y + deck.height / 2;
    // The highest point of the road and the banks in each metre square off the
    // deck: they tile it many times over, and each ground reading scans the
    // route, which under coverage timed this case out (#2471's nightly).
    const squares = new Map<string, [number, number, number]>();
    for (const triangle of [...triangles, ...banks]) {
      for (const [x, y, z] of pointsOnTriangle({ corners: triangle.corners, colour: TARMAC })) {
        if (underDeck(deck, x, z)) continue;
        const key = `${String(Math.round(x))},${String(Math.round(z))}`;
        const held = squares.get(key);
        if (held === undefined || y > held[1]) squares.set(key, [x, y, z]);
      }
    }
    const raised = [...squares.values()].filter(
      ([x, y, z]) => y - groundAt(x, z) > OVERPASS_VERGE_HEIGHT_METRES,
    );
    expect(raised.length).toBeGreaterThan(0);
    for (const [x, , z] of raised) {
      const near = nearestOnDrawnRoad(CLIMB, origin, x, z, 200);
      expect(Math.abs((near?.along ?? 0) - 1_000)).toBeLessThan(
        seatHalf + EMBANKMENT_RUN * (deckTop - groundAt(x, z)) + 1,
      );
    }
    expect(overTheVerge(triangles, banks, deck)).toEqual([]);
    // And the road is down on the ground on the right too, carried on straight.
    let landed = false;
    for (let lateral = 30; lateral < APPROACH_REACH_METRES; lateral += 2) {
      for (let along = 0; along < 40; along += 1) {
        const [x, z] = street.at(along, lateral);
        const surface = surfaceAt(triangles, x, z);
        if (surface !== undefined && surface - groundAt(x, z) < 0.15) landed = true;
      }
    }
    expect(landed).toBe(true);
    belt.dispose();
    ground.dispose();
  });

  it('builds the embankments’ mesh again only when the set in view changes', () => {
    const street = carriedStreet(1_000, 90);
    const { embankment, ground } = carriedRoad(street.streets, 1_000);
    const built = ground.embankmentMesh.geometry;
    ground.updateEmbankments([embankment]);
    expect(ground.embankmentMesh.geometry).toBe(built);
    ground.updateEmbankments([]);
    expect(ground.embankmentMesh.geometry).not.toBe(built);
    expect(ground.embankmentMesh.visible).toBe(false);
    ground.dispose();
  });
});

// --- #2699's fourth round: short seats in spill-through banks, not blocks ---

/** Triangles binned by where they are in plan, so a surface over a point is found among a few. */
function binned(
  triangles: readonly { readonly corners: readonly (readonly [number, number, number])[] }[],
): (x: number, z: number) => number | undefined {
  const size = 4;
  const bins = new Map<string, DrawnTriangle[]>();
  for (const triangle of triangles) {
    const xs = triangle.corners.map((corner) => corner[0]);
    const zs = triangle.corners.map((corner) => corner[2]);
    for (
      let i = Math.floor(Math.min(...xs) / size);
      i <= Math.floor(Math.max(...xs) / size);
      i += 1
    ) {
      for (
        let j = Math.floor(Math.min(...zs) / size);
        j <= Math.floor(Math.max(...zs) / size);
        j += 1
      ) {
        const key = `${String(i)},${String(j)}`;
        const bin = bins.get(key) ?? [];
        bin.push({ corners: triangle.corners, colour: TARMAC });
        bins.set(key, bin);
      }
    }
  }
  return (x, z) =>
    surfaceAt(
      bins.get(`${String(Math.floor(x / size))},${String(Math.floor(z / size))}`) ?? [],
      x,
      z,
    );
}

/** Whether `(x, z)` is under the deck or its edge beams, in plan: the bridge itself. */
function underBridge(deck: BridgePart, x: number, z: number): boolean {
  const { along, across } = frameOf(deck);
  return (
    Math.abs((x - deck.x) * along[0] + (z - deck.z) * along[2]) <= deck.length / 2 + 0.02 &&
    Math.abs((x - deck.x) * across[0] + (z - deck.z) * across[2]) <=
      deck.width / 2 + OVERPASS_EDGE_PROUD_METRES + 0.01
  );
}

/** `lateral` metres to the road's right of where it is `along`. */
function offRoad(along: number, lateral: number): [number, number] {
  const frame = roadAt(CLIMB, along);
  return [frame.x + frame.normalX * lateral, frame.z + frame.normalZ * lateral];
}

/**
 * Where the fourth round's tests cross: at 1 000 m the ground falls away on
 * the road's left and rises on its right, so a skew deck's left end stands
 * some 25 m over it; at 2 600 m it is all but level across the road, as at
 * Lake Shore Drive — but both on the 8 % climb, so a skew deck's uphill end
 * is where the ground has all but risen to it. `ends`: how many of the deck's
 * ends have a bank in front of their seat.
 */
const SEATED: readonly (readonly [angle: number, at: number, ends: number])[] = [
  [90, 1_000, 2],
  [35, 1_000, 1],
  [35, 2_600, 1],
];

/**
 * Where the no-wall sweep runs, and the most a step between two samples half
 * a metre apart may be there. Not the skew deck over the 1 000 m side-hill,
 * whose end stands taller than a bank's longest run. On the skew deck at
 * 2 600 m, where the approach's banks meet the banks round the deck's acute
 * corner, the field's cells leave creases of up to a metre between the two —
 * not walls; a seat standing bare or a bank's open end is several.
 */
const SWEPT: readonly (readonly [angle: number, at: number, step: number])[] = [
  [90, 1_000, 0.5],
  [90, 2_600, 0.5],
  [35, 2_600, 1.5],
];

describe('an overpass stands on short seats in grassy spill-through banks — #2699', () => {
  for (const [angle, at, ends] of SEATED) {
    it(`seats each end of the deck in a bank that comes up to it, with no wing and no block, crossing at ${String(angle)}° at ${String(at)} m`, () => {
      const street = carriedStreet(at, angle);
      const { banks, deck, abutments, belt, ground } = carriedRoad(street.streets, at);
      const origin = corridorOrigin(CLIMB);
      const underside = deck.y - deck.height / 2;
      const bankOver = binned(banks);
      const surface = (x: number, z: number): number =>
        Math.max(bankOver(x, z) ?? Number.NEGATIVE_INFINITY, groundAt(x, z));
      const { across } = frameOf(deck);
      expect(abutments).toHaveLength(2);
      let faced = 0;
      for (const seat of abutments) {
        const near = nearestOnDrawnRoad(CLIMB, origin, seat.x, seat.z, 80);
        expect(near).toBeDefined();
        if (near === undefined) continue;
        const side = Math.sign(near.lateral);
        const bottom = seat.y - seat.height / 2;
        // No wing: along all of it, it is under the deck's edge beams, and its
        // ends no more than the 10 cm past them that keeps their faces apart.
        for (let t = -0.5; t <= 0.5; t += 0.125) {
          const x = seat.x + seat.axisX * seat.length * t;
          const z = seat.z + seat.axisZ * seat.length * t;
          const offset = Math.abs((x - deck.x) * across[0] + (z - deck.z) * across[2]);
          expect(offset, `seat ${String(side)} at ${String(t)}`).toBeLessThanOrEqual(
            deck.width / 2 + OVERPASS_EDGE_PROUD_METRES + 0.11,
          );
        }
        // Its front, towards the route: what shows of it above its bank, along all of it.
        const front = (t: number, out: number): [number, number] => {
          const [x, z] = [
            seat.x + seat.axisX * seat.length * t,
            seat.z + seat.axisZ * seat.length * t,
          ];
          const frame = roadAt(CLIMB, near.along);
          return [
            x - frame.normalX * side * (seat.width / 2 + out),
            z - frame.normalZ * side * (seat.width / 2 + out),
          ];
        };
        for (let t = -0.45; t <= 0.45; t += 0.15) {
          const [x, z] = front(t, 0.1);
          const where = `seat ${String(side)} at ${t.toFixed(2)}`;
          // In its bank, never standing on it: no gap under its foot.
          expect(surface(x, z) - bottom, where).toBeGreaterThan(0.3);
          // A short face — the owner's "about 1–1.5 m" — never a tall block.
          expect(underside - surface(x, z), where).toBeLessThanOrEqual(1.5 + 0.01);
        }
        // At its middle, where the bank stands in front of it (not where the
        // ground has risen to the deck): the bank comes up to a metre or more
        // under the deck, and falls away from it at 1 : 2.
        const [mx, mz] = front(0, 0.1);
        if (groundAt(mx, mz) < underside - ABUTMENT_FACE_METRES - 1) {
          faced += 1;
          const crest = surface(mx, mz);
          expect(underside - crest).toBeGreaterThanOrEqual(1);
          const [sx, sz] = front(0, 2.1);
          expect(crest - surface(sx, sz)).toBeCloseTo(2 / EMBANKMENT_RUN, 0);
          expect(bankOver(sx, sz)).toBeDefined();
        }
      }
      expect(faced).toBe(ends);
      // Nothing of a bank stands into the deck over the road: under it, in
      // front of its seats and half a metre in from its sides — where the
      // banks round its corners meet it under its edge beams — it stops short
      // of its underside.
      const fronts = abutments.map(
        (seat) =>
          Math.abs(nearestOnDrawnRoad(CLIMB, origin, seat.x, seat.z, 80)?.lateral ?? 0) -
          seat.width / 2,
      );
      const wellUnder = (x: number, z: number): boolean => {
        if (!underDeck(deck, x, z)) return false;
        if (Math.abs((x - deck.x) * across[0] + (z - deck.z) * across[2]) > deck.width / 2 - 0.5) {
          return false;
        }
        const near = nearestOnDrawnRoad(CLIMB, origin, x, z, 80);
        return near !== undefined && Math.abs(near.lateral) < Math.min(...fronts);
      };
      let under = 0;
      for (const triangle of banks) {
        for (const [x, y, z] of pointsOnTriangle({ corners: triangle.corners, colour: TARMAC })) {
          if (!wellUnder(x, z)) continue;
          under += 1;
          expect(y).toBeLessThan(underside);
        }
      }
      expect(under).toBeGreaterThan(0);
      belt.dispose();
      ground.dispose();
    });
  }

  for (const [angle, at, step] of SWEPT) {
    it(`leaves no wall and no open face beside the bridge, crossing at ${String(angle)}° at ${String(at)} m`, () => {
      const street = carriedStreet(at, angle);
      const { triangles, banks, deck, belt, ground } = carriedRoad(street.streets, at);
      const bankOver = binned(banks);
      const roadOver = binned(triangles);
      // What stands there: the ground, or a bank or the road where either is above it.
      const surface = (x: number, z: number, under: number): number =>
        Math.max(
          under,
          bankOver(x, z) ?? Number.NEGATIVE_INFINITY,
          roadOver(x, z) ?? Number.NEGATIVE_INFINITY,
        );
      // Every half metre across the road and along it, both sides, out to the
      // ground the view draws: a step more than `step` between two of them is
      // a wall or the open end of a bank. The bridge itself, in plan, is not.
      const steps: string[] = [];
      let highest = 0;
      const origin = corridorOrigin(CLIMB);
      const seed = scatterSeed(CLIMB);
      const walk = (points: [number, number][], label: string): void => {
        let last: number | undefined;
        let lastOnRoad = false;
        for (const [along, lateral] of points) {
          const [x, z] = offRoad(along, lateral);
          if (underBridge(deck, x, z)) {
            last = undefined;
            continue;
          }
          const under = terrainHeightAt(CLIMB, origin, seed, along, lateral, NO_LAND_CLASS);
          const height = surface(x, z, under);
          // The road from one to the next is its own grade, which the tests above hold.
          const onRoad = height === roadOver(x, z);
          highest = Math.max(highest, height - under);
          const both = onRoad && lastOnRoad;
          lastOnRoad = onRoad;
          if (last !== undefined && !both && Math.abs(height - last) > step) {
            steps.push(
              `${label}: ${(height - last).toFixed(2)} m to ${(height - under).toFixed(2)} m up, at ${lateral.toFixed(1)} m off, ${(along - at).toFixed(1)} m along`,
            );
          }
          last = height;
        }
      };
      for (const side of [-1, 1]) {
        for (let along = -80; along <= 80; along += 4) {
          const points: [number, number][] = [];
          for (let lateral = 12; lateral <= APPROACH_REACH_METRES; lateral += 0.5) {
            points.push([at + along, side * lateral]);
          }
          walk(points, `across, ${String(along)} m along`);
        }
        for (let lateral = 12; lateral <= APPROACH_REACH_METRES; lateral += 4) {
          const points: [number, number][] = [];
          for (let along = -80; along <= 80; along += 0.5) {
            points.push([at + along, side * lateral]);
          }
          walk(points, `along, ${String(side * lateral)} m off`);
        }
      }
      // The banks stood up to be measured.
      expect(highest).toBeGreaterThan(3);
      expect(steps.slice(0, 8)).toEqual([]);
      belt.dispose();
      ground.dispose();
    });
  }
});
