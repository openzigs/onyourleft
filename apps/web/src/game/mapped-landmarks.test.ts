// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1794: a mapped place of worship whose footprint holds one is drawn as a
 * church — a nave under a steep gable with #2021's tower and spire, the
 * spire's top by `mapped-landmarks.ts`' height rule. Held where a rider sees
 * it: the plans `footprintPlans` returns over #1794's street of churches
 * (`footprint-fixtures-testing.ts` §`churchStreetFixture`) and the `wall`,
 * `roof` and `door` vertex floats the belt uploads.
 */

import { describe, expect, it } from 'vitest';

import { FOUNDATION_METRES } from './buildings';
import {
  FACADE_DOOR,
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  STEEPLE,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  CHURCH_FOOTPRINTS,
  churchStreetFixture,
  mixedTownFixture,
  planFingerprint,
  polygonBeside,
  rectangleBeside,
  type ChurchFootprint,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { CHURCH, churchFits, spireApexOf, spireIsMapped } from './mapped-landmarks';
import { drawnRoadFrame } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

const street = churchStreetFixture();

/** The street of churches planned with its urban class, by each footprint's name. */
function planStreet(
  options: FootprintPlanOptions = {},
): Map<ChurchFootprint['name'], FootprintPlan> {
  const land = landClassMask(street.corridor);
  const { plans } = footprintPlans(
    street.corridor,
    land,
    street.profile,
    street.origin,
    undefined,
    urbanClassMap(street.corridor, land, street.profile),
    options,
  );
  expect(plans).toHaveLength(CHURCH_FOOTPRINTS.length);
  return new Map(plans.map((plan, index) => [street.rows[index]?.[0] ?? 'rectangle', plan]));
}

const churches = planStreet();
const before = planStreet({ landmarkChurches: false });
const NAVES = ['rectangle', 'ell', 'cross', 'tall', 'wide'] as const;
const NOT_NAVES = ['chapel', 'notched'] as const;

/** One vertex of a role, as the belt uploads it. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ny: number;
  readonly top: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      x: floats[at] as number,
      y: floats[at + 1] as number,
      z: floats[at + 2] as number,
      ny: floats[at + 4] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
    });
  }
  return out;
}

/** The tower's top: the highest wall vertex, which only the tower reaches. */
const towerTopOf = (plan: FootprintPlan): number =>
  Math.max(...verticesOf(plan, 'wall').map((vertex) => vertex.y));

/** The spire's apex: the plan's highest roof vertex. */
function apexOf(plan: FootprintPlan): Vertex {
  return verticesOf(plan, 'roof').reduce((best, vertex) => (vertex.y > best.y ? vertex : best));
}

/** The nave's ridge: the highest roof vertex under the tower's top, which the spire stands on. */
const ridgeOf = (plan: FootprintPlan): number =>
  Math.max(
    ...verticesOf(plan, 'roof')
      .filter((vertex) => vertex.y < towerTopOf(plan) - 0.01)
      .map((vertex) => vertex.y),
  );

/** The ground the plan stands on: its foot, above its foundation. */
const groundOf = (plan: FootprintPlan): number => plan.base + FOUNDATION_METRES;

/** The steepest pitch, degrees, of the nave's roof faces: those under the tower's top. */
function navePitch(plan: FootprintPlan): number {
  const top = towerTopOf(plan);
  const nave = verticesOf(plan, 'roof').filter(
    (vertex) => vertex.y < top - 0.01 && vertex.ny > 0.05,
  );
  return (Math.acos(Math.min(...nave.map((vertex) => vertex.ny))) * 180) / Math.PI;
}

/** How far `(x, z)` stands outside the plan's drawn ring, metres; nought inside it. */
function outside(plan: FootprintPlan, x: number, z: number): number {
  const ring = plan.footprint;
  const n = ring.length / 2;
  let inside = false;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi;
    const dz = zj - zi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(x - (xi + dx * t), z - (zi + dz * t)));
  }
  return inside ? 0 : nearest;
}

/** How far `(x, z)` stands out from the drawn road, on its normal's side when positive. */
function lateralOf(x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  let lateral = 0;
  // The road is straight here: the nearest of its frames a metre apart is the foot of `(x, z)`.
  for (let along = 950; along <= 1_550; along += 1) {
    const frame = drawnRoadFrame(street.profile, street.origin, along);
    if (frame === undefined) continue;
    const distance = Math.hypot(x - frame.x, z - frame.z);
    if (distance < best) {
      best = distance;
      lateral = (x - frame.x) * frame.normalX + (z - frame.z) * frame.normalZ;
    }
  }
  return lateral;
}

/** The tower's and spire's vertices: every wall and roof vertex above the nave's ridge. */
const steepleVertices = (plan: FootprintPlan): Vertex[] =>
  [...verticesOf(plan, 'wall'), ...verticesOf(plan, 'roof')].filter(
    (vertex) => vertex.y > ridgeOf(plan) + 0.01,
  );

describe('#1794: a church, read back from the plan', () => {
  it('builds a rectangle’s, an L’s and a cross’s nave under a gable of at least 45°', () => {
    for (const name of ['rectangle', 'ell', 'cross'] as const) {
      const plan = churches.get(name) as FootprintPlan;
      expect(plan.roof, name).toBe('gable');
      expect(plan.pitchDegrees, name).toBe(CHURCH.pitchDegrees);
      expect(navePitch(plan), name).toBeGreaterThanOrEqual(44.9);
      expect(plan.steeple, name).toBe(true);
      // The tower over the ridge and the spire's apex the plan's highest vertex.
      expect(towerTopOf(plan), name).toBeCloseTo(ridgeOf(plan) + STEEPLE.above, 3);
      const apex = apexOf(plan);
      for (const role of ['wall', 'trim', 'door', 'parapet'] as const) {
        for (const vertex of verticesOf(plan, role)) expect(vertex.y).toBeLessThan(apex.y);
      }
      // Control: before #1794 the same footprint is #1791's block, no 45° gable.
      expect(before.get(name)?.pitchDegrees, name).not.toBe(CHURCH.pitchDegrees);
    }
  });

  it('stands its tower at the end of the long axis away from its door, as #2021’s ruling put it', () => {
    for (const name of NAVES) {
      const plan = churches.get(name) as FootprintPlan;
      const side = street.rows.find(([row]) => row === name)?.[1] ?? 1;
      const apex = apexOf(plan);
      const doors = verticesOf(plan, 'door');
      const doorOut =
        doors.reduce((sum, vertex) => sum + lateralOf(vertex.x, vertex.z), 0) / doors.length;
      // On its own side of the road, the door's wall toward it and the spire far out behind.
      expect(Math.sign(doorOut), name).toBe(side);
      expect(Math.sign(lateralOf(apex.x, apex.z)), name).toBe(side);
      expect(Math.abs(lateralOf(apex.x, apex.z)), name).toBeGreaterThan(Math.abs(doorOut) + 5);
    }
  });

  it('keeps every tower and spire vertex on the footprint, but its proud face, and off the road', () => {
    for (const name of NAVES) {
      const plan = churches.get(name) as FootprintPlan;
      const steeple = steepleVertices(plan);
      expect(steeple.length, name).toBeGreaterThan(0);
      for (const vertex of steeple) {
        // `STEEPLE.proud` is the eaves' overhang and 0.1 m, so the eaves end inside the tower.
        expect(outside(plan, vertex.x, vertex.z), name).toBeLessThanOrEqual(STEEPLE.proud + 1e-3);
        expect(Math.abs(lateralOf(vertex.x, vertex.z)), name).toBeGreaterThanOrEqual(
          ROAD_CLEARANCE_METRES,
        );
      }
    }
  });

  it('tops the spire at a tall mapped height, which is its spire’s', () => {
    const tall = churches.get('tall') as FootprintPlan;
    const height = CHURCH_FOOTPRINTS.find((each) => each.name === 'tall')?.height ?? 0;
    expect(spireIsMapped(height, CHURCH.storeys * 3)).toBe(true);
    expect(apexOf(tall).y - groundOf(tall)).toBeCloseTo(height, 3);
    // Its nave's walls are `CHURCH.storeys`, not the mapped height's.
    expect(tall.storeys).toBe(CHURCH.storeys);
    expect(tall.surfaces.wall).not.toBe('concrete');
    // Control: before #1794 its walls were the whole mapped height.
    expect(before.get('tall')?.storeys).toBeGreaterThan(CHURCH.storeys * 4);
  });

  it('tops the spire at 1.8 times the ridge where the mapped height is low, and at 40 m at most', () => {
    for (const name of ['rectangle', 'ell', 'cross'] as const) {
      const plan = churches.get(name) as FootprintPlan;
      const ground = groundOf(plan);
      const ruled = ground + CHURCH.ridgeFactor * (ridgeOf(plan) - ground);
      // Not floored by `leastSpire` here: the rule itself clears the tower.
      expect(ruled, name).toBeGreaterThan(towerTopOf(plan) + CHURCH.leastSpire);
      expect(apexOf(plan).y, name).toBeCloseTo(ruled, 3);
    }
    const wide = churches.get('wide') as FootprintPlan;
    expect(CHURCH.ridgeFactor * (ridgeOf(wide) - groundOf(wide))).toBeGreaterThan(CHURCH.highest);
    expect(apexOf(wide).y - groundOf(wide)).toBeCloseTo(CHURCH.highest, 3);
  });

  it('never stands a spire under `leastSpire` over its tower, and reads the rule as written', () => {
    expect(spireApexOf({ ground: 0, ridge: 8, towerTop: 14, mapped: undefined })).toBe(
      14 + CHURCH.leastSpire,
    );
    expect(spireApexOf({ ground: 0, ridge: 12, towerTop: 18, mapped: undefined })).toBeCloseTo(
      21.6,
      9,
    );
    expect(spireApexOf({ ground: 1, ridge: 30, towerTop: 36, mapped: undefined })).toBe(41);
    expect(spireApexOf({ ground: 0, ridge: 12, towerTop: 18, mapped: 35 })).toBe(35);
    expect(spireIsMapped(9.61, 6)).toBe(true);
    expect(spireIsMapped(9.5, 6)).toBe(false);
    expect(spireIsMapped(null, 6)).toBe(false);
  });

  it('keeps a footprint too small or too irregular for a nave as before #1794', () => {
    for (const name of NOT_NAVES) {
      const plan = churches.get(name) as FootprintPlan;
      expect(planFingerprint([plan]), name).toBe(
        planFingerprint([before.get(name) as FootprintPlan]),
      );
      expect(plan.pitchDegrees, name).not.toBe(CHURCH.pitchDegrees);
      // Not vacuous: #2021's tower stands on each, so only the nave's fit keeps it a block.
      expect(plan.steeple, name).toBe(true);
    }
    expect(churchFits({ area: 72, rectangularity: 1, rectilinear: false })).toBe(false);
    expect(churchFits({ area: 200, rectangularity: 0.5, rectilinear: false })).toBe(false);
    expect(churchFits({ area: 200, rectangularity: 0.7, rectilinear: false })).toBe(false);
    expect(churchFits({ area: 200, rectangularity: 0.7, rectilinear: true })).toBe(true);
    expect(churchFits({ area: 80, rectangularity: 0.9, rectilinear: false })).toBe(true);
  });

  it('gives a church no decoration: no front step, and only a plain painted door, which takes no wreath', () => {
    for (const name of NAVES) {
      const plan = churches.get(name) as FootprintPlan;
      expect(plan.frontStep, name).toBeUndefined();
      expect(plan.porch, name).toBe(false);
      const doors = verticesOf(plan, 'door');
      expect(doors.length, name).toBeGreaterThan(0);
      expect(
        doors.some((vertex) => vertex.top === FACADE_DOOR),
        name,
      ).toBe(false);
    }
  });

  it('gives up a church’s courts before its tower, to fit the far cap', () => {
    const nave = rectangleBeside(1_000, 40, 24, 40);
    // Thirty small courts: more wall than the far cap leaves room for beside the nave.
    const courts = Array.from({ length: 30 }, (_, index) =>
      polygonBeside(1_000 - 9 + (index % 5) * 4.5, 40 - 15 + Math.floor(index / 5) * 6, 1.2, 8),
    );
    const plan = (rings: typeof courts, options: FootprintPlanOptions = {}): FootprintPlan => {
      const corridor: WorldCorridor = {
        ...street.corridor,
        buildings: [
          { ...buildingBeside(street.profile, street.origin, rings, 7), buildingType: 'church' },
        ],
      };
      const { plans } = footprintPlans(
        corridor,
        landClassMask(corridor),
        street.profile,
        street.origin,
        undefined,
        undefined,
        options,
      );
      return plans[0] as FootprintPlan;
    };
    const courted = plan([nave, ...courts]);
    const solid = plan([nave]);
    expect(courted.steeple).toBe(true);
    expect(courted.pitchDegrees).toBe(CHURCH.pitchDegrees);
    expect(courted.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    // Its walls and roof are the solid church's: no court is drawn.
    expect(courted.triangles.wall.length).toBe(solid.triangles.wall.length);
    expect(courted.triangles.roof.length).toBe(solid.triangles.roof.length);
    expect(courted.farTriangleCount).toBe(solid.farTriangleCount);
    // Control: six of the courts fit beside the nave, and are drawn, with its tower.
    const few = plan([nave, ...courts.slice(0, 6)]);
    expect(few.steeple).toBe(true);
    expect(few.triangles.wall.length).toBeGreaterThan(solid.triangles.wall.length);
  });

  it('holds every church inside 640 near and 200 far triangles, its steeple on the far level', () => {
    for (const name of NAVES) {
      const plan = churches.get(name) as FootprintPlan;
      expect(plan.triangleCount, name).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount, name).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      // The far level is the walls and the roof, which hold the tower and the spire.
      expect(steepleVertices(plan).length, name).toBeGreaterThan(0);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.wall);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.roof);
    }
  });
});

/**
 * {@link churchStreetFixture}'s plans' fingerprint, paint included, planned with its urban
 * class, measured with `main`'s `footprint-buildings.ts` at 2e4786e4 — before #1794.
 */
const CHURCH_STREET_BEFORE_1794 = '53f71579';

/** {@link mixedTownFixture}'s, likewise: it has no place of worship. */
const MIXED_TOWN_BEFORE_1794 = '2b5b40a1';

describe('#1794: the lever, and a town with no church', () => {
  it('plans every church as before #1794 with `landmarkChurches: false`', () => {
    expect(planFingerprint([...before.values()])).toBe(CHURCH_STREET_BEFORE_1794);
    // Not vacuous: on, the street plans otherwise.
    expect(planFingerprint([...churches.values()])).not.toBe(CHURCH_STREET_BEFORE_1794);
  });

  it('plans the mixed town as before #1794', () => {
    const town = mixedTownFixture();
    const land = landClassMask(town.corridor);
    const { plans } = footprintPlans(
      town.corridor,
      land,
      town.profile,
      town.origin,
      undefined,
      urbanClassMap(town.corridor, land, town.profile),
    );
    expect(planFingerprint(plans)).toBe(MIXED_TOWN_BEFORE_1794);
  });
});
