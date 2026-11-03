// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2021: a mapped place of worship gets a steeple — a square tower and a
 * pyramidal spire at the end of its long axis away from its front door (the
 * owner's ruling of 2026-11-03) — where #1791 drew a plain civic block. Held where a rider sees it: the plans
 * `footprintPlans` returns, their `steeple` flag and the `wall` and `roof`
 * vertex floats the belt uploads.
 *
 * #2100 polishes it (the owner's frames of 2026-11-03): the church roofed in
 * slate, the spire shaded as a roof slope, the tower and spire saying how high
 * they stand to the shader's weathering (read through `facade.ts`' twin), and
 * a belfry's band round a taller tower.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature, BuildingType, Landmark } from '@onyourleft/map-features';

import { weatheringAt } from './facade';
import {
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  ROOF_PITCHES_DEGREES,
  STEEPLE,
  STOREY_METRES,
  STYLE_OFFSET,
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

/**
 * The laterals of every vertex of `role` at `along` 1 000 m: how far out from the road each is;
 * only those no higher than `below`, where given.
 */
function lateralsOf(
  plan: FootprintPlan,
  role: 'wall' | 'roof' | 'door',
  below = Number.POSITIVE_INFINITY,
): number[] {
  const floats = plan.triangles[role];
  const out: number[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if ((floats[at + 1] as number) > below) continue;
    out.push(lateralOf(floats[at] as number, floats[at + 2] as number, 1_000));
  }
  return out;
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
  it('gives the typed street’s church a steeple, and its school none — 24 triangles, on the far level too', () => {
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
        // The tower's four sides, and the spire's four faces (#2021); since #2100 the belfry's
        // band, its four sides, underside and top: measured.
        expect(triangles(each, 'wall') - triangles(without, 'wall')).toBe(20);
        expect(triangles(each, 'roof') - triangles(without, 'roof')).toBe(4);
        expect(each.triangleCount - without.triangleCount).toBe(24);
        expect(each.farTriangleCount - without.farTriangleCount).toBe(24);
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

  it('stands its spire above the roof, at the end of the long axis away from the door', () => {
    // 10 m along the road by 24 m deep: its long axis runs away from the road, and its door
    // is on the wall that faces the road.
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
    // At the far end: its front wall, with the door, is 28 m out, the far wall 52 m.
    expect(lateralOf(x, z, 1_000)).toBeCloseTo(52 - side / 2 + STEEPLE.proud, 1);
    // And mirrored across the road, still the far end.
    const mirrored = planOne([rectangleBeside(1_000, -40, 10, 24)], CHURCH);
    const [mx, , mz] = apexOf(mirrored);
    expect(lateralOf(mx, mz, 1_000)).toBeCloseTo(-(52 - side / 2 + STEEPLE.proud), 1);
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
    // A cross: the nave 10 by 30 m, away from the road, its door on the front wall, with
    // transepts, and behind it an apse 4 m wide and 3 m deep, narrower than the 6 m tower.
    const cross = planOne(
      [
        [
          [995, 25],
          [1_005, 25],
          [1_005, 40],
          [1_011, 40],
          [1_011, 46],
          [1_005, 46],
          [1_005, 52],
          [1_002, 52],
          [1_002, 55],
          [998, 55],
          [998, 52],
          [995, 52],
          [995, 46],
          [989, 46],
          [989, 40],
          [995, 40],
        ],
      ],
      CHURCH,
    );
    expect(cross.steeple).toBe(true);
    const [x, , z] = apexOf(cross);
    // On the footprint, farther from the door than its middle: stepped in a metre at a time
    // off the apse (its back at 55 m, the tower 6 m a side) onto the nave, 3 m in.
    expect(insideFootprint(cross, x, z)).toBe(true);
    expect(lateralOf(x, z, 1_000)).toBeCloseTo(55 - 3 + STEEPLE.proud - 3 * STEEPLE.step, 1);
    // A 6 by 5 m chapel has no room for a tower beside a nave.
    expect(
      planOne([rectangleBeside(1_000, 30, 6, 5)], { type: 'chapel', landmark: null }).steeple,
    ).toBe(false);
  });

  it('keeps the church’s door on its own wall, clear of the tower, and ends the eaves inside the tower', () => {
    const at = [rectangleBeside(1_000, 40, 10, 24)];
    const plan = planOne(at, CHURCH);
    const bare = planOne(at, CHURCH, { steeples: false });
    const side = Math.min(STEEPLE.most, Math.max(STEEPLE.least, STEEPLE.share * 10));
    // The door is on the wall facing the road, 28 m out, exactly where it is without a steeple.
    const door = lateralsOf(plan, 'door');
    expect(door.length).toBeGreaterThan(0);
    expect(plan.triangles.door).toEqual(bare.triangles.door);
    for (const lateral of door) expect(Math.abs(lateral - 28)).toBeLessThan(0.1);
    // Nothing of the walls stands proud of the door's wall: no tower across it.
    expect(Math.min(...lateralsOf(plan, 'wall'))).toBeCloseTo(28, 2);
    // The tower's square stands at the far end, a nave clear of the door's wall.
    const [x, , z] = apexOf(plan);
    const near = lateralOf(x, z, 1_000) - side / 2;
    expect(near).toBeGreaterThanOrEqual(28 + STEEPLE.nave * side - 1e-6);
    // Its far face stands `proud` out past the far wall, and no eave sticks out through it.
    // (#2100: below the belfry's band, which stands its own `proud` out from the tower.)
    const bandFoot = apexOf(plan)[1] - STEEPLE.spire * side - STEEPLE.band.height;
    const face = Math.max(...lateralsOf(plan, 'wall', bandFoot - 0.05));
    expect(face).toBeCloseTo(52 + STEEPLE.proud, 2);
    expect(Math.max(...lateralsOf(plan, 'wall'))).toBeCloseTo(
      52 + STEEPLE.proud + STEEPLE.band.proud,
      2,
    );
    expect(Math.max(...lateralsOf(plan, 'roof'))).toBeLessThanOrEqual(face + 1e-6);
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

/** Where each of `role`'s vertices starts in the plan's floats, higher than `above`. */
function verticesAbove(plan: FootprintPlan, role: 'wall' | 'roof', above: number): number[] {
  const floats = plan.triangles[role];
  const out: number[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if ((floats[at + 1] as number) > above) out.push(at);
  }
  return out;
}

/**
 * How high a vertex says it stands, metres, as the shader reads its facade
 * (`three-renderer.ts` §`facadeFragmentGlsl`'s `oylUp`): `v` in storeys on a
 * plain or windowed face of photograph or clapboard, in metres otherwise.
 */
function shaderUp(floats: Float32Array, at: number): number {
  const v = floats[at + FACADE_OFFSET + 1] as number;
  const top = floats[at + FACADE_OFFSET + 2] as number;
  const kind = Math.floor((floats[at + STYLE_OFFSET] as number) + 0.0001);
  return top >= -0.5 && kind < 1.5 ? v * STOREY_METRES : v;
}

/**
 * What #1661's splash grime leaves of the light at a height `up`, on the oldest building.
 * It models the splash term only, not the shader's upright gate (`oylUpFacing < 0.3`), so
 * it is stricter than the shader: an inexact twin, not an exact one.
 */
const splashLight = (up: number): number =>
  weatheringAt({ effect: 'splash', up }, { plane: [0, 0], age: 1 }).light;

describe('#2100: the steeple polished — its spire a roof, its tower a tower', () => {
  // 20 by 30 m, past the gable's area: a flat roof behind its parapet.
  const flatAt = [rectangleBeside(1_000, 50, 20, 30)];
  // 10 by 24 m: a civic block's low hip.
  const hipAt = [rectangleBeside(1_000, 40, 10, 24)];

  /** The spire's vertices: the roof's above where the same roof stops without the steeple. */
  const spireOf = (at: typeof hipAt): { plan: FootprintPlan; spire: number[] } => {
    const plan = planOne(at, CHURCH);
    const roofTop = apexOf(planOne(at, CHURCH, { steeples: false }))[1];
    return { plan, spire: verticesAbove(plan, 'roof', roofTop + STEEPLE.above - 0.05) };
  };

  it('roofs a church with a steeple in slate, flat or hipped, so its spire is never gravel', () => {
    const flat = planOne(flatAt, CHURCH);
    expect(flat.steeple).toBe(true);
    expect(flat.roof).toBe('flat');
    expect(flat.surfaces.roof).toBe('slate');
    // Without its steeple the same church's flat roof is the gravel it always was.
    expect(planOne(flatAt, CHURCH, { steeples: false }).surfaces.roof).toBe('flat-roof');
    // A pitched church whose roof, steeple-less, is the seeded tile: the steeple turns it slate.
    let tiled: typeof hipAt | undefined;
    for (let along = 40; along < 400 && tiled === undefined; along += 10) {
      const at = [rectangleBeside(1_000, along, 10, 24)];
      const bare = planOne(at, CHURCH, { steeples: false });
      if (bare.roof !== 'flat' && bare.surfaces.roof === 'roof-tiles') tiled = at;
    }
    expect(tiled).toBeDefined();
    const hipped = planOne(tiled as typeof hipAt, CHURCH);
    expect(hipped.steeple).toBe(true);
    expect(hipped.roof).not.toBe('flat');
    expect(hipped.surfaces.roof).toBe('slate');
  });

  it('closes the belfry band on top, so no slit shows between the spire and the band', () => {
    const plan = planOne(hipAt, CHURCH);
    const roofTop = apexOf(planOne(hipAt, CHURCH, { steeples: false }))[1];
    const walls = plan.triangles.wall;
    const caps = verticesAbove(plan, 'wall', roofTop).filter(
      (at) => (walls[at + 4] as number) > 0.99,
    );
    // Two triangles, three corners each.
    expect(caps).toHaveLength(6);
  });

  it('shades every face of the spire as a roof slope at the steepest pitch the town builds', () => {
    expect(STEEPLE.lit).toBe(Math.max(...ROOF_PITCHES_DEGREES));
    const lit = (STEEPLE.lit * Math.PI) / 180;
    for (const at of [flatAt, hipAt]) {
      const { plan, spire } = spireOf(at);
      // Four faces, three corners each.
      expect(spire).toHaveLength(12);
      const floats = plan.triangles.roof;
      const [ax, , az] = apexOf(plan);
      for (let face = 0; face < spire.length; face += 3) {
        const corners = spire.slice(face, face + 3);
        const first = corners[0] as number;
        const nx = floats[first + 3] as number;
        const ny = floats[first + 4] as number;
        const nz = floats[first + 5] as number;
        expect(ny).toBeCloseTo(Math.cos(lit), 5);
        expect(Math.hypot(nx, nz)).toBeCloseTo(Math.sin(lit), 5);
        // Facing out from the tower's middle, toward the face's own foot.
        let ox = 0;
        let oz = 0;
        for (const corner of corners) {
          ox += (floats[corner] as number) - ax;
          oz += (floats[corner + 2] as number) - az;
        }
        expect(nx * ox + nz * oz).toBeGreaterThan(0);
      }
    }
  });

  it('says how high each face of the tower and spire stands: grimed at its foot, nowhere above the roof', () => {
    const plan = planOne(hipAt, CHURCH);
    const roofTop = apexOf(planOne(hipAt, CHURCH, { steeples: false }))[1];
    const walls = plan.triangles.wall;
    // The walls' floor: the lowest of them but the tower, the one wall that starts at the plinth's foot.
    let floor = Number.POSITIVE_INFINITY;
    let foot = 0;
    for (let at = 0; at < walls.length; at += FOOTPRINT_VERTEX_FLOATS) {
      const y = walls[at + 1] as number;
      if (Math.abs(y - plan.base) < 1e-3) {
        foot += 1;
        expect(splashLight(shaderUp(walls, at))).toBeLessThan(1);
      } else {
        floor = Math.min(floor, y);
      }
    }
    expect(foot).toBeGreaterThan(0);
    // Above the roof, the tower and its band: their height over the floor, as a wall's is.
    const high = verticesAbove(plan, 'wall', roofTop);
    expect(high.length).toBeGreaterThan(0);
    for (const at of high) {
      expect(shaderUp(walls, at)).toBeCloseTo((walls[at + 1] as number) - floor, 2);
      expect(splashLight(shaderUp(walls, at))).toBe(1);
    }
    const { spire } = spireOf(hipAt);
    const roofs = plan.triangles.roof;
    for (const at of spire) {
      expect(shaderUp(roofs, at)).toBeGreaterThan(STEEPLE.above);
      expect(splashLight(shaderUp(roofs, at))).toBe(1);
    }
  });

  it('rings the tower’s top with the belfry’s band, under the spire', () => {
    const plan = planOne(hipAt, CHURCH);
    const roofTop = apexOf(planOne(hipAt, CHURCH, { steeples: false }))[1];
    const [ax, , az] = apexOf(plan);
    const walls = plan.triangles.wall;
    // On this north road the tower is square to x and z: each vertex's reach from its middle.
    const above = verticesAbove(plan, 'wall', roofTop).map((at) => ({
      reach: Math.max(
        Math.abs((walls[at] as number) - ax),
        Math.abs((walls[at + 2] as number) - az),
      ),
      y: walls[at + 1] as number,
    }));
    const tower = Math.min(...above.map((each) => each.reach));
    const band = above.filter((each) => each.reach > tower + 0.01);
    expect(band.length).toBeGreaterThan(0);
    for (const each of band) expect(each.reach).toBeCloseTo(tower + STEEPLE.band.proud, 3);
    // From the spire's foot, the tower's top, down its height.
    const top = Math.max(...above.map((each) => each.y));
    const heights = band.map((each) => each.y);
    expect(Math.max(...heights)).toBeCloseTo(top, 3);
    expect(Math.min(...heights)).toBeCloseTo(top - STEEPLE.band.height, 3);
    // And more of the tower over the roof than #2021 stood: `above`, now 6 m.
    expect(top - roofTop).toBeCloseTo(STEEPLE.above, 1);
    expect(STEEPLE.above).toBe(6);
  });
});
