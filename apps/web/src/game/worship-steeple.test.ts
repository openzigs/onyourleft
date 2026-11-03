// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2021: a mapped place of worship gets a steeple — a square tower and a
 * pyramidal spire at the end of its long axis that faces the street — where
 * #1791 drew a plain civic block. Held where a rider sees it: the plans
 * `footprintPlans` returns, their `steeple` flag and the `wall` and `roof`
 * vertex floats the belt uploads.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature, BuildingType, Landmark } from '@onyourleft/map-features';

import {
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  STEEPLE,
  type FootprintPlan,
  type FootprintPlanOptions,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  planFingerprint,
  polygonBeside,
  rectangleBeside,
  typedStreetFixture,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);

/** One footprint of `(along, lateral)` rings, mapped as `type` and `landmark`, planned alone. */
function planOne(
  rings: readonly (readonly (readonly [number, number])[])[],
  mapped: { readonly type: BuildingType | null; readonly landmark: Landmark | null },
  options: FootprintPlanOptions = {},
  height = 6,
  part?: { readonly minHeightMetres: number },
): FootprintPlan {
  const building: BuildingFeature = {
    ...buildingBeside(profile, origin, rings, height, part),
    buildingType: mapped.type,
    landmark: mapped.landmark,
  };
  const corridor: WorldCorridor = {
    routeId: 'worship',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 900, 1_200, -80, 80)],
    buildings: [building],
    paths: [],
    streets: [],
  };
  const { plans } = footprintPlans(
    corridor,
    landClassMask(corridor),
    profile,
    origin,
    undefined,
    undefined,
    options,
  );
  expect(plans).toHaveLength(1);
  return plans[0] as FootprintPlan;
}

const CHURCH = { type: 'church', landmark: 'worship' } as const;

const triangles = (plan: FootprintPlan, role: 'wall' | 'roof'): number =>
  plan.triangles[role].length / (3 * FOOTPRINT_VERTEX_FLOATS);

/** The highest vertex of the plan's roof — a steeple's apex, where it has one. */
function apexOf(plan: FootprintPlan): readonly [x: number, y: number, z: number] {
  const floats = plan.triangles.roof;
  let best: [number, number, number] = [0, Number.NEGATIVE_INFINITY, 0];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const y = floats[at + 1] as number;
    if (y > best[1]) best = [floats[at] as number, y, floats[at + 2] as number];
  }
  return best;
}

/** How far `(x, z)` stands out from the drawn road at `along`, metres. */
function lateralOf(x: number, z: number, along: number): number {
  const frame = drawnRoadFrame(profile, origin, along);
  if (frame === undefined) throw new Error('no road there');
  return (x - frame.x) * frame.normalX + (z - frame.z) * frame.normalZ;
}

/** The nearest any vertex of `role` comes to the road at `along`, metres out: the lowest lateral. */
function nearestToRoad(plan: FootprintPlan, role: 'wall' | 'roof' | 'door'): number {
  const floats = plan.triangles[role];
  let nearest = Number.POSITIVE_INFINITY;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    nearest = Math.min(nearest, lateralOf(floats[at] as number, floats[at + 2] as number, 1_000));
  }
  return nearest;
}

/** Whether `(x, z)` stands inside a plan's drawn footprint. */
function insideFootprint(plan: FootprintPlan, x: number, z: number): boolean {
  const ring = plan.footprint;
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

describe('#2021: a mapped place of worship’s steeple, read back from the plan', () => {
  it('gives the typed street’s church a steeple, and its school none — 12 triangles, on the far level too', () => {
    const street = typedStreetFixture();
    const land = landClassMask(street.corridor);
    const plan = (options: FootprintPlanOptions): readonly FootprintPlan[] =>
      footprintPlans(
        street.corridor,
        land,
        street.profile,
        street.origin,
        undefined,
        urbanClassMap(street.corridor, land, street.profile),
        options,
      ).plans;
    const on = plan({});
    const off = plan({ steeples: false });
    let churches = 0;
    on.forEach((each, index) => {
      const row = street.rows[index];
      const without = off[index] as FootprintPlan;
      if (row === 'church') {
        churches += 1;
        expect(each.steeple).toBe(true);
        // The tower's four sides, and the spire's four faces: measured.
        expect(triangles(each, 'wall') - triangles(without, 'wall')).toBe(8);
        expect(triangles(each, 'roof') - triangles(without, 'roof')).toBe(4);
        expect(each.triangleCount - without.triangleCount).toBe(12);
        expect(each.farTriangleCount - without.farTriangleCount).toBe(12);
        expect(each.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
        expect(each.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      } else {
        // Every other plan, the school among them, is as it was.
        expect(each.steeple).toBe(false);
        expect(planFingerprint([each])).toBe(planFingerprint([without]));
      }
    });
    expect(churches).toBe(2);
  });

  it('stands its spire above the roof, at the end of the long axis that faces the street', () => {
    // 10 m along the road by 24 m deep: its long axis runs away from the road.
    const plan = planOne([rectangleBeside(1_000, 40, 10, 24)], CHURCH);
    expect(plan.steeple).toBe(true);
    const [x, y, z] = apexOf(plan);
    const side = Math.min(STEEPLE.most, Math.max(STEEPLE.least, STEEPLE.share * 10));
    // Its tower `above` the ridge — the top of the same roof without it — under its spire.
    const ridge = apexOf(
      planOne([rectangleBeside(1_000, 40, 10, 24)], CHURCH, { steeples: false }),
    );
    expect(ridge[1]).toBeGreaterThan(plan.eaves + 1);
    expect(y).toBeCloseTo(ridge[1] + STEEPLE.above + STEEPLE.spire * side, 1);
    // At the street's end: its front wall is 28 m out, the far wall 52 m.
    expect(lateralOf(x, z, 1_000)).toBeCloseTo(28 + side / 2 - STEEPLE.proud, 1);
    // And mirrored across the road, still the street's end.
    const mirrored = planOne([rectangleBeside(1_000, -40, 10, 24)], CHURCH);
    const [mx, , mz] = apexOf(mirrored);
    expect(lateralOf(mx, mz, 1_000)).toBeCloseTo(-(28 + side / 2 - STEEPLE.proud), 1);
  });

  it('stands it at one end of the long axis where the street cannot tell the two apart', () => {
    // 24 m along the road by 10 m deep: both ends are as far from the road.
    const plan = planOne([rectangleBeside(1_000, 40, 24, 10)], CHURCH);
    expect(plan.steeple).toBe(true);
    const [x, , z] = apexOf(plan);
    const frame = drawnRoadFrame(profile, origin, 1_000);
    if (frame === undefined) throw new Error('no road there');
    const along = (x - frame.x) * frame.normalZ - (z - frame.z) * frame.normalX;
    const side = Math.min(STEEPLE.most, Math.max(STEEPLE.least, STEEPLE.share * 10));
    expect(Math.abs(Math.abs(along) - (12 - side / 2 + STEEPLE.proud))).toBeLessThan(0.05);
    expect(lateralOf(x, z, 1_000)).toBeCloseTo(40, 1);
  });

  it('steps a steeple inward to stand on a notched end, and leaves none off a footprint too small', () => {
    // A cross: the nave 10 by 30 m, away from the road, with transepts, and before it a
    // porch 4 m wide and 3 m deep, narrower than the 6 m tower.
    const cross = planOne(
      [
        [
          [998, 25],
          [1_002, 25],
          [1_002, 28],
          [1_005, 28],
          [1_005, 40],
          [1_011, 40],
          [1_011, 46],
          [1_005, 46],
          [1_005, 55],
          [995, 55],
          [995, 46],
          [989, 46],
          [989, 40],
          [995, 40],
          [995, 28],
          [998, 28],
        ],
      ],
      CHURCH,
    );
    expect(cross.steeple).toBe(true);
    const [x, , z] = apexOf(cross);
    // On the footprint, nearer the street than its middle: stepped back a metre at a time
    // off the porch (its front at 25 m, the tower 6 m a side) onto the nave, 3 m in.
    expect(insideFootprint(cross, x, z)).toBe(true);
    expect(lateralOf(x, z, 1_000)).toBeCloseTo(25 + 3 - STEEPLE.proud + 3 * STEEPLE.step, 1);
    // A 6 by 5 m chapel has no room for a tower beside a nave.
    expect(
      planOne([rectangleBeside(1_000, 30, 6, 5)], { type: 'chapel', landmark: null }).steeple,
    ).toBe(false);
  });

  it('shows the front door on the tower’s face, and ends the roof’s eaves inside the tower', () => {
    const at = [rectangleBeside(1_000, 40, 10, 24)];
    const plan = planOne(at, CHURCH);
    const bare = planOne(at, CHURCH, { steeples: false });
    // The tower's face stands `proud` out past the front wall, 28 m out from the road.
    const face = nearestToRoad(plan, 'wall');
    expect(face).toBeCloseTo(28 - STEEPLE.proud, 2);
    // The door is on that face, not behind it — and still on the wall where there is no steeple.
    expect(nearestToRoad(plan, 'door')).toBeLessThan(face);
    expect(nearestToRoad(plan, 'door')).toBeGreaterThan(face - 0.1);
    expect(nearestToRoad(bare, 'door')).toBeGreaterThan(27.9);
    // No eave of the roof sticks out through the tower's face.
    expect(nearestToRoad(plan, 'roof')).toBeGreaterThanOrEqual(face - 1e-6);
  });

  it('gives a building part no steeple', () => {
    const at = [rectangleBeside(1_000, 40, 10, 24)];
    expect(planOne(at, CHURCH, {}, 12, { minHeightMetres: 6 }).steeple).toBe(false);
  });

  it('reads a place of worship from its landmark or its type, and nothing else', () => {
    const at = [rectangleBeside(1_000, 40, 10, 24)];
    expect(planOne(at, { type: null, landmark: 'worship' }).steeple).toBe(true);
    expect(planOne(at, { type: 'chapel', landmark: null }).steeple).toBe(true);
    expect(planOne(at, { type: 'cathedral', landmark: null }).steeple).toBe(true);
    for (const mapped of [
      { type: 'school', landmark: 'school' },
      { type: 'townhall', landmark: 'townhall' },
      { type: 'civic', landmark: null },
      { type: 'house', landmark: null },
      { type: null, landmark: null },
    ] as const) {
      expect(planOne(at, mapped).steeple, `${String(mapped.type)}`).toBe(false);
    }
  });

  it('leaves the steeple off before a courtyard’s holes, where both would pass the caps', () => {
    // A round church of 48 sides with six small courts, its far level near its cap.
    const spots = [
      [-8, -8],
      [0, -8],
      [8, -8],
      [-8, 0],
      [0, 0],
      [8, 0],
    ] as const;
    const rings = [
      polygonBeside(1_000, 40, 20, 48),
      ...spots.map(([a, n], index) => polygonBeside(1_000 + a, 40 + n, 2.5, index < 1 ? 6 : 8)),
    ];
    const holed = planOne(rings, CHURCH);
    expect(holed.steeple).toBe(false);
    expect(holed.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    // Its courts kept: more than the plan without them.
    const solid = planOne([rings[0] as (typeof rings)[number]], CHURCH);
    expect(holed.farTriangleCount).toBeGreaterThan(solid.farTriangleCount);
    // Control: without its courts there is room, and it has one.
    expect(solid.steeple).toBe(true);
  });

  it('keeps the steeple where the courts must go anyway', () => {
    // Six larger courts: over the far cap with or without a steeple, so they go and it stays.
    const spots = [
      [-8, -8],
      [0, -8],
      [8, -8],
      [-8, 0],
      [0, 0],
      [8, 0],
    ] as const;
    const outer = polygonBeside(1_000, 40, 20, 48);
    const rings = [outer, ...spots.map(([a, n]) => polygonBeside(1_000 + a, 40 + n, 2.5, 8))];
    const plan = planOne(rings, CHURCH);
    const solid = planOne([outer], CHURCH);
    expect(plan.farTriangleCount).toBe(solid.farTriangleCount);
    expect(plan.steeple).toBe(true);
  });
});

describe('#2021: the lever', () => {
  it('plans every place of worship as #1791’s plain civic block with `steeples: false`', () => {
    const at = [rectangleBeside(1_000, 40, 10, 24)];
    const off = planOne(at, CHURCH, { steeples: false });
    expect(off.steeple).toBe(false);
    // Not vacuous: on, it has one, and plans otherwise.
    const on = planOne(at, CHURCH);
    expect(on.steeple).toBe(true);
    expect(planFingerprint([on])).not.toBe(planFingerprint([off]));
  });

  it('gives none while the type is not read (`buildingTypes: false`)', () => {
    const at = [rectangleBeside(1_000, 40, 10, 24)];
    expect(planOne(at, CHURCH, { buildingTypes: false }).steeple).toBe(false);
  });
});
