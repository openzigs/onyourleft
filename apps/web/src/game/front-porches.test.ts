// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1589: front porches — on a mapped house's plan (`footprint-buildings.ts`)
 * and on #1550's lots (`buildings.ts`, `settlements.ts`, and the renderer
 * that folds a farmhouse's porch away but on a lot that has one). Each rule
 * where it is decided, read back through the plan's triangles, a lot's
 * scatter item and the structure materials a ride draws with, and each with
 * its control where one can be made.
 *
 * The towns are arithmetic in local metres beside routes from
 * `route-fixtures-testing.ts`: nothing here is a real place.
 */

import { describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import {
  LOT_CLAD_STEP,
  LOT_PORCH_STEP,
  lotClad,
  lotPaint,
  lotPaintChannel,
  lotPaintEntry,
  lotPorch,
} from './building-paint';
import { BUILDING_VARIANTS, buildingPlan, LOT_PORCH, LOT_PORCH_FRONT_METRES } from './buildings';
import { FACADE_AO, facadePartAt, RAILING, railingCover } from './facade';
import {
  CLAD_PHOTOGRAPH,
  EAVES_OVERHANG_METRES,
  FACADE_DOOR,
  FACADE_GARAGE,
  FACADE_OFFSET,
  FACADE_RAILING,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_VERTEX_FLOATS,
  FOOTPRINT_ROLES,
  footprintPlans,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_VERTICES,
  frontPorchOf,
  GUTTER,
  PORCH_ROLES,
  porchWallTopOf,
  ROOF_ROLES,
  STYLE_OFFSET,
  STYLE_SASH,
  type FootprintPlan,
  type FootprintRole,
  type PorchSite,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  mixedTownFixture,
  rectangleBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { surfaceOfRole } from './mapped-buildings';
import { FRONT_PORCH, porchPieces, porchTriangles } from './porch';
import { nearestOnRoadSegments, roadSegmentsNear, type BesideTheRoad } from './road-grid';
import { hairpinRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed, type ScatterItem } from './scatter';
import {
  footprintClearance,
  LOT_PORCH_FOOTPRINT,
  LOT_PORCH_VARIANT,
  lotsAt,
  NO_MAPPED_TOWN,
  STRUCTURE_FOOTPRINTS,
} from './settlements';
import { corridorOrigin, type CorridorOrigin } from './terrain';
import {
  foldsLotPorch,
  GROUNDING_METRES,
  groundingShade,
  LOT_PART,
  LOT_PORCH_VERTEX_GLSL,
  RealisticStructureBelts,
  realisticStructureGeometry,
} from './three-renderer';
import type { WorldCorridor } from './world-data/corridor';

/** One vertex of a plan: position, normal, facade and style. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ny: number;
  readonly u: number;
  readonly v: number;
  readonly top: number;
  readonly clad: number;
  readonly flags: number;
  readonly width: number;
  readonly extra: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const f = (k: number): number => floats[at + k] as number;
    out.push({
      x: f(0),
      y: f(1),
      z: f(2),
      ny: f(4),
      u: f(FACADE_OFFSET),
      v: f(FACADE_OFFSET + 1),
      top: f(FACADE_OFFSET + 2),
      clad: f(STYLE_OFFSET),
      flags: f(STYLE_OFFSET + 1),
      width: f(STYLE_OFFSET + 2),
      extra: f(STYLE_OFFSET + 3),
    });
  }
  return out;
}

const trianglesOf = (plan: FootprintPlan, role: FootprintRole): number =>
  plan.triangles[role].length / (3 * FOOTPRINT_VERTEX_FLOATS);

/** How far `(x, z)` is from the drawn road's centreline. */
function fromRoad(profile: RouteProfile, origin: CorridorOrigin, x: number, z: number): number {
  const segments: number[] = [];
  const road = roadSegmentsNear(profile, origin, x, z, 300, segments);
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  nearestOnRoadSegments(road, segments, x, z, beside);
  return beside.distance;
}

/** The floor a plan's front door stands on, or none. */
function floorOf(plan: FootprintPlan): number | undefined {
  const door = verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_DOOR);
  return door.length === 0 ? undefined : Math.min(...door.map((vertex) => vertex.y));
}

/** Whether a plan has #1581's canopy over its door: trim facing up, above the door. */
function hasCanopy(plan: FootprintPlan): boolean {
  const floor = floorOf(plan);
  if (floor === undefined) return false;
  return verticesOf(plan, 'trim').some((vertex) => vertex.ny === 1 && vertex.y > floor + 2);
}

const mixed = mixedTownFixture();
const { plans: town } = footprintPlans(
  mixed.corridor,
  landClassMask(mixed.corridor),
  mixed.profile,
  mixed.origin,
);
const residential = town.filter((plan) =>
  verticesOf(plan, 'wall').some((vertex) => (vertex.flags & STYLE_SASH) !== 0),
);
const fronted = residential.filter((plan) => floorOf(plan) !== undefined);
const porched = town.filter((plan) => plan.porch);

describe('a front porch on a mapped house — #1589, over the mixed town', () => {
  it('stands on about half of the residential houses with a front door, and on no other', () => {
    expect(fronted.length).toBeGreaterThan(60);
    const share = porched.length / fronted.length;
    expect(share).toBeGreaterThanOrEqual(0.4);
    expect(share).toBeLessThanOrEqual(0.6);
    for (const plan of town) {
      for (const role of PORCH_ROLES) expect(trianglesOf(plan, role) > 0).toBe(plan.porch);
      if (plan.porch) expect(fronted.includes(plan)).toBe(true);
    }
  });

  it('replaces the canopy over the door', () => {
    for (const plan of porched) expect(hasCanopy(plan)).toBe(false);
    // Control: houses with no porch keep #1581's canopy, about half of them.
    expect(fronted.filter((plan) => !plan.porch && hasCanopy(plan)).length).toBeGreaterThan(5);
  });

  it('lays its deck at the house’s floor, round the door, and its steps down from it', () => {
    for (const plan of porched) {
      const floor = floorOf(plan) as number;
      const deck = verticesOf(plan, 'porch').filter((vertex) => vertex.ny === 1);
      expect(deck.length).toBe(6);
      for (const vertex of deck) expect(vertex.y).toBeCloseTo(floor, 4);
      // The door's middle is over the deck.
      const door = verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_DOOR);
      const doorX = door.reduce((sum, vertex) => sum + vertex.x, 0) / door.length;
      const doorZ = door.reduce((sum, vertex) => sum + vertex.z, 0) / door.length;
      const xs = deck.map((vertex) => vertex.x);
      const zs = deck.map((vertex) => vertex.z);
      expect(doorX).toBeGreaterThanOrEqual(Math.min(...xs) - 0.05);
      expect(doorX).toBeLessThanOrEqual(Math.max(...xs) + 0.05);
      expect(doorZ).toBeGreaterThanOrEqual(Math.min(...zs) - 0.05);
      expect(doorZ).toBeLessThanOrEqual(Math.max(...zs) + 0.05);
      // Two or three treads, below the floor.
      const treads = new Set(
        verticesOf(plan, 'porch-trim')
          .filter((vertex) => vertex.ny === 1 && vertex.y < floor - 1e-3)
          .map((vertex) => vertex.y.toFixed(4)),
      );
      expect(treads.size).toBeGreaterThanOrEqual(2);
      expect(treads.size).toBeLessThanOrEqual(3);
    }
  });

  it('draws its railing in the shader: a railing face, its length and its height in its style', () => {
    let rails = 0;
    for (const plan of porched) {
      const railing = verticesOf(plan, 'porch').filter((vertex) => vertex.top === FACADE_RAILING);
      expect(railing.length).toBeGreaterThan(0);
      for (const vertex of railing) {
        expect(vertex.clad).toBe(CLAD_PHOTOGRAPH);
        expect(vertex.extra).toBeCloseTo(FRONT_PORCH.railing.height, 5);
        expect(vertex.u).toBeGreaterThanOrEqual(-1e-5);
        expect(vertex.u).toBeLessThanOrEqual(vertex.width + 1e-5);
        expect([0, vertex.extra].some((v) => Math.abs(vertex.v - v) < 1e-5)).toBe(true);
      }
      rails += railing.length / 6;
    }
    expect(rails).toBeGreaterThan(porched.length * 4);
  });

  it('wears the house’s roof on its roof, in the roof’s cladding, and adds no surface', () => {
    for (const plan of porched) {
      const roofClad = verticesOf(plan, 'roof')[0]?.clad;
      for (const vertex of verticesOf(plan, 'porch-roof')) expect(vertex.clad).toBe(roofClad);
      expect(ROOF_ROLES.has('porch-roof')).toBe(true);
      expect(surfaceOfRole(plan, 'porch-roof')).toBe(plan.surfaces.roof);
      expect(surfaceOfRole(plan, 'porch')).toBe(plan.surfaces.wall);
    }
  });

  it('keeps clear of a garage’s driveway', () => {
    const both = porched.filter((plan) => plan.garage);
    expect(both.length).toBeGreaterThan(0);
    for (const plan of both) {
      const ring = plan.driveway;
      for (const role of PORCH_ROLES) {
        for (const vertex of verticesOf(plan, role)) {
          if (vertex.top === FACADE_GARAGE) continue;
          expect(insideQuad(ring, vertex.x, vertex.z)).toBe(false);
        }
      }
    }
  });

  it('counts its porch at the press as the triangles it writes, once, when first read', () => {
    const fresh = footprintPlans(
      mixed.corridor,
      landClassMask(mixed.corridor),
      mixed.profile,
      mixed.origin,
    ).plans.filter((plan) => plan.porch);
    expect(fresh.length).toBe(porched.length);
    for (const plan of fresh) {
      // The count is the press's; the reads below are the first.
      const counted = plan.triangleCount;
      const written = FOOTPRINT_ROLES.reduce((sum, role) => sum + trianglesOf(plan, role), 0);
      expect(written).toBe(counted);
      // The same arrays every read, and the same numbers as another plan of the same footprint.
      for (const role of PORCH_ROLES) expect(plan.triangles[role]).toBe(plan.triangles[role]);
    }
    const again = fresh[0] as FootprintPlan;
    const before = porched.find(
      (plan) => plan.centroid.x === again.centroid.x && plan.centroid.z === again.centroid.z,
    ) as FootprintPlan;
    for (const role of PORCH_ROLES) {
      expect(Array.from(again.triangles[role])).toStrictEqual(Array.from(before.triangles[role]));
    }
  });

  it('is 75 to 100 triangles, all near: the far level is the walls and the roof alone', () => {
    for (const plan of porched) {
      const own = PORCH_ROLES.reduce((sum, role) => sum + trianglesOf(plan, role), 0);
      expect(own).toBeGreaterThanOrEqual(75);
      expect(own).toBeLessThanOrEqual(100);
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBe(trianglesOf(plan, 'wall') + trianglesOf(plan, 'roof'));
    }
    for (const roof of ['shed', 'hip'] as const) {
      const count = porchTriangles(porchPieces({ ...LOT_PORCH, roof }));
      expect(count).toBeGreaterThanOrEqual(75);
      expect(count).toBeLessThanOrEqual(100);
    }
  });
});

/** Whether `(x, z)` is inside a four-cornered ring. */
function insideQuad(ring: Float32Array, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A row of 10 × 8 m two-storey houses on residential land, their fronts
 * `gap` metres past the road's clearance: 60 of them, so the seeded share
 * gives many porches.
 */
function rowAt(
  gap: number,
  shed = false,
): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly plans: readonly FootprintPlan[];
} {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const lateral = ROAD_CLEARANCE_METRES + gap + 4;
  const buildings: BuildingFeature[] = [];
  for (let along = 200; along < 2_600; along += 40) {
    buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, lateral, 10, 8)], 6));
    // A shed across the house's front, a metre and a half before it.
    if (shed) {
      buildings.push(
        buildingBeside(
          profile,
          origin,
          [rectangleBeside(along, lateral - 4 - 1.5 - 1, 12, 2)],
          2.5,
        ),
      );
    }
  }
  const corridor: WorldCorridor = {
    routeId: 'porch-row',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 100, 2_700, -60, 60)],
    buildings,
    paths: [],
    streets: [],
  };
  return {
    profile,
    origin,
    plans: footprintPlans(corridor, landClassMask(corridor), profile, origin).plans,
  };
}

/** How far a plan's centroid is from the road's centreline. */
function fromRoadOf(row: ReturnType<typeof rowAt>, plan: FootprintPlan): number {
  return fromRoad(row.profile, row.origin, plan.centroid.x, plan.centroid.z);
}

/** The nearest any of a plan's porch's vertices comes to the road's centreline. */
function porchFromRoad(row: ReturnType<typeof rowAt>, plan: FootprintPlan): number {
  let least = Number.POSITIVE_INFINITY;
  for (const role of PORCH_ROLES) {
    for (const vertex of verticesOf(plan, role)) {
      least = Math.min(least, fromRoad(row.profile, row.origin, vertex.x, vertex.z));
    }
  }
  return least;
}

describe('a front porch keeps #1540’s road clearance — #1589', () => {
  const far = rowAt(8);
  const near = rowAt(2.6);
  const close = rowAt(1.5);

  it('reaches no nearer the road than its clearance, anywhere in the mixed town', () => {
    for (const plan of porched) {
      expect(porchFromRoad({ ...mixed, plans: town }, plan)).toBeGreaterThanOrEqual(
        ROAD_CLEARANCE_METRES - 1e-3,
      );
    }
  });

  it('shortens a porch that would reach the clearance', () => {
    const shortened = near.plans.filter((plan) => plan.porch);
    expect(shortened.length).toBeGreaterThan(10);
    for (const plan of shortened) {
      expect(porchFromRoad(near, plan)).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES - 1e-3);
    }
    // Control: with room, porches reach out further than 2.6 m from their walls.
    const front = ROAD_CLEARANCE_METRES + 8;
    const reaches = far.plans
      .filter((plan) => plan.porch)
      .map((plan) => front - porchFromRoad(far, plan));
    expect(Math.max(...reaches)).toBeGreaterThan(2.6 + 0.1);
  });

  it('drops one that would stand on another building', () => {
    // The row's houses: 10 m along the road; its sheds are 12.
    const houses = (row: ReturnType<typeof rowAt>): FootprintPlan[] =>
      row.plans.filter(
        (plan) => Math.abs(plan.footprint.length - 8) < 1 && fromRoadOf(row, plan) > 12,
      );
    const blocked = rowAt(8, true);
    expect(houses(blocked).length).toBe(60);
    expect(houses(blocked).filter((plan) => plan.porch)).toStrictEqual([]);
    // Control: the same row with nothing in front has porches.
    expect(houses(far).filter((plan) => plan.porch).length).toBeGreaterThan(10);
  });

  it('drops one that would reach it even at its least depth', () => {
    expect(close.plans.length).toBe(60);
    expect(close.plans.filter((plan) => plan.porch)).toStrictEqual([]);
    // Control: the same row, a metre further back, has porches.
    expect(near.plans.filter((plan) => plan.porch).length).toBeGreaterThan(10);
  });

  /** A porch site on a straight 12 m front, its own ring tested against a reach from the wall. */
  const site = (reach: number, extra: Partial<PorchSite> = {}): PorchSite => ({
    length: 12,
    floor: 0.5,
    wallTop: 3.3,
    groundAt: () => 0,
    lowest: 0,
    clear: (corners) => Math.max(...corners.map(([, n]) => n)) <= reach,
    ...extra,
  });
  const draws = { width: 0.5, depth: 1, posts: 0, side: 0, roof: 1 };

  it('decides the depth, shortened a step at a time, from the seeded depth down to the least', () => {
    const full = frontPorchOf(site(10), draws);
    expect(full?.depth).toBeCloseTo(FRONT_PORCH.depth.most, 9);
    // Two steps of tread on 0.5 m of rise: the reach is the depth and 0.6 m.
    const shortened = frontPorchOf(site(2.75), draws);
    expect(shortened?.depth).toBeCloseTo(FRONT_PORCH.depth.most - 2 * FRONT_PORCH.shorten, 9);
    expect(frontPorchOf(site(FRONT_PORCH.leastDepth + 0.6 - 0.01), draws)).toBeUndefined();
    expect(frontPorchOf(site(FRONT_PORCH.leastDepth + 0.6 + 0.01), draws)?.depth).toBeCloseTo(
      FRONT_PORCH.leastDepth,
      6,
    );
  });

  it('keeps its deck off a garage’s bay', () => {
    const spec = frontPorchOf(site(10, { garage: { along: 4, width: 4 } }), draws);
    if (spec === undefined) throw new Error('no porch');
    expect(spec.to + FRONT_PORCH.overhang).toBeLessThanOrEqual(4 - 2 + 1e-9);
    // Control: with no garage it runs further to that side.
    const free = frontPorchOf(site(10), draws);
    expect((free?.to ?? 0) + FRONT_PORCH.overhang).toBeGreaterThan(2);
  });

  it('ties its roof under a pitched roof’s gutter, and under the next storey’s floor', () => {
    // A storey up to the eaves: under the gutter's foot; four storeys: under the first floor.
    const eaveY = 3.2 - EAVES_OVERHANG_METRES * Math.tan((25 * Math.PI) / 180);
    expect(porchWallTopOf(0, 3.2, 'gable', 25)).toBeLessThan(eaveY - GUTTER.below - GUTTER.depth);
    expect(porchWallTopOf(0, 12, 'gable', 35)).toBeLessThan(3);
    expect(porchWallTopOf(0, 3.2, 'flat', 0)).toBeLessThan(3.2);
    // And with no headroom left there, no porch.
    expect(frontPorchOf(site(10, { wallTop: 2.4 }), draws)).toBeUndefined();
  });

  it('drops one whose ground is too far below its deck for three steps', () => {
    expect(frontPorchOf(site(10, { groundAt: () => -1 }), draws)).toBeUndefined();
    expect(frontPorchOf(site(10, { groundAt: () => -0.3 }), draws)?.steps).toBe(3);
  });
});

describe('the most a plan can be, with a porch — #1589', () => {
  it('holds flat residential plans of 48 walls, a garage, a long driveway and a porch to 640', () => {
    // A 16 m front 34 m from the road — a driveway near the longest — and a
    // back of 48 zig-zag corners, simplified to the most a plan keeps, so too
    // irregular to pitch: walls, plinth, parapet both ways and a flat roof.
    // Twenty of them, so the seeds give some both a garage and a porch.
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const back = FOOTPRINT_MAX_VERTICES;
    const buildings: BuildingFeature[] = [];
    for (let along = 300; along < 2_700; along += 120) {
      const zig: [number, number][] = [];
      for (let at = 0; at < back; at += 1) {
        zig.push([along + 8 - (16 * at) / (back - 1), at % 2 === 0 ? 52 : 42]);
      }
      buildings.push(
        buildingBeside(profile, origin, [[[along - 8, 34], [along + 8, 34], ...zig]], 3),
      );
    }
    const corridor: WorldCorridor = {
      routeId: 'porch-most',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 200, 2_800, -80, 80)],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    expect(plans).toHaveLength(20);
    for (const plan of plans) {
      expect(plan.footprint.length / 2).toBe(FOOTPRINT_MAX_VERTICES);
      expect(plan.roof).toBe('flat');
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
    const most = plans.filter((plan) => plan.porch && plan.garage);
    expect(most.length).toBeGreaterThan(0);
    expect(Math.max(...most.map((plan) => plan.triangleCount))).toBeGreaterThan(500);
  });
});

describe('its railing, drawn in the facade — #1589, facade.ts', () => {
  const height = FRONT_PORCH.railing.height;
  const style = { flags: 0, width: 3, extra: height };
  const at = (u: number, v: number): string => facadePartAt(u, v, FACADE_RAILING, -1, style);
  const { rail, bottom, spacing, baluster } = FRONT_PORCH.railing;

  it('has a top rail and a bottom rail, a baluster every spacing, and the porch’s shade between', () => {
    expect(at(0.06, height - rail / 2)).toBe('rail');
    expect(at(0.06, (bottom[0] + bottom[1]) / 2)).toBe('rail');
    expect(at(spacing, 0.5)).toBe('baluster');
    expect(at(2 * spacing + baluster / 3, 0.5)).toBe('baluster');
    expect(at(spacing / 2, 0.5)).toBe('gap');
    // Under the bottom rail there is no baluster.
    expect(at(spacing, bottom[0] / 2)).toBe('gap');
    expect(RAILING.gapShade).toBeLessThan(0.5);
    // What it fades to, far off: its rails and a share of its balusters.
    expect(railingCover(height)).toBeGreaterThan(0.3);
    expect(railingCover(height)).toBeLessThan(0.6);
  });
});

describe('a front porch on #1550’s lots — #1589', () => {
  const straight = northRoute(4_000, () => 10);
  const origin = corridorOrigin(straight);
  const corridor: WorldCorridor = {
    routeId: 'lots-porches',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -3_000, maxZ: 5_000 }],
    landUse: [landBeside(straight, origin, 'landuse', 'residential', 200, 3_800, -60, 60)],
    buildings: [],
    paths: [],
    streets: [],
  };
  const land = landClassMask(corridor);
  const lotsOf = (profile: RouteProfile, at: CorridorOrigin, mask = land): ScatterItem[] => {
    const found: ScatterItem[] = [];
    lotsAt(
      profile,
      at,
      scatterSeed(profile),
      0,
      profile.totalDistance,
      mask,
      NO_MAPPED_TOWN,
      found,
    );
    return found;
  };
  const houses = lotsOf(straight, origin).filter((item) => item.kind === 'building');

  it('gives about half of the lot houses a porch — the farmhouse it is built into — and no shop', () => {
    expect(houses.length).toBeGreaterThan(60);
    const withPorch = houses.filter((item) => lotPorch(item.paint));
    const share = withPorch.length / houses.length;
    expect(share).toBeGreaterThanOrEqual(0.4);
    expect(share).toBeLessThanOrEqual(0.6);
    for (const item of houses) {
      const even = ((item.variant % BUILDING_VARIANTS) + BUILDING_VARIANTS) % BUILDING_VARIANTS;
      if (lotPorch(item.paint)) expect(even).toBe(LOT_PORCH_VARIANT);
    }
    // Only the farmhouse has one, and its other variant none.
    expect(buildingPlan('building', LOT_PORCH_VARIANT).triangles.porch.length).toBeGreaterThan(0);
    expect(buildingPlan('building', 1 - LOT_PORCH_VARIANT).triangles.porch).toStrictEqual([]);
    expect(buildingPlan('shop-row', 0).triangles.porch).toStrictEqual([]);
  });

  it('drops a lot’s porch where its reach would come within the road’s clearance', () => {
    const hairpin = hairpinRoute(10);
    const hairpinOrigin = corridorOrigin(hairpin);
    const everywhere = landClassMask({
      ...corridor,
      routeId: 'lots-hairpin',
      origin: hairpinOrigin,
      landUse: [
        {
          layer: 'landuse',
          kind: 'residential',
          rings: [Float32Array.of(-1_500, -1_500, 1_500, -1_500, 1_500, 1_500, -1_500, 1_500)],
        },
      ],
    });
    const lots = lotsOf(hairpin, hairpinOrigin, everywhere).filter(
      (item) => item.kind === 'building',
    );
    const clearance = (item: ScatterItem): number =>
      footprintClearance(hairpin, hairpinOrigin, item, LOT_PORCH_FOOTPRINT);
    for (const item of lots.filter((each) => lotPorch(each.paint))) {
      expect(clearance(item)).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES);
    }
    // Control: some farmhouse there has no porch because its reach would.
    expect(
      lots.filter(
        (item) =>
          item.variant % BUILDING_VARIANTS === LOT_PORCH_VARIANT &&
          !lotPorch(item.paint) &&
          clearance(item) < ROAD_CLEARANCE_METRES,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('reaches no further than the footprint a lot checks for it', () => {
    const plan = buildingPlan('building', LOT_PORCH_VARIANT);
    for (const role of ['porch', 'porch-roof'] as const) {
      const zs = plan.triangles[role].filter((_, at) => at % 3 === 2);
      expect(Math.max(...zs)).toBeLessThanOrEqual(LOT_PORCH_FRONT_METRES + 1e-9);
      expect(Math.max(...zs)).toBeGreaterThan(STRUCTURE_FOOTPRINTS.building.front);
    }
    expect(LOT_PORCH_FOOTPRINT.front).toBeCloseTo(LOT_PORCH_FRONT_METRES, 9);
  });

  it('packs the porch above the cladding, and the cladding and the paint read as before', () => {
    for (let plot = 0; plot < 40; plot += 1) {
      for (const side of [1, -1] as const) {
        const without = lotPaint(7, plot, side, true, false);
        const withPorch = lotPaint(7, plot, side, true, true);
        expect(lotPorch(without)).toBe(false);
        expect(lotPorch(withPorch)).toBe(true);
        for (const channel of ['wall', 'roof'] as const) {
          expect(lotClad(withPorch, channel)).toBe(lotClad(without, channel));
          expect(lotPaintEntry(withPorch, channel)).toBe(lotPaintEntry(without, channel));
        }
        expect(lotPaintChannel(withPorch, 'wall') - lotPaintChannel(without, 'wall')).toBe(
          LOT_PORCH_STEP,
        );
        expect(lotPaintChannel(withPorch, 'roof')).toBe(lotPaintChannel(without, 'roof'));
      }
    }
    expect(LOT_PORCH_STEP).toBe(2 * LOT_CLAD_STEP);
    // An unpainted item — a village house — has none.
    expect(lotPorch(undefined)).toBe(false);
  });

  it('tags the farmhouse’s porch, and shades its ceiling and its deck as a mapped porch’s', () => {
    for (const surface of ['planks', 'roof-tiles'] as const) {
      const geometry = realisticStructureGeometry('building', surface, LOT_PORCH_VARIANT);
      if (geometry === undefined) throw new Error(`a house has no ${surface}`);
      const parts = geometry.getAttribute('oylPart').array as Float32Array;
      expect(parts.includes(LOT_PART.porch)).toBe(true);
      if (surface === 'planks') {
        const colour = geometry.getAttribute('color').array as Float32Array;
        const normal = geometry.getAttribute('normal');
        const position = geometry.getAttribute('position');
        let ceilings = 0;
        let decks = 0;
        for (let at = 0; at < parts.length; at += 1) {
          if (parts[at] !== LOT_PART.porch) continue;
          const ny = normal.getY(at);
          // Above the grounding band, the colour is the shade alone.
          const y = position.getY(at);
          if (ny > 0.5 && Math.abs(y - LOT_PORCH.floor) < 1e-6) {
            expect(colour[at * 3]).toBeCloseTo(groundingShade(y) * FACADE_AO.porchFloor, 5);
            decks += 1;
            continue;
          }
          if (y < GROUNDING_METRES) continue;
          if (ny < -0.5) {
            expect(colour[at * 3]).toBeCloseTo(FACADE_AO.soffit, 5);
            ceilings += 1;
          }
        }
        expect(ceilings).toBeGreaterThan(0);
        expect(decks).toBeGreaterThan(0);
      }
      geometry.dispose();
    }
    const other = realisticStructureGeometry('building', 'planks', 1 - LOT_PORCH_VARIANT);
    expect(
      Array.from(other?.getAttribute('oylPart').array as Float32Array).includes(LOT_PART.porch),
    ).toBe(false);
    other?.dispose();
  });

  it('folds the porch away in every structure material but on a lot that has one', () => {
    const lot = houses.find((item) => lotPorch(item.paint)) as ScatterItem;
    const belts = new RealisticStructureBelts(new Map());
    belts.update([{ ...lot, x: 0, y: 0, z: 20, rotation: 0, variant: LOT_PORCH_VARIANT }], {
      x: 0,
      y: 0,
      z: 0,
      headingX: 0,
      headingZ: 1,
      eyeRoadY: 0,
    } as never);
    let taught = 0;
    for (const surface of ['brick', 'planks', 'roof-tiles', 'glass'] as const) {
      const mesh = belts.beltOf(surface)?.meshesOf('building')[0];
      if (mesh === undefined) throw new Error(`a house has no ${surface} mesh`);
      // The lot's wall channel carries its porch, on every belt it is drawn by.
      const code = (mesh.instanceColor?.array[0] as number) - 1;
      expect(Math.floor(code / LOT_PORCH_STEP) % 2).toBe(1);
      const material = mesh.material as never;
      expect(foldsLotPorch(material)).toBe(true);
      const shader = {
        uniforms: {},
        vertexShader:
          '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
        fragmentShader:
          '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
      };
      (material as { onBeforeCompile: (s: unknown, r: unknown) => void }).onBeforeCompile(
        shader,
        undefined,
      );
      expect(shader.vertexShader).toContain(LOT_PORCH_VERTEX_GLSL);
      // Declared once, whether or not the lot's paint declared it first.
      expect(shader.vertexShader.split('attribute float oylPart;').length - 1).toBe(1);
      // After `begin_vertex`, which declares what it folds.
      expect(shader.vertexShader.indexOf(LOT_PORCH_VERTEX_GLSL)).toBeGreaterThan(
        shader.vertexShader.indexOf('#include <begin_vertex>'),
      );
      taught += 1;
    }
    expect(taught).toBe(4);
    expect(LOT_PORCH_VERTEX_GLSL).toContain(`/ ${String(LOT_PORCH_STEP)}) % 2 == 1`);
    expect(LOT_PORCH_VERTEX_GLSL).toContain('transformed = vec3(0.0);');
    belts.dispose();
  });
});
