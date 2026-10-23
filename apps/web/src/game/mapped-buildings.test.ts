// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1549's selection and clearing, without a renderer: which mapped buildings a
 * refill draws, at which level, in how many surfaces, and the ground they
 * clear of trees. `realistic-renderer.test.ts` §"#1549" reads the same
 * selection back out of the belt's buffers, and the browser gate draws it.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';

import { footprintPlans, type FootprintPlan } from './footprint-buildings';
import {
  buildingBeside,
  mixedTownFixture,
  rectangleBeside,
  rowTownFixture,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import {
  clearOfMappedBuildings,
  DRIVEWAY_MARGIN_METRES,
  mappedBuildingsOf,
  mappedChunk,
  MappedSelection,
  onMappedGround,
  selectMappedBuildings,
  type MappedBuildings,
  type RivalStructures,
} from './mapped-buildings';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_BUILDING_REACH_METRES,
  MAPPED_BUILDING_TRIANGLES,
  MAPPED_CHUNK_METRES,
  REALISTIC_STRUCTURE_ITEMS,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import type { StructureSurface } from './realistic-assets';
import type { SceneFrame } from './port';
import { northRoute } from './route-fixtures-testing';
import type { ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import { SETTLEMENT_CLEARED_KINDS, SETTLEMENT_MARGIN_METRES } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, VIEW_AHEAD_METRES } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const town = rowTownFixture();
const planned = footprintPlans(
  town.corridor,
  landClassMask(town.corridor),
  town.profile,
  town.origin,
).plans;
const buildings = mappedBuildingsOf(planned);

/** The drawn road at `along`, local metres. */
function roadAt(along: number): { readonly x: number; readonly z: number } {
  const frame = drawnRoadFrame(town.profile, town.origin, along);
  if (frame === undefined) throw new Error('the fixture road has no direction there');
  return { x: frame.x, z: frame.z };
}

/** How far a plan's centroid is from `(x, z)`. */
function apart(plan: FootprintPlan, at: { readonly x: number; readonly z: number }): number {
  return Math.hypot(plan.centroid.x - at.x, plan.centroid.z - at.z);
}

/** The selection's drawn plans, nearest first. */
function drawn(selection: MappedSelection): FootprintPlan[] {
  return Array.from(selection.plans.subarray(0, selection.count), (index) => {
    return planned[index] as FootprintPlan;
  });
}

describe('the numbers #1549 states', () => {
  it('shares the structures’ term, reaches as far as the road, and refills every 100 m', () => {
    expect(MAPPED_BUILDING_TRIANGLES).toBe(
      REALISTIC_STRUCTURE_ITEMS * REALISTIC_TRIANGLES.structure,
    );
    expect(MAPPED_BUILDING_TRIANGLES).toBe(23_040);
    expect(MAPPED_BUILDING_REACH_METRES).toBe(VIEW_AHEAD_METRES);
    expect(MAPPED_BUILDING_MAX).toBe(36);
    expect(MAPPED_BUILDING_DRAW_CALLS).toBe(6);
    expect(mappedChunk(0)).toBe(0);
    expect(mappedChunk(MAPPED_CHUNK_METRES - 0.01)).toBe(0);
    expect(mappedChunk(MAPPED_CHUNK_METRES)).toBe(1);
    expect(mappedChunk(2_050)).toBe(20);
  });
});

describe('which mapped buildings a refill draws — #1549', () => {
  const rider = roadAt(1_500);
  const inReach = planned.filter((plan) => apart(plan, rider) <= MAPPED_BUILDING_REACH_METRES);

  it('draws the nearest, at most MAPPED_BUILDING_MAX, every one past 150 m at its far level', () => {
    // 170 m off the road's side: at D-5.6's 36 the nearest from the road are
    // all within 150 m, and from here they straddle it.
    const aside = { x: rider.x + 170, z: rider.z };
    const reached = planned.filter((plan) => apart(plan, aside) <= MAPPED_BUILDING_REACH_METRES);
    // Non-vacuity: the count binds, and some of what is drawn is past the near level.
    expect(reached.length).toBeGreaterThan(MAPPED_BUILDING_MAX);
    const selection = new MappedSelection();
    selectMappedBuildings(buildings, aside.x, aside.z, MAPPED_BUILDING_TRIANGLES, selection);
    expect(selection.count).toBe(MAPPED_BUILDING_MAX);
    const plans = drawn(selection);
    const distances = plans.map((plan) => apart(plan, aside));
    for (let at = 1; at < distances.length; at += 1) {
      expect(distances[at]).toBeGreaterThanOrEqual(distances[at - 1] as number);
    }
    // The nearest: nothing undrawn in reach is nearer than the farthest drawn.
    const farthest = Math.max(...distances);
    const drawnSet = new Set(plans);
    for (const plan of reached.filter((each) => !drawnSet.has(each))) {
      expect(apart(plan, aside)).toBeGreaterThanOrEqual(farthest);
    }
    // The level: far exactly past MAPPED_BUILDING_NEAR_METRES.
    distances.forEach((distance, at) => {
      expect(selection.far[at], String(distance)).toBe(
        distance > MAPPED_BUILDING_NEAR_METRES ? 1 : 0,
      );
    });
    expect(selection.farCount).toBeGreaterThan(0);
    expect(selection.near).toBeGreaterThan(0);
    expect(selection.near + selection.farCount).toBe(selection.count);
    // The triangles: each at its level's count, and the far level is lighter.
    expect(selection.triangles).toBe(
      plans.reduce(
        (sum, plan, at) =>
          sum + (selection.far[at] === 1 ? plan.farTriangleCount : plan.triangleCount),
        0,
      ),
    );
    for (const plan of plans) expect(plan.farTriangleCount).toBeLessThan(plan.triangleCount);
  });

  it('stops at the budget, nearest first, and the next would not have fitted', () => {
    const selection = new MappedSelection();
    // Under D-5.6's 36: since #1581 the fixture's houses are 38 to 78
    // triangles near, so 1 000 hold more than ten of them and fewer than 36.
    const budget = 1_000;
    selectMappedBuildings(buildings, rider.x, rider.z, budget, selection);
    expect(selection.count).toBeGreaterThan(10);
    expect(selection.count).toBeLessThan(MAPPED_BUILDING_MAX);
    expect(selection.triangles).toBeLessThanOrEqual(budget);
    const plans = drawn(selection);
    const sorted = [...inReach].sort((a, b) => apart(a, rider) - apart(b, rider));
    const next = sorted[selection.count] as FootprintPlan;
    const nextTriangles =
      apart(next, rider) > MAPPED_BUILDING_NEAR_METRES ? next.farTriangleCount : next.triangleCount;
    expect(selection.triangles + nextTriangles).toBeGreaterThan(budget);
    expect(new Set(plans)).toStrictEqual(new Set(sorted.slice(0, selection.count)));
  });

  it('draws none with no budget, and none out of reach', () => {
    const selection = new MappedSelection();
    selectMappedBuildings(buildings, rider.x, rider.z, 0, selection);
    expect(selection.count).toBe(0);
    expect(selection.surfaces).toStrictEqual([]);
    selectMappedBuildings(
      buildings,
      rider.x + 5_000,
      rider.z,
      MAPPED_BUILDING_TRIANGLES,
      selection,
    );
    expect(selection.count).toBe(0);
  });

  /** The town, its plans dressed round eight surfaces in turn, so a refill meets all of them. */
  const motley = (): MappedBuildings => {
    const walls: StructureSurface[] = ['brick', 'render', 'concrete', 'corrugated', 'planks'];
    const roofs: StructureSurface[] = ['roof-tiles', 'slate', 'flat-roof'];
    return mappedBuildingsOf(
      planned.map((plan, index) => ({
        ...plan,
        surfaces: {
          wall: walls[index % walls.length] as StructureSurface,
          roof: roofs[Math.floor(index / walls.length) % roofs.length] as StructureSurface,
        },
      })),
    );
  };

  it('opens at most six surfaces, whatever the town wears, and counts what it passed over', () => {
    const selection = new MappedSelection();
    selectMappedBuildings(motley(), rider.x, rider.z, MAPPED_BUILDING_TRIANGLES, selection);
    expect(selection.surfaces.length).toBe(MAPPED_BUILDING_DRAW_CALLS);
    expect(selection.passed).toBeGreaterThan(0);
    // What was passed over waits; the rest of the town is still drawn.
    expect(selection.count).toBeGreaterThan(MAPPED_BUILDING_MAX / 2);
    expect(selection.count + selection.passed).toBeLessThanOrEqual(inReach.length);
    // Every triangle is in an open surface, and the surfaces add up to the whole.
    const sum = Array.from(selection.surfaceTriangles).reduce((total, each) => total + each, 0);
    expect(sum).toBe(selection.triangles);
    // THE CONTROL: with eight surfaces allowed the same town opens eight.
    const unbounded = new MappedSelection();
    selectMappedBuildings(motley(), rider.x, rider.z, MAPPED_BUILDING_TRIANGLES, unbounded, 8);
    expect(unbounded.surfaces.length).toBe(8);
    expect(unbounded.passed).toBe(0);
  });

  it('draws the same town the same way twice', () => {
    const first = new MappedSelection();
    const second = new MappedSelection();
    selectMappedBuildings(buildings, rider.x, rider.z, MAPPED_BUILDING_TRIANGLES, first);
    selectMappedBuildings(buildings, rider.x, rider.z, MAPPED_BUILDING_TRIANGLES, second);
    expect(Array.from(second.plans)).toStrictEqual(Array.from(first.plans));
  });
});

describe('the mapped buildings ranked with the procedural structures, under one budget — #1586', () => {
  const rider = roadAt(1_500);
  const structure = REALISTIC_TRIANGLES.structure;
  const sorted = planned
    .filter((plan) => apart(plan, rider) <= MAPPED_BUILDING_REACH_METRES)
    .sort((a, b) => apart(a, rider) - apart(b, rider));
  const rivalsAt = (...distances: number[]): RivalStructures => ({
    distances: Float64Array.from(distances),
    count: distances.length,
    triangles: structure,
  });

  it('takes a building nearer than every structure before them, and the structures fill the rest', () => {
    // 36 structures 300 m out: the issue's fields beyond a town's end.
    const selection = new MappedSelection();
    const rivals = rivalsAt(...Array.from({ length: REALISTIC_STRUCTURE_ITEMS }, () => 300));
    selectMappedBuildings(
      buildings,
      rider.x,
      rider.z,
      MAPPED_BUILDING_TRIANGLES,
      selection,
      MAPPED_BUILDING_DRAW_CALLS,
      rivals,
    );
    // Non-vacuity: the fixture's nearest 36 houses are all nearer than 300 m.
    expect(apart(sorted[MAPPED_BUILDING_MAX - 1] as FootprintPlan, rider)).toBeLessThan(300);
    expect(selection.count).toBe(MAPPED_BUILDING_MAX);
    expect(new Set(drawn(selection))).toStrictEqual(new Set(sorted.slice(0, MAPPED_BUILDING_MAX)));
    // The structures take what is left, whole ones only, and the term holds.
    expect(selection.rivals).toBe(
      Math.floor((MAPPED_BUILDING_TRIANGLES - selection.triangles) / structure),
    );
    expect(selection.rivals).toBeLessThan(REALISTIC_STRUCTURE_ITEMS);
    expect(selection.triangles + selection.rivals * structure).toBeLessThanOrEqual(
      MAPPED_BUILDING_TRIANGLES,
    );
  });

  it('takes structures nearer than every building first, and draws no building past them', () => {
    const selection = new MappedSelection();
    const rivals = rivalsAt(...Array.from({ length: REALISTIC_STRUCTURE_ITEMS }, () => 0));
    selectMappedBuildings(
      buildings,
      rider.x,
      rider.z,
      MAPPED_BUILDING_TRIANGLES,
      selection,
      MAPPED_BUILDING_DRAW_CALLS,
      rivals,
    );
    expect(selection.rivals).toBe(REALISTIC_STRUCTURE_ITEMS);
    expect(selection.count).toBe(0);
  });

  it('interleaves by distance: a building beyond a structure that fills the budget is not drawn', () => {
    const nearest = apart(sorted[0] as FootprintPlan, rider);
    // The houses nearest the rider stand in pairs across the road, as near as each other.
    const level = sorted.findIndex((plan) => apart(plan, rider) > nearest);
    const second = apart(sorted[level] as FootprintPlan, rider);
    // Non-vacuity: room between the nearest and the next for a structure.
    expect(level).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(nearest);
    const first = sorted.slice(0, level);
    // A budget of the nearest buildings and one structure, the structure between them and the next.
    const budget = first.reduce((sum, plan) => sum + plan.triangleCount, 0) + structure;
    const selection = new MappedSelection();
    selectMappedBuildings(
      buildings,
      rider.x,
      rider.z,
      budget,
      selection,
      MAPPED_BUILDING_DRAW_CALLS,
      rivalsAt((nearest + second) / 2, (nearest + second) / 2),
    );
    expect(new Set(drawn(selection))).toStrictEqual(new Set(first));
    expect(selection.rivals).toBe(1);
    // THE CONTROL: with no structure, the same budget draws the next building too.
    const alone = new MappedSelection();
    selectMappedBuildings(buildings, rider.x, rider.z, budget, alone);
    expect(alone.count).toBeGreaterThan(level);
    expect(alone.rivals).toBe(0);
  });
});

describe('no tree, shrub or rock on a mapped building’s ground — #1549, #1534', () => {
  const plan = planned[0] as FootprintPlan;
  const item = (kind: ScatterItem['kind'], x: number, z: number): ScatterItem => ({
    kind,
    x,
    y: 0,
    z,
    rotation: 0,
    scale: 1,
    variant: 0,
  });
  /** A point `out` metres beyond the outline's first edge's middle, away from the centroid. */
  const beyondEdge = (out: number): { readonly x: number; readonly z: number } => {
    const [ax, az, bx, bz] = Array.from(plan.footprint.subarray(0, 4));
    const mx = ((ax as number) + (bx as number)) / 2;
    const mz = ((az as number) + (bz as number)) / 2;
    const dx = mx - plan.centroid.x;
    const dz = mz - plan.centroid.z;
    const length = Math.hypot(dx, dz);
    return { x: mx + (dx / length) * out, z: mz + (dz / length) * out };
  };

  it('clears inside the footprint and within the margin, and nothing further out', () => {
    const inside = item('tree-broadleaf', plan.centroid.x, plan.centroid.z);
    const margin = beyondEdge(SETTLEMENT_MARGIN_METRES - 1);
    const outside = beyondEdge(SETTLEMENT_MARGIN_METRES + 4);
    const near = item('shrub', margin.x, margin.z);
    const far = item('rock', outside.x, outside.z);
    const post = item('post', plan.centroid.x, plan.centroid.z);
    expect(onMappedGround(buildings, inside.x, inside.z)).toBe(true);
    expect(clearOfMappedBuildings([inside, near, far, post], buildings)).toStrictEqual([far, post]);
  });

  it('clears a driveway and a metre beside it, and nothing further off — #1588', () => {
    const town = mixedTownFixture();
    const { plans } = footprintPlans(
      town.corridor,
      landClassMask(town.corridor),
      town.profile,
      town.origin,
    );
    // The longest, whose road end is furthest from its house: the reach has to take the driveway in.
    const drivewayLength = (each: FootprintPlan): number =>
      Math.hypot(
        (each.driveway[4] as number) - (each.driveway[0] as number),
        (each.driveway[5] as number) - (each.driveway[1] as number),
      );
    const garaged = plans
      .filter((each) => each.garage && each.driveway.length > 0)
      .reduce<FootprintPlan | undefined>(
        (longest, each) =>
          longest === undefined || drivewayLength(each) > drivewayLength(longest) ? each : longest,
        undefined,
      );
    if (garaged === undefined) throw new Error('the mixed town has no driveway');
    const indexed = mappedBuildingsOf(plans);
    const ring = garaged.driveway;
    // Near its road end, far from any house's margin; and the driveway's own across.
    const corner = (at: number): readonly [number, number] => [
      ring[at * 2] as number,
      ring[at * 2 + 1] as number,
    ];
    const [a, b, c, d] = [corner(0), corner(1), corner(2), corner(3)];
    const startX = (a[0] + b[0]) / 2;
    const startZ = (a[1] + b[1]) / 2;
    const endX = (c[0] + d[0]) / 2;
    const endZ = (c[1] + d[1]) / 2;
    const length = Math.hypot(endX - startX, endZ - startZ);
    const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const across = [(b[0] - a[0]) / width, (b[1] - a[1]) / width] as const;
    const half = width / 2;
    const t = Math.max(0.5, 1 - (SETTLEMENT_MARGIN_METRES + 2) / length);
    expect(length).toBeGreaterThan(30);
    const onX = startX + (endX - startX) * t;
    const onZ = startZ + (endZ - startZ) * t;
    const on = item('shrub', onX, onZ);
    const beside = item(
      'shrub',
      onX + across[0] * (half + DRIVEWAY_MARGIN_METRES / 2),
      onZ + across[1] * (half + DRIVEWAY_MARGIN_METRES / 2),
    );
    // Past the road end, in the carriageway: nothing else's ground.
    const off = item(
      'shrub',
      endX + ((endX - startX) / length) * (DRIVEWAY_MARGIN_METRES + 3),
      endZ + ((endZ - startZ) / length) * (DRIVEWAY_MARGIN_METRES + 3),
    );
    // Out of reach of the footprint alone: only the driveway's own reach clears it.
    const bare = mappedBuildingsOf(
      plans.map((each) => ({ ...each, driveway: new Float32Array(0) })),
    );
    const footprintReach =
      (bare.radii[plans.indexOf(garaged)] as number) + SETTLEMENT_MARGIN_METRES;
    expect(Math.hypot(onX - garaged.centroid.x, onZ - garaged.centroid.z)).toBeGreaterThan(
      footprintReach,
    );
    expect(clearOfMappedBuildings([on, beside, off], indexed)).toStrictEqual([off]);
    // Control: the same plans with no driveway leave the shrubs on it standing.
    expect(clearOfMappedBuildings([on, beside, off], bare)).toStrictEqual([on, beside, off]);
  });

  it('leaves the scenery alone on a ride with no plans', () => {
    const natural = [item('tree-conifer', plan.centroid.x, plan.centroid.z)];
    expect(clearOfMappedBuildings(natural, undefined)).toBe(natural);
    expect(clearOfMappedBuildings(natural, mappedBuildingsOf([]))).toBe(natural);
  });
});

describe('the scene keeps the trees off a mapped footprint — #1549, through sceneFrame', () => {
  // One large footprint on covered land that is no land use at all, so
  // nothing else — #1546's built-up rule, #1534's settlements — clears it.
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const corridor: WorldCorridor = {
    routeId: 'large-footprint',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [],
    buildings: [buildingBeside(profile, origin, [rectangleBeside(1_040, 30, 80, 40)], 6)],
    paths: [],
    streets: [],
  };
  const land = landClassMask(corridor);
  const plans = footprintPlans(corridor, land, profile, origin).plans;
  const mapped = mappedBuildingsOf(plans);
  const start = atStartLine(profile);
  const frame = (settlementsWooded: boolean): SceneFrame =>
    sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(1_000) } },
      worldCorridor: corridor,
      landClass: land,
      mappedBuildings: mapped,
      scatterItems: 2_000,
      settlementsWooded,
    });
  const inside = (scene: SceneFrame): readonly ScatterItem[] =>
    scene.scatter.filter(
      (item) => SETTLEMENT_CLEARED_KINDS.has(item.kind) && onMappedGround(mapped, item.x, item.z),
    );

  it('stands no tree, shrub or rock in it or within the margin', () => {
    expect(plans).toHaveLength(1);
    expect(inside(frame(false))).toStrictEqual([]);
    // THE CONTROL: with the clearing off a tree stands inside the footprint.
    const wooded = inside(frame(true));
    expect(
      wooded.some(
        (item) =>
          item.kind.startsWith('tree') &&
          insideOutline((plans[0] as FootprintPlan).footprint, item.x, item.z),
      ),
    ).toBe(true);
  });

  it('carries the plans on to the renderer with the rider’s chunk and drawn place', () => {
    const scene = frame(false);
    expect(scene.mappedBuildings?.buildings).toBe(mapped);
    expect(scene.mappedBuildings?.chunk).toBe(mappedChunk(1_000));
    const road = drawnRoadFrame(profile, origin, 1_000);
    expect(scene.mappedBuildings?.x).toBeCloseTo(road?.x ?? Number.NaN, 3);
    expect(scene.mappedBuildings?.z).toBeCloseTo(road?.z ?? Number.NaN, 3);
    // A ride with none carries none.
    expect(sceneFrame({ profile, origin, state: start }).mappedBuildings).toBeUndefined();
  });
});

/** Whether `(x, z)` is inside a ring, by the even-odd rule — the test's own. */
function insideOutline(ring: Float32Array, x: number, z: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
