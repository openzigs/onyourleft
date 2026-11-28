// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Guard rails and marker posts on the open road — #3284.
 *
 * The placement is asserted from {@link roadsidePlacement} on synthetic
 * sites (a drop, a mouth, a flat road, a village's kerb), and the drawing
 * through `sceneFrame` and back out of `three-renderer.ts` §`BridgeBelt`'s
 * instance buffers, which is what the rider sees: the rail's top against the
 * drawn road's own edge vertices on a climb and over its crest, and its ends
 * against the stream bridge's parapets on #459's valley.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';

import type { SideRoad } from './cross-streets';
import type { FootwayPiece } from './footway-surfaces';
import { NO_LAND_CLASS } from './land-class';
import { REALISTIC_GUARD_RAIL_BOXES } from './realistic-budget';
import {
  guardRailParts,
  KERB_MARGIN_METRES,
  MARKER_POST_BEND_SPACING_METRES,
  MARKER_POST_SPACING_METRES,
  MOUTH_MARGIN_METRES,
  RAIL_APPROACH_METRES,
  RAIL_DROP_METRES,
  RAIL_HEIGHT_TOLERANCE_METRES,
  RAIL_LATERAL_METRES,
  RAIL_PARAPET_GAP_METRES,
  RAIL_SAMPLE_METRES,
  RAIL_TOP_METRES,
  roadsideInView,
  roadsidePlacement,
  type GuardRailPart,
  type RoadsideSite,
  type RoadSide,
} from './roadside-safety';
import {
  hairpinRoute,
  hillRoute,
  northRoute,
  stadiumRoute,
  valleyRoute,
} from './route-fixtures-testing';
import type { ScatterItem } from './scatter';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { terrainHeightAt } from './landform';
import { FIELD_GATE_SCALE } from './settlements';
import { atStartLine } from './simulation';
import type { VillageStreet } from './streets';
import {
  corridorOrigin,
  drawnRoadFrame,
  roadCorridor,
  ROAD_COLUMNS,
  ROAD_WIDTH_METRES,
  type RoadCorridor,
} from './terrain';
import { BridgeBelt, withMarkerPosts } from './three-renderer';
import { villageRoute, VILLAGE_HOLD_METRES } from '../demo/synthetic-road';
import {
  bridgeSpans,
  PARAPET_HEIGHT_METRES,
  PARAPET_THICKNESS_METRES,
  waterways,
} from './waterways';

const ROAD_HALF = ROAD_WIDTH_METRES / 2;

function frameAt(profile: RouteProfile, odometer: number) {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
  });
}

/** A site with nothing in it: level, straight, open, no bridge. */
function site(overrides: Partial<RoadsideSite> = {}): RoadsideSite {
  return {
    from: 600,
    to: 1_600,
    dropAt: () => 0.25,
    curvatureAt: () => 0,
    clearAt: () => true,
    kerbedAt: () => false,
    bridges: [],
    ...overrides,
  };
}

describe('where a rail stands — #3284', () => {
  it('stands a rail along a 6 m drop on one side for exactly its 200 m, broken at a side road’s mouth', () => {
    // The drop: the ground 6 m under the road's edge on side +1 from 1 000 m
    // to 1 200 m, and level everywhere else and on the other side.
    const dropAt = (along: number, side: RoadSide): number =>
      side === 1 && along >= 1_000 && along <= 1_200 ? 6 : 0.25;
    // A side road 6 m wide leaving on side +1 at 1 100 m: its mouth is its
    // half-width and the margin either side of its middle.
    const mouth = 3 + MOUTH_MARGIN_METRES;
    const clearAt = (along: number, side: RoadSide): boolean =>
      !(side === 1 && Math.abs(along - 1_100) <= mouth);
    const { rails } = roadsidePlacement(site({ dropAt, clearAt }));
    expect(rails.filter((run) => run.side === -1)).toEqual([]);
    const right = rails.filter((run) => run.side === 1);
    expect(right).toHaveLength(2);
    const [before, after] = right as [(typeof right)[0], (typeof right)[0]];
    // That stretch only: from the drop's first sample to its last.
    expect(before.from).toBe(1_000);
    expect(after.to).toBe(1_200);
    // Broken at the mouth, and only there: within a sample of its edges.
    expect(before.to).toBeLessThan(1_100 - mouth);
    expect(before.to).toBeGreaterThanOrEqual(1_100 - mouth - RAIL_SAMPLE_METRES);
    expect(after.from).toBeGreaterThan(1_100 + mouth);
    expect(after.from).toBeLessThanOrEqual(1_100 + mouth + RAIL_SAMPLE_METRES);
    // The control: the same drop with no mouth is one unbroken run.
    const whole = roadsidePlacement(site({ dropAt })).rails;
    expect(whole).toEqual([{ side: 1, from: 1_000, to: 1_200 }]);
    // And a fall just under the stated height takes none.
    const shallow = (along: number, side: RoadSide): number =>
      dropAt(along, side) > 1 ? RAIL_DROP_METRES - 0.01 : 0.25;
    expect(roadsidePlacement(site({ dropAt: shallow })).rails).toEqual([]);
  });

  it('stands one on the outside of a tight bend over a smaller drop, and none on its inside', () => {
    // Turning toward side +1 at a 40 m radius from 1 000 m to 1 100 m, the
    // ground 2 m down on both sides: the outside is side −1.
    const curvatureAt = (along: number): number => (along >= 1_000 && along <= 1_100 ? 1 / 40 : 0);
    const { rails } = roadsidePlacement(site({ curvatureAt, dropAt: () => 2 }));
    expect(rails).toEqual([{ side: -1, from: 1_000, to: 1_100 }]);
    // A gentle bend over the same drop takes none.
    const gentle = (along: number): number => (curvatureAt(along) > 0 ? 1 / 120 : 0);
    expect(roadsidePlacement(site({ curvatureAt: gentle, dropAt: () => 2 })).rails).toEqual([]);
  });

  it('runs a rail along each approach to a bridge from its parapet’s end, and none on the bridge', () => {
    const bridges = [{ from: 988.5, to: 1_011.5 }];
    const { rails, posts } = roadsidePlacement(site({ bridges }));
    // The approach's far end is the last 2 m sample inside its 20 m (970 and
    // 1 030), and its near end is carried from the sample next to the deck on
    // to the parapet's own end.
    expect(RAIL_APPROACH_METRES).toBe(20);
    for (const side of [1, -1] as const) {
      expect(rails.filter((run) => run.side === side)).toEqual([
        { side, from: 970, to: 988.5, parapetTo: true },
        { side, from: 1_011.5, to: 1_030, parapetFrom: true },
      ]);
    }
    // No marker post on the bridge or its approaches.
    for (const post of posts) {
      expect(Math.abs(post.along - 1_000)).toBeGreaterThan(11.5 + RAIL_APPROACH_METRES);
    }
  });
});

describe('where a marker post stands — #3284', () => {
  it('stands no rail on a flat road and a post each side at the stated spacing', () => {
    const { rails, posts } = roadsidePlacement(site());
    expect(rails).toEqual([]);
    const expected = [];
    for (let along = 600; along <= 1_600; along += MARKER_POST_SPACING_METRES) {
      expected.push({ side: 1, along }, { side: -1, along });
    }
    expect(posts).toEqual(expected);
  });

  it('stands them closer on a bend', () => {
    const curvatureAt = (along: number): number => (along >= 1_000 && along <= 1_100 ? 1 / 150 : 0);
    const alongs = roadsidePlacement(site({ curvatureAt }))
      .posts.filter((post) => post.side === 1)
      .map((post) => post.along);
    expect(alongs.filter((along) => along >= 1_000 && along <= 1_100)).toEqual([
      1_000, 1_025, 1_050, 1_075, 1_100,
    ]);
    expect(MARKER_POST_BEND_SPACING_METRES).toBeLessThan(MARKER_POST_SPACING_METRES);
  });

  it('stands neither rail nor post along a village’s kerbed pavement, even over a drop', () => {
    const kerbedAt = (along: number): boolean =>
      along >= 1_000 - KERB_MARGIN_METRES && along <= 1_180 + KERB_MARGIN_METRES;
    const { rails, posts } = roadsidePlacement(site({ kerbedAt, dropAt: () => 8 }));
    for (const run of rails) {
      expect(run.to < 990 || run.from > 1_190).toBe(true);
    }
    expect(rails.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.along < 990 || post.along > 1_190).toBe(true);
    }
    // The control: no kerb, and the rail runs through.
    expect(roadsidePlacement(site({ dropAt: () => 8 })).rails).toEqual([
      { side: 1, from: 600, to: 1_600 },
      { side: -1, from: 600, to: 1_600 },
    ]);
  });
});

describe('the frame’s rails and posts — #3284', () => {
  it('draws posts and no rail on a flat open road, at the stated spacing on the verge', () => {
    const profile = northRoute(3_000, () => 40);
    const frame = frameAt(profile, 1_200);
    expect(frame.guardRails).toEqual([]);
    const posts = frame.markerPosts ?? [];
    expect(posts.length).toBeGreaterThanOrEqual(6);
    const origin = corridorOrigin(profile);
    // Where a post on the 50 m grid stands: the verge, 0.8 m out from the edge.
    const spots: { x: number; z: number }[] = [];
    for (let along = 1_000; along <= 1_400; along += MARKER_POST_SPACING_METRES) {
      const here = drawnRoadFrame(profile, origin, along);
      if (here === undefined) continue;
      for (const side of [1, -1]) {
        spots.push({
          x: here.x + here.normalX * (ROAD_HALF + 0.8) * side,
          z: here.z + here.normalZ * (ROAD_HALF + 0.8) * side,
        });
      }
    }
    for (const post of posts) {
      expect(post.kind).toBe('post');
      const nearest = Math.min(
        ...spots.map((spot) => Math.hypot(spot.x - post.x, spot.z - post.z)),
      );
      expect(nearest).toBeLessThan(0.01);
    }
    // Every spot from 40 m behind the rider to 150 m ahead has its post, both
    // sides: 1 200, 1 250, 1 300 and 1 350 m.
    expect(posts).toHaveLength(8);
  });

  it('draws neither along the village road’s kerb, at the frame the owner’s village page holds', () => {
    const profile = villageRoute();
    const frame = frameAt(profile, VILLAGE_HOLD_METRES);
    expect(frame.streets.length).toBeGreaterThan(0);
    // ⚠️ None at all on this frame: it is held to exactly the village's
    // frozen draw calls (`realistic-town.browser.spec.ts` §"#1689").
    expect(frame.guardRails).toEqual([]);
    expect(frame.markerPosts).toEqual([]);
  });

  it('breaks the posts at a mapped side road’s mouth, a field gate and a footway, and only there', () => {
    const profile = northRoute(3_000, () => 40);
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 1_100);
    const at = (along: number, side: RoadSide, lateral: number): { x: number; z: number } => {
      const here = drawnRoadFrame(profile, origin, along);
      if (here === undefined) throw new Error('no road');
      return {
        x: here.x + here.normalX * lateral * side,
        z: here.z + here.normalZ * lateral * side,
      };
    };
    const mouthFrom = at(1_100, 1, 0);
    const mouthTo = at(1_100, 1, 30);
    const sideRoad: SideRoad = {
      junction: { along: 1_100, source: 'mapped', arms: [] },
      mesh: {
        positions: new Float32Array(),
        colours: new Float32Array(),
        across: new Float32Array(),
        indices: new Uint32Array(),
      },
      segments: Float32Array.from([mouthFrom.x, mouthFrom.z, mouthTo.x, mouthTo.z]),
      halfWidths: Float32Array.from([3]),
    };
    const gateAt = at(1_150, -1, 5.6);
    const gate: ScatterItem = {
      kind: 'fence',
      x: gateAt.x,
      y: 0,
      z: gateAt.z,
      rotation: 0,
      scale: FIELD_GATE_SCALE,
      variant: 0,
    };
    const pathAt = at(1_200, 1, 5.5);
    const footway: FootwayPiece = {
      kind: 'footway',
      positions: Float32Array.from([pathAt.x, 0, pathAt.z]),
      colours: new Float32Array(3),
      indices: new Uint32Array(),
    };
    const scene = {
      profile,
      origin,
      seed: scatterSeed(profile),
      land: NO_LAND_CLASS,
      corridor,
      riderDistance: 1_100,
      bridges: [],
      sideRoads: [] as SideRoad[],
      footways: [] as FootwayPiece[],
      streets: [] as VillageStreet[],
      scenery: [] as ScatterItem[],
    };
    /** Each post as `along:side`, the 25 m spot it stands at, `right` on the road's normal. */
    const standing = (posts: readonly ScatterItem[]): string[] =>
      posts.map((post) => {
        let found = '';
        let best = Number.POSITIVE_INFINITY;
        for (let along = 900; along <= 1_400; along += 25) {
          for (const side of [1, -1] as const) {
            const spot = at(along, side, ROAD_HALF + 0.8);
            const distance = Math.hypot(spot.x - post.x, spot.z - post.z);
            if (distance < best) {
              best = distance;
              found = `${String(along)}:${side === 1 ? 'right' : 'left'}`;
            }
          }
        }
        expect(best).toBeLessThan(0.01);
        return found;
      });
    const open = standing(roadsideInView(scene).posts);
    for (const spot of ['1100:right', '1150:left', '1200:right', '1100:left', '1150:right']) {
      expect(open).toContain(spot);
    }
    const blocked = standing(
      roadsideInView({ ...scene, sideRoads: [sideRoad], scenery: [gate], footways: [footway] })
        .posts,
    );
    expect(blocked).not.toContain('1100:right');
    expect(blocked).not.toContain('1150:left');
    expect(blocked).not.toContain('1200:right');
    // And only there: the other side at each, and every other post, still stand.
    expect(blocked).toContain('1100:left');
    expect(blocked).toContain('1150:right');
    expect(blocked).toContain('1200:left');
    expect(blocked).toHaveLength(open.length - 3);
    // Along a village's kerb, none.
    const kerbed = roadsideInView({
      ...scene,
      streets: [{ from: 1_000, to: 1_150 } as VillageStreet],
    }).posts;
    const alongOf = (spot: string): number => Number(spot.split(':')[0]);
    expect(
      standing(kerbed).filter(
        (spot) =>
          alongOf(spot) >= 1_000 - KERB_MARGIN_METRES &&
          alongOf(spot) <= 1_150 + KERB_MARGIN_METRES,
      ),
    ).toEqual([]);
    expect(standing(kerbed).length).toBeGreaterThan(0);
  });
});

/** One box read back out of the overpass mesh's instance buffers. */
interface DrawnBox {
  readonly centre: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly along: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
  readonly length: number;
}

function drawnRails(rails: readonly GuardRailPart[]): DrawnBox[] {
  const belt = new BridgeBelt();
  belt.setWorld('realistic');
  belt.update([], rails);
  const mesh = belt.overpassMesh;
  const matrices = mesh.instanceMatrix.array as Float32Array;
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
    out.push({
      centre: [e[12] as number, e[13] as number, e[14] as number],
      up: column(1).unit,
      along: column(2).unit,
      width: column(0).size,
      height: column(1).size,
      length: column(2).size,
    });
  }
  belt.dispose();
  return out;
}

/**
 * The upper ridges: the boxes whose top is the rail's top — of each pair of
 * ridges (0.1 m deep, 0.06 m across) over the same stretch, the higher.
 */
function upperRidges(boxes: readonly DrawnBox[]): DrawnBox[] {
  const ridges = boxes.filter(
    (box) => Math.abs(box.height - 0.1) < 1e-4 && Math.abs(box.width - 0.06) < 1e-4,
  );
  return ridges.filter((ridge) =>
    ridges.some(
      (other) =>
        other !== ridge &&
        Math.hypot(other.centre[0] - ridge.centre[0], other.centre[2] - ridge.centre[2]) < 0.05 &&
        other.centre[1] < ridge.centre[1],
    ),
  );
}

/** A box's top face's middle line, end to end. */
function topLine(box: DrawnBox): { a: [number, number, number]; b: [number, number, number] } {
  const top = box.centre.map((value, axis) => value + ((box.up[axis] as number) * box.height) / 2);
  const half = box.length / 2;
  return {
    a: top.map((value, axis) => value - (box.along[axis] as number) * half) as [
      number,
      number,
      number,
    ],
    b: top.map((value, axis) => value + (box.along[axis] as number) * half) as [
      number,
      number,
      number,
    ],
  };
}

/** The drawn road's edge height under a point in plan: its own vertices, row to row. */
function drawnEdgeHeight(corridor: RoadCorridor, x: number, z: number): number | undefined {
  let best: { distance: number; height: number } | undefined;
  for (const column of [0, ROAD_COLUMNS - 1]) {
    for (let row = 0; row + 1 < corridor.centre.length; row += 1) {
      const p = (row * ROAD_COLUMNS + column) * 3;
      const q = ((row + 1) * ROAD_COLUMNS + column) * 3;
      const v = corridor.vertices;
      const ax = v[p] as number;
      const az = v[p + 2] as number;
      const bx = v[q] as number;
      const bz = v[q + 2] as number;
      const dx = bx - ax;
      const dz = bz - az;
      const squared = dx * dx + dz * dz;
      if (!(squared > 0)) continue;
      const t = ((x - ax) * dx + (z - az) * dz) / squared;
      if (t < 0 || t > 1) continue;
      const distance = Math.hypot(ax + dx * t - x, az + dz * t - z);
      const height = (v[p + 1] as number) + ((v[q + 1] as number) - (v[p + 1] as number)) * t;
      if (best === undefined || distance < best.distance) best = { distance, height };
    }
  }
  return best !== undefined && best.distance < 1 ? best.height : undefined;
}

describe('a rail follows the drawn road — #3284', () => {
  it.each([
    // #458's hill: a 10 % climb.
    ['up a 10 % climb', hillRoute(), 600, 10],
    // #459's valley: 5 % down to the bridge's approach.
    ['down into a valley to a bridge', valleyRoute(), 960, 4],
  ] as const)(
    'holds the rail’s top to the road’s edge height at every sample, %s',
    (_, profile, at, least) => {
      // Read back out of the belt, against the road's own vertices.
      const frame = frameAt(profile, at);
      const rails = frame.guardRails ?? [];
      const ridges = upperRidges(drawnRails(rails));
      expect(ridges.length).toBeGreaterThan(least);
      let samples = 0;
      for (const ridge of ridges) {
        const { a, b } = topLine(ridge);
        for (let step = 0; step <= 10; step += 1) {
          const t = step / 10;
          const x = a[0] + (b[0] - a[0]) * t;
          const y = a[1] + (b[1] - a[1]) * t;
          const z = a[2] + (b[2] - a[2]) * t;
          const edge = drawnEdgeHeight(frame.corridor, x, z);
          expect(edge).toBeDefined();
          if (edge === undefined) continue;
          samples += 1;
          expect(
            Math.abs(y - (edge + RAIL_TOP_METRES)),
            `at z ${z.toFixed(1)}`,
          ).toBeLessThanOrEqual(RAIL_HEIGHT_TOLERANCE_METRES);
        }
      }
      expect(samples).toBeGreaterThan(least * 8);
      // Non-vacuity: the rails cover road whose height changes.
      const heights = ridges.map((ridge) => ridge.centre[1]);
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.5);
    },
  );

  it('meets the stream bridge’s parapets with no gap wider than the stated figure, both sides, both ends', () => {
    // #459's valley: the stream crosses at the floor, 1 000 m.
    const profile = valleyRoute();
    const frame = frameAt(profile, 960);
    const ways = waterways(profile, scatterSeed(profile), NO_LAND_CLASS);
    const spans = bridgeSpans(profile, frame.corridor, ways);
    expect(spans).toHaveLength(1);
    const span = spans[0] as { from: number; to: number };
    const parapets = frame.water.bridges.filter(
      (part) =>
        part.finish === undefined && Math.abs(part.height - (PARAPET_HEIGHT_METRES + 0.1)) < 1e-9,
    );
    expect(parapets.length).toBeGreaterThan(4);
    const ridges = upperRidges(drawnRails(frame.guardRails ?? []));
    // The road runs north, so along it is `z` and across it `x`.
    const origin = corridorOrigin(profile);
    const parapetEnds = parapets.flatMap((part) => [
      part.z - (part.axisZ * part.length) / 2,
      part.z + (part.axisZ * part.length) / 2,
    ]);
    const deckFrom = Math.min(...parapetEnds);
    const deckTo = Math.max(...parapetEnds);
    // The parapets are where `bridgeSpans` says the deck is.
    expect(deckFrom).toBeCloseTo(drawnRoadFrame(profile, origin, span.from)?.z ?? 0, 2);
    expect(deckTo).toBeCloseTo(drawnRoadFrame(profile, origin, span.to)?.z ?? 0, 2);
    for (const side of [1, -1]) {
      const mine = ridges.filter((ridge) => Math.sign(ridge.centre[0]) === side);
      const ends = mine.flatMap((ridge) => {
        const { a, b } = topLine(ridge);
        return [a[2], b[2]];
      });
      // The rail's last end before the deck and first after it.
      const before = Math.max(...ends.filter((z) => z < (deckFrom + deckTo) / 2));
      const after = Math.min(...ends.filter((z) => z > (deckFrom + deckTo) / 2));
      expect(Math.max(0, deckFrom - before), `side ${String(side)} before`).toBeLessThanOrEqual(
        RAIL_PARAPET_GAP_METRES,
      );
      expect(Math.max(0, after - deckTo), `side ${String(side)} after`).toBeLessThanOrEqual(
        RAIL_PARAPET_GAP_METRES,
      );
      // Into the parapet's end, not along the deck.
      expect(before).toBeLessThan(deckFrom + 0.5);
      expect(after).toBeGreaterThan(deckTo - 0.5);
      // And inside the parapet's thickness across the road, so it meets its end face.
      for (const ridge of mine) {
        const across = Math.abs(ridge.centre[0]);
        expect(across - ridge.width / 2).toBeGreaterThanOrEqual(ROAD_HALF);
        expect(across + ridge.width / 2).toBeLessThanOrEqual(ROAD_HALF + PARAPET_THICKNESS_METRES);
      }
      expect(Math.abs(RAIL_LATERAL_METRES - ROAD_HALF)).toBeLessThan(PARAPET_THICKNESS_METRES);
    }
  });

  it('keeps the rail on its line round a hairpin: each piece only as long as stays within the tolerance', () => {
    // A 30 m hairpin climbing 4 %: a rail on both sides the whole way round.
    const profile = hairpinRoute(30);
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 420);
    const run = (side: RoadSide) => ({ side, from: 390, to: 520 });
    const rails = guardRailParts(corridor, { rails: [run(1), run(-1)], posts: [] }, 420);
    const ridges = upperRidges(drawnRails(rails));
    expect(ridges.length).toBeGreaterThan(20);
    /** How far a point in plan is from the drawn centreline: its rows, joined straight. */
    const fromCentre = (x: number, z: number): number => {
      let best = Number.POSITIVE_INFINITY;
      for (let row = 0; row + 1 < corridor.centre.length; row += 1) {
        const a = corridor.centre[row] as { x: number; z: number };
        const b = corridor.centre[row + 1] as { x: number; z: number };
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const squared = dx * dx + dz * dz;
        const t =
          squared > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / squared)) : 0;
        best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
      }
      return best;
    };
    let worst = 0;
    for (const ridge of ridges) {
      const { a, b } = topLine(ridge);
      for (let step = 0; step <= 10; step += 1) {
        const t = step / 10;
        const off = Math.abs(
          fromCentre(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t) - RAIL_LATERAL_METRES,
        );
        worst = Math.max(worst, off);
      }
    }
    // Within the tolerance (and the few millimetres a straight chord of the
    // inside line cuts against a polyline of the centre's), never a chord's sagitta.
    expect(worst).toBeLessThanOrEqual(RAIL_HEIGHT_TOLERANCE_METRES * 2);
  });
});

/**
 * The sides of the road the frame's rails stand on, read back out of the
 * drawn boxes: each upper ridge against the drawn road's own normal at its
 * nearest point (`side` is the sign on that normal, as `edgeAt` takes it).
 */
function railedSides(profile: RouteProfile, odometer: number): Map<RoadSide, number[]> {
  const origin = corridorOrigin(profile);
  const frame = frameAt(profile, odometer);
  const sides = new Map<RoadSide, number[]>();
  for (const ridge of upperRidges(drawnRails(frame.guardRails ?? []))) {
    let best: { distance: number; along: number; side: RoadSide } | undefined;
    for (let along = odometer - 60; along <= odometer + 260; along += 1) {
      const here = drawnRoadFrame(profile, origin, along);
      if (here === undefined) continue;
      const dx = ridge.centre[0] - here.x;
      const dz = ridge.centre[2] - here.z;
      const distance = Math.hypot(dx, dz);
      if (best === undefined || distance < best.distance) {
        best = {
          distance,
          along,
          side: dx * here.normalX + dz * here.normalZ >= 0 ? 1 : -1,
        };
      }
    }
    if (best === undefined) continue;
    sides.set(best.side, [...(sides.get(best.side) ?? []), best.along]);
  }
  return sides;
}

/** Which side of a bend its outside is, by the road's own geometry: away from the chord's middle. */
function outsideOfBend(profile: RouteProfile, along: number): RoadSide | undefined {
  const origin = corridorOrigin(profile);
  const back = drawnRoadFrame(profile, origin, along - 20);
  const here = drawnRoadFrame(profile, origin, along);
  const ahead = drawnRoadFrame(profile, origin, along + 20);
  if (back === undefined || here === undefined || ahead === undefined) return undefined;
  const inward =
    ((back.x + ahead.x) / 2 - here.x) * here.normalX +
    ((back.z + ahead.z) / 2 - here.z) * here.normalZ;
  return inward > 0 ? -1 : 1;
}

describe('which side of the road the scene stands a rail on — #3284', () => {
  it.each([
    // #458's hill: the ground falls away on side +1 only at 600 m, on side −1 only at 1 100 m.
    [600, 1],
    [1_100, -1],
  ] as const)(
    'stands a rail on the side the ground falls away, and only that side, at %i m',
    (odometer, fallen) => {
      const profile = hillRoute();
      const origin = corridorOrigin(profile);
      const seed = scatterSeed(profile);
      // The ground's own fall from the road's edge, each side, by the landform.
      const fall = (along: number, side: RoadSide): number => {
        let lowest = Number.POSITIVE_INFINITY;
        for (const lateral of [3.6, 8, 12, 18, 26.5]) {
          lowest = Math.min(
            lowest,
            terrainHeightAt(profile, origin, seed, along, lateral * side, NO_LAND_CLASS),
          );
        }
        return terrainHeightAt(profile, origin, seed, along, 0, NO_LAND_CLASS) - lowest;
      };
      const sides = railedSides(profile, odometer);
      expect([...sides.keys()]).toEqual([fallen]);
      const railed = sides.get(fallen) ?? [];
      expect(railed.length).toBeGreaterThan(10);
      // Where it stands the ground falls away on that side and not on the other.
      const middle = railed.slice().sort((a, b) => a - b)[Math.floor(railed.length / 2)] as number;
      expect(fall(middle, fallen)).toBeGreaterThan(RAIL_DROP_METRES);
      expect(fall(middle, -fallen as RoadSide)).toBeLessThan(RAIL_DROP_METRES);
    },
  );

  it('stands a rail on the outside of a tight bend over a small fall, and none on its inside', () => {
    // A stadium loop's 25 m bends: the ground 1 to 3 m down on the outside of
    // the first (410–455 m), and on the inside of the second (890–915 m): both
    // bends turn the same way, so the outside is the same side of the road.
    const profile = stadiumRoute(25);
    const outside = railedSides(profile, 400);
    const bend = outsideOfBend(profile, 430);
    expect(bend).toBeDefined();
    expect([...outside.keys()]).toEqual([bend]);
    expect(outsideOfBend(profile, 900)).toBe(bend);
    const around = [...railedSides(profile, 800).values()]
      .flat()
      .filter((along) => along >= 885 && along <= 912);
    expect(around).toEqual([]);
  });
});

describe('the rails’ budget — #3284', () => {
  it('draws at most the stated boxes, nearest the rider first', () => {
    const profile = hillRoute();
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 600);
    const run = (side: RoadSide) => ({ side, from: 300, to: 1_000 });
    const once = guardRailParts(corridor, { rails: [run(1), run(-1)], posts: [] }, 600);
    expect(once.length).toBeLessThan(REALISTIC_GUARD_RAIL_BOXES);
    // Each run twice over is more than the belt holds: cut to it, nearest first.
    const twice = { rails: [run(1), run(-1), run(1), run(-1)], posts: [] };
    const parts = guardRailParts(corridor, twice, 600);
    expect(parts).toHaveLength(REALISTIC_GUARD_RAIL_BOXES);
    const reach = (boxes: readonly GuardRailPart[]): number => {
      const first = corridor.centre.find((row) => row.along >= 600);
      return Math.max(...boxes.map((box) => Math.abs(box.z - (first?.z ?? 0))));
    };
    expect(reach(parts)).toBeLessThan(reach(once));
    // And all of them are drawn: the belt's room is the overpasses' and these.
    const belt = new BridgeBelt();
    belt.setWorld('realistic');
    belt.update([], parts);
    expect(belt.overpassMesh.count).toBe(REALISTIC_GUARD_RAIL_BOXES);
    belt.dispose();
  });

  it('draws the rails in the overpass box in the realistic world, and none in the stylised', () => {
    const frame = frameAt(hillRoute(), 600);
    const rails = frame.guardRails ?? [];
    expect(rails.length).toBeGreaterThan(0);
    const belt = new BridgeBelt();
    belt.update(frame.water.bridges, rails);
    expect(belt.overpassMesh.count).toBe(0);
    expect(belt.overpassMesh.visible).toBe(false);
    belt.setWorld('realistic');
    belt.update(frame.water.bridges, rails);
    expect(belt.overpassMesh.count).toBe(rails.length);
    expect(belt.overpassMesh.visible).toBe(true);
    // No stone, and the stone mesh untouched: one mesh drew them.
    expect(belt.mesh.count).toBe(0);
    belt.dispose();
  });

  it('hands the marker posts to the scenery belts after the scatter, in the realistic world only', () => {
    const frame = frameAt(
      northRoute(3_000, () => 40),
      1_200,
    );
    const posts = frame.markerPosts ?? [];
    expect(posts.length).toBeGreaterThan(0);
    expect(withMarkerPosts(frame, 'stylised')).toBe(frame.scatter);
    const realistic = withMarkerPosts(frame, 'realistic');
    expect(realistic).toHaveLength(frame.scatter.length + posts.length);
    expect(realistic.slice(frame.scatter.length)).toEqual(posts);
    expect(withMarkerPosts({ scatter: frame.scatter }, 'realistic')).toBe(frame.scatter);
  });
});
