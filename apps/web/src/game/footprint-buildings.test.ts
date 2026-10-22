// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1540: a mapped building, planned from its footprint — the placement rules,
 * the shape rules and the budget, each asserted on what `footprintPlans`
 * hands back, and each rule with its control: the same call with the rule's
 * input taken away, which must keep what the rule drops.
 */

import { describe, expect, it } from 'vitest';

import { distanceOnRoute, metres, type RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import {
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_ROLES,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERDICTS,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  footprintUse,
  minimumAreaRectangle,
  roofSurfaceOf,
  storeysFor,
  wallSurfaceOf,
  type FootprintPlan,
  type FootprintVerdict,
} from './footprint-buildings';
import {
  FOOTPRINT_FIXTURE_VERDICTS,
  besideRoad,
  buildingBeside,
  denseTownFixture,
  footprintFixture,
  landBeside,
  rectangleBeside,
  starBeside,
  type FootprintFixtureName,
} from './footprint-fixtures-testing';
import { FOUNDATION_METRES } from './buildings';
import { landClassMask, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES, terrainHeightAt } from './landform';
import { REALISTIC_TRIANGLES } from './realistic-budget';
import { nearestOnRoadSegments, roadSegmentsNear, type BesideTheRoad } from './road-grid';
import { hairpinRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadPosition, type CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const fixture = footprintFixture();
const mask = landClassMask(fixture.corridor);

/** One named footprint, planned alone in the fixture's corridor: its plan, or its verdict. */
function planOf(
  name: FootprintFixtureName,
  land: LandClassMask = mask,
): FootprintPlan | FootprintVerdict {
  const { plans, verdicts } = footprintPlans(
    { ...fixture.corridor, buildings: [fixture.named[name]] },
    land,
    fixture.profile,
    fixture.origin,
  );
  return (
    plans[0] ?? (FOOTPRINT_VERDICTS.find((verdict) => verdicts[verdict] > 0) as FootprintVerdict)
  );
}

function planned(name: FootprintFixtureName): FootprintPlan {
  const plan = planOf(name);
  if (typeof plan === 'string') throw new Error(`${name} was not planned: ${plan}`);
  return plan;
}

/** Every vertex of a role's triangles, as `[x, y, z]`. */
function verticesOf(plan: FootprintPlan, role: (typeof FOOTPRINT_ROLES)[number]): number[][] {
  const floats = plan.triangles[role];
  const out: number[][] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push([floats[at] as number, floats[at + 1] as number, floats[at + 2] as number]);
  }
  return out;
}

/** The drawn ground under `(x, z)`, by the stretch of road it is nearest, searched widely. */
function groundUnder(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
  x: number,
  z: number,
): number {
  const segments: number[] = [];
  const road = roadSegmentsNear(profile, origin, x, z, 600, segments);
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  if (!nearestOnRoadSegments(road, segments, x, z, beside)) throw new Error('no road near');
  return terrainHeightAt(profile, origin, scatterSeed(profile), beside.along, beside.lateral, land);
}

/** FNV-1a over every plan, its numbers and its arrays. */
function digestOf(plans: readonly FootprintPlan[]): string {
  let hash = 0x81_1c_9d_c5;
  const mix = (bytes: Uint8Array): void => {
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
    }
  };
  for (const plan of plans) {
    mix(
      new Uint8Array(
        Float64Array.of(
          plan.centroid.x,
          plan.centroid.z,
          plan.base,
          plan.storeys,
          plan.tint,
          plan.triangleCount,
          plan.farTriangleCount,
        ).buffer,
      ),
    );
    mix(new TextEncoder().encode(`${plan.roof} ${plan.surfaces.wall} ${plan.surfaces.roof}`));
    for (const role of FOOTPRINT_ROLES) {
      const floats = plan.triangles[role];
      mix(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength));
    }
  }
  return hash.toString(16);
}

describe('the verdicts — #1540’s P-9, counted', () => {
  it('comes to each named footprint’s verdict', () => {
    for (const [name, verdict] of Object.entries(FOOTPRINT_FIXTURE_VERDICTS)) {
      const plan = planOf(name as FootprintFixtureName);
      expect(typeof plan === 'string' ? plan : 'kept', name).toBe(verdict);
    }
  });

  it('publishes exact counts over the whole fixture', () => {
    const { plans, verdicts } = footprintPlans(
      fixture.corridor,
      mask,
      fixture.profile,
      fixture.origin,
    );
    const expected = Object.fromEntries(
      FOOTPRINT_VERDICTS.map((verdict) => [verdict, 0]),
    ) as Record<FootprintVerdict, number>;
    for (const verdict of Object.values(FOOTPRINT_FIXTURE_VERDICTS)) expected[verdict] += 1;
    expect(verdicts).toStrictEqual(expected);
    expect(plans).toHaveLength(expected.kept);
  });
});

describe('nothing on a mapped wood, water or park — rule 2', () => {
  it('stands no plan’s centroid or vertex on wood, water or park', () => {
    const { plans } = footprintPlans(fixture.corridor, mask, fixture.profile, fixture.origin);
    const blocked = new Set(['wood', 'water', 'park']);
    expect(plans.length).toBeGreaterThan(5);
    for (const plan of plans) {
      expect(blocked.has(mask.classAt(plan.centroid.x, plan.centroid.z))).toBe(false);
      for (const [x, , z] of verticesOf(plan, 'wall')) {
        expect(blocked.has(mask.classAt(x as number, z as number))).toBe(false);
      }
    }
  });

  it('control: with no land classes the wood’s, the park’s and the lake’s footprints are kept', () => {
    for (const name of ['inWood', 'inPark', 'inLake'] as const) {
      expect(typeof planOf(name, NO_LAND_CLASS), name).toBe('object');
    }
  });
});

describe('rule 2 at every vertex, not only the centroid', () => {
  // Along 398–410 m, 120 m out on the left: the wood ends at 400 m, so the
  // centroid (404 m) is clear of it, and the first two vertices are in it.
  const straddling = buildingBeside(fixture.profile, fixture.origin, [
    rectangleBeside(404, -120, 12, 10),
  ]);
  const only = (land: LandClassMask): FootprintVerdict =>
    FOOTPRINT_VERDICTS.find(
      (verdict) =>
        footprintPlans(
          { ...fixture.corridor, buildings: [straddling] },
          land,
          fixture.profile,
          fixture.origin,
        ).verdicts[verdict] > 0,
    ) as FootprintVerdict;

  it('drops a footprint that straddles a wood edge with its centroid outside the wood', () => {
    const [cx, cz] = besideRoad(fixture.profile, fixture.origin, 404, -120);
    expect(mask.classAt(cx, cz)).not.toBe('wood');
    expect(only(mask)).toBe('on-excluded-land');
  });

  it('control: with no land classes the same footprint is kept', () => {
    expect(only(NO_LAND_CLASS)).toBe('kept');
  });
});

describe('a road wholly inside the footprint — rule 3', () => {
  // A 30 m road with a 120 × 120 m footprint over all of it: every segment of
  // the road lies inside the ring, more than the clearance from each edge, so
  // no segment meets an edge.
  const profile = northRoute(30, () => 10);
  const origin = corridorOrigin(profile);
  const [mx, mz] = besideRoad(profile, origin, 15, 0);
  const over: BuildingFeature = {
    kind: 'building',
    heightMetres: null,
    minHeightMetres: null,
    rings: [
      Float32Array.of(mx - 60, mz - 60, mx + 60, mz - 60, mx + 60, mz + 60, mx - 60, mz + 60),
    ],
  };
  const corridor: WorldCorridor = {
    routeId: 'road-inside',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }],
    landUse: [],
    buildings: [over],
    paths: [],
    streets: [],
  };

  it('drops the footprint a road runs wholly inside', () => {
    const { verdicts } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    expect(verdicts).toMatchObject({ 'on-road': 1, kept: 0 });
  });
});

describe('nothing on any stretch of the road — rule 3, #468', () => {
  // A 40 m hairpin: two legs 80 m apart, a covered residential block between them.
  const profile = hairpinRoute(40);
  const origin = corridorOrigin(profile);
  const building = (pairs: readonly (readonly [number, number])[]): BuildingFeature =>
    buildingBeside(profile, origin, [pairs]);
  // From the first leg, whose normal points across the inside of the turn.
  const ell = building([
    [200, 10],
    [215, 10],
    [215, 40],
    [203, 40],
    [203, 77],
    [200, 77],
  ]);
  const inside: readonly BuildingFeature[] = [
    building(rectangleBeside(100, 40, 10, 10)),
    building(rectangleBeside(150, 12, 10, 10)),
    building(rectangleBeside(250, 70, 10, 10)),
    building(rectangleBeside(300, 76, 10, 10)),
    ell,
  ];
  const corridor: WorldCorridor = {
    routeId: 'hairpin',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -500, maxX: 500, minZ: -200, maxZ: 800 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 0, 390, 5, 75)],
    buildings: inside,
    paths: [],
    streets: [],
  };
  const land = landClassMask(corridor);
  /** The drawn road, every half metre, the whole route. */
  const road: (readonly [number, number, number])[] = [];
  for (let along = 0; along <= profile.totalDistance; along += 0.5) {
    const at = drawnRoadPosition(profile, origin, along);
    road.push([at.x, at.z, along]);
  }
  const nearestRoad = (x: number, z: number, only?: (along: number) => boolean): number => {
    let least = Number.POSITIVE_INFINITY;
    for (const [rx, rz, along] of road) {
      if (only !== undefined && !only(along)) continue;
      least = Math.min(least, Math.hypot(rx - x, rz - z));
    }
    return least;
  };
  /** How near a ring's edges come to the road, sampled every 0.5 m along them. */
  const ringToRoad = (ring: Float32Array, only?: (along: number) => boolean): number => {
    const n = ring.length / 2;
    let least = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const ax = ring[i * 2] as number;
      const az = ring[i * 2 + 1] as number;
      const bx = ring[j * 2] as number;
      const bz = ring[j * 2 + 1] as number;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        least = Math.min(least, nearestRoad(ax + (bx - ax) * t, az + (bz - az) * t, only));
      }
    }
    return least;
  };

  it('keeps no plan whose walls come within the clearance of either leg', () => {
    const { plans, verdicts } = footprintPlans(corridor, land, profile, origin);
    expect(verdicts.kept).toBeGreaterThan(0);
    expect(verdicts['on-road']).toBeGreaterThan(0);
    for (const plan of plans) {
      const walls = verticesOf(plan, 'wall');
      for (const [x, , z] of walls) {
        // A chord of the drawn road lies inside the arc: a few centimetres' slack.
        expect(nearestRoad(x as number, z as number)).toBeGreaterThanOrEqual(
          ROAD_CLEARANCE_METRES - 0.05,
        );
      }
    }
  });

  it('drops the footprint that reaches the far leg; control: measuring only the nearest leg keeps it', () => {
    expect(
      footprintPlans({ ...corridor, buildings: [ell] }, land, profile, origin).verdicts,
    ).toMatchObject({
      'on-road': 1,
      kept: 0,
    });
    const ring = ell.rings[0] as Float32Array;
    // Its centroid is nearer the first leg, and the first leg alone is far enough away.
    const [cx, cz] = besideRoad(profile, origin, 206, 31);
    let nearestAlong = 0;
    let least = Number.POSITIVE_INFINITY;
    for (const [rx, rz, along] of road) {
      const apart = Math.hypot(rx - cx, rz - cz);
      if (apart < least) {
        least = apart;
        nearestAlong = along;
      }
    }
    const nearestLeg = (along: number): boolean => Math.abs(along - nearestAlong) < 150;
    expect(ringToRoad(ring, nearestLeg)).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES);
    expect(ringToRoad(ring)).toBeLessThan(ROAD_CLEARANCE_METRES);
  });
});

describe('at most 640 triangles a plan — the budget', () => {
  it('holds every plan of the fixture to its triangles, and its far level to 200', () => {
    const { plans } = footprintPlans(fixture.corridor, mask, fixture.profile, fixture.origin);
    expect(FOOTPRINT_MAX_TRIANGLES).toBe(REALISTIC_TRIANGLES.structure);
    for (const plan of plans) {
      const counted = FOOTPRINT_ROLES.reduce(
        (sum, role) => sum + plan.triangles[role].length / (3 * FOOTPRINT_VERTEX_FLOATS),
        0,
      );
      expect(plan.triangleCount).toBe(counted);
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
    // The heavy cases are in it: 48 vertices with two holes, the 200-vertex star, 19 600 m².
    expect(planned('courtyard').triangleCount).toBeGreaterThan(300);
    expect(planned('ring200').triangleCount).toBeGreaterThan(300);
    expect(planned('wide').triangleCount).toBeGreaterThan(0);
  });

  it('control: without the vertex cap the 200-vertex footprint is a plan of over 1 000 triangles', () => {
    const { plans } = footprintPlans(
      { ...fixture.corridor, buildings: [fixture.named.ring200] },
      mask,
      fixture.profile,
      fixture.origin,
      Number.POSITIVE_INFINITY,
    );
    expect(plans[0]?.triangleCount).toBeGreaterThan(1_000);
  });

  it('keeps a footprint’s holes while they fit, and fills them when they would take it over', () => {
    const outerOnly = (building: BuildingFeature): FootprintPlan => {
      const plan = footprintPlans(
        {
          ...fixture.corridor,
          buildings: [{ ...building, rings: [building.rings[0] as Float32Array] }],
        },
        mask,
        fixture.profile,
        fixture.origin,
      ).plans[0];
      if (plan === undefined) throw new Error('not planned');
      return plan;
    };
    // The courtyard's two small holes fit: its walls run round them too.
    const courtyard = planned('courtyard');
    expect(verticesOf(courtyard, 'wall').length).toBeGreaterThan(
      verticesOf(outerOnly(fixture.named.courtyard), 'wall').length,
    );
    // A 48-point star with a 48-point star of a hole: 860 triangles with it, so filled.
    const ringed = buildingBeside(fixture.profile, fixture.origin, [
      starBeside(600, 120, 30, 27, 48),
      starBeside(600, 120, 18, 15, 48),
    ]);
    const plan = footprintPlans(
      { ...fixture.corridor, buildings: [ringed] },
      mask,
      fixture.profile,
      fixture.origin,
    ).plans[0];
    expect(plan?.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    expect(plan?.triangleCount).toBe(outerOnly(ringed).triangleCount);
  });
});

describe('the height rules — P-10', () => {
  it('reads 9 m as 3 storeys, none as 2, 1.4 m as 1 and never 0', () => {
    expect(storeysFor(9)).toBe(3);
    expect(storeysFor(null)).toBe(2);
    expect(storeysFor(1.4)).toBe(1);
    expect(storeysFor(0)).toBe(1);
    expect(planned('commercial').storeys).toBe(3);
    expect(planned('ell').storeys).toBe(2);
    expect(planned('low').storeys).toBe(1);
  });

  it('stands a part on a 6 m min_height 6 m up, with no plinth', () => {
    const part = planned('part');
    const ground = Math.min(
      ...verticesOf(part, 'wall').map(([x, , z]) =>
        groundUnder(fixture.profile, fixture.origin, mask, x as number, z as number),
      ),
    );
    expect(part.base).toBeCloseTo(ground + 6, 3);
    expect(part.triangles.plinth).toHaveLength(0);
    expect(Math.min(...verticesOf(part, 'wall').map(([, y]) => y as number))).toBeCloseTo(
      part.base,
      3,
    );
    // Its 15 m height less its 6 m base is 3 storeys.
    expect(part.storeys).toBe(3);
  });
});

describe('the walls stand on the highest ground, at the mapped height', () => {
  // On the 8 % climb, 12 m along the road: about 1 m of rise under it.
  const sloped = buildingBeside(fixture.profile, fixture.origin, [
    rectangleBeside(2_000, 40, 12, 10),
  ]);
  const slopedPlan = (): FootprintPlan => {
    const { plans } = footprintPlans(
      { ...fixture.corridor, buildings: [sloped] },
      mask,
      fixture.profile,
      fixture.origin,
    );
    if (plans[0] === undefined) throw new Error('the sloped footprint was not planned');
    return plans[0];
  };

  it('lifts the plinth top and the wall foot to at least the ground at every vertex', () => {
    const plan = slopedPlan();
    const ground = verticesOf(plan, 'wall').map(([x, , z]) =>
      groundUnder(fixture.profile, fixture.origin, mask, x as number, z as number),
    );
    expect(Math.max(...ground) - Math.min(...ground)).toBeGreaterThan(0.5);
    for (const role of ['plinth', 'wall'] as const) {
      for (const [x, y, z] of verticesOf(plan, role)) {
        // Every vertex of the walls and plinth at or above its own ground.
        if (role === 'plinth' && Math.abs((y as number) - plan.base) < 1e-4) continue;
        expect(y as number).toBeGreaterThanOrEqual(
          groundUnder(fixture.profile, fixture.origin, mask, x as number, z as number) - 1e-4,
        );
      }
    }
    expect(
      Math.min(...verticesOf(plan, 'wall').map(([, y]) => y as number)),
    ).toBeGreaterThanOrEqual(Math.max(...ground) - 1e-4);
  });

  it('raises the eaves by the mapped height, not the rounded storeys', () => {
    // 7 m is two storeys (6 m) rounded: a flat-roofed block's walls stand 7 m.
    const block = buildingBeside(
      fixture.profile,
      fixture.origin,
      [rectangleBeside(850, 60, 30, 20)],
      7,
    );
    const { plans } = footprintPlans(
      { ...fixture.corridor, buildings: [block] },
      mask,
      fixture.profile,
      fixture.origin,
    );
    const plan = plans[0] as FootprintPlan;
    expect(plan.roof).toBe('flat');
    const ys = verticesOf(plan, 'wall').map(([, y]) => y as number);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(7, 3);
  });
});

describe('the roof rule — P-11', () => {
  it('puts a gable on a 10 × 14 m residential rectangle, its ridge along the 14 m side', () => {
    const gable = planned('gable');
    expect(gable.roof).toBe('gable');
    const roof = verticesOf(gable, 'roof');
    const top = Math.max(...roof.map(([, y]) => y as number));
    const ridge = roof.filter(([, y]) => Math.abs((y as number) - top) < 1e-3);
    let longest = 0;
    let along = [0, 0];
    for (const a of ridge) {
      for (const b of ridge) {
        const apart = Math.hypot(
          (b[0] as number) - (a[0] as number),
          (b[2] as number) - (a[2] as number),
        );
        if (apart > longest) {
          longest = apart;
          along = [(b[0] as number) - (a[0] as number), (b[2] as number) - (a[2] as number)];
        }
      }
    }
    expect(longest).toBeCloseTo(14, 1);
    // The road runs along z on this fixture, and the 14 m side is along the road.
    const [ax, az] = besideRoad(fixture.profile, fixture.origin, 0, 0);
    const [bx, bz] = besideRoad(fixture.profile, fixture.origin, 100, 0);
    const heading = [(bx - ax) / 100, (bz - az) / 100];
    expect(
      Math.abs(
        ((along[0] ?? 0) * (heading[0] ?? 0) + (along[1] ?? 0) * (heading[1] ?? 0)) / longest,
      ),
    ).toBeCloseTo(1, 2);
  });

  it('puts a flat roof on an L of a like area, and on a 30 m tower', () => {
    expect(planned('ell').roof).toBe('flat');
    expect(planned('tower').roof).toBe('flat');
    expect(planned('ell').triangles.parapet.length).toBeGreaterThan(0);
    expect(planned('gable').triangles.parapet).toHaveLength(0);
  });

  it('finds the minimum-area rectangle of a turned rectangle', () => {
    const turn = 0.4;
    const ring = Float32Array.from(
      [
        [-7, -5],
        [7, -5],
        [7, 5],
        [-7, 5],
      ].flatMap(([x, z]) => [
        (x as number) * Math.cos(turn) - (z as number) * Math.sin(turn),
        (x as number) * Math.sin(turn) + (z as number) * Math.cos(turn),
      ]),
    );
    const rectangle = minimumAreaRectangle(ring);
    expect(rectangle.area).toBeCloseTo(140, 3);
    expect(rectangle.halfLong).toBeCloseTo(7, 3);
    expect(rectangle.halfShort).toBeCloseTo(5, 3);
    expect(Math.abs(rectangle.ux * Math.cos(turn) + rectangle.uz * Math.sin(turn))).toBeCloseTo(
      1,
      3,
    );
  });
});

describe('the surfaces — #1540’s table, with #1548’s swap', () => {
  it('chooses by use, storeys and roof', () => {
    expect(wallSurfaceOf('residential', 2, 'gable', 0.1)).toBe('brick');
    expect(wallSurfaceOf('residential', 2, 'gable', 0.9)).toBe('render');
    expect(wallSurfaceOf('commercial', 3, 'flat', 0.1)).toBe('render');
    expect(wallSurfaceOf('industrial', 3, 'flat', 0.1)).toBe('corrugated');
    expect(wallSurfaceOf('farmland', 2, 'flat', 0.1)).toBe('planks');
    expect(wallSurfaceOf('farmland', 2, 'gable', 0.1)).toBe('brick');
    expect(wallSurfaceOf('commercial', 6, 'flat', 0.1)).toBe('concrete');
    expect(roofSurfaceOf('flat', 0.1)).toBe('flat-roof');
    expect(roofSurfaceOf('gable', 0.1)).toBe('roof-tiles');
    expect(roofSurfaceOf('gable', 0.9)).toBe('slate');
    expect(footprintUse('built-up', 'retail')).toBe('commercial');
    expect(footprintUse('built-up', 'railway')).toBe('industrial');
    expect(footprintUse('farmland', undefined)).toBe('farmland');
    expect(footprintUse('other', undefined)).toBe('residential');
  });

  it('dresses the fixture’s buildings by the land use under each', () => {
    expect(planned('tower').surfaces).toStrictEqual({ wall: 'concrete', roof: 'flat-roof' });
    expect(planned('commercial').surfaces.wall).toBe('render');
    expect(planned('industrial').surfaces.wall).toBe('corrugated');
    expect(planned('barn').surfaces).toStrictEqual({ wall: 'planks', roof: 'flat-roof' });
    expect(planned('farmhouse').surfaces.wall).toBe('brick');
    expect(['roof-tiles', 'slate']).toContain(planned('gable').surfaces.roof);
    const { plans } = footprintPlans(fixture.corridor, mask, fixture.profile, fixture.origin);
    for (const plan of plans) {
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.wall);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.roof);
    }
  });
});

describe('on the drawn ground — rule 4', () => {
  it('sets no plinth foot above the ground at any vertex, nor more than the foundation and 2.5 m below it', () => {
    const { plans } = footprintPlans(fixture.corridor, mask, fixture.profile, fixture.origin);
    let checked = 0;
    for (const plan of plans) {
      if (plan.triangles.plinth.length === 0) continue;
      for (const [x, y, z] of verticesOf(plan, 'plinth')) {
        if (Math.abs((y as number) - plan.base) > 1e-4) continue;
        const ground = groundUnder(fixture.profile, fixture.origin, mask, x as number, z as number);
        expect(plan.base).toBeLessThanOrEqual(ground + 1e-4);
        expect(ground - plan.base).toBeLessThanOrEqual(FOUNDATION_METRES + 2.5 + 1e-4);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('control: the steep footprint’s ground varies by more than 2.5 m under it', () => {
    const steep = fixture.named.steep.rings[0] as Float32Array;
    const heights: number[] = [];
    for (let i = 0; i + 1 < steep.length; i += 2) {
      heights.push(
        groundUnder(
          fixture.profile,
          fixture.origin,
          mask,
          steep[i] as number,
          steep[i + 1] as number,
        ),
      );
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(2.5);
  });
});

describe('the triangles — winding and the door', () => {
  it('winds every triangle counter-clockwise seen from the side its normal faces', () => {
    const { plans } = footprintPlans(fixture.corridor, mask, fixture.profile, fixture.origin);
    let triangles = 0;
    for (const plan of plans) {
      for (const role of FOOTPRINT_ROLES) {
        const f = plan.triangles[role];
        const stride = FOOTPRINT_VERTEX_FLOATS;
        for (let at = 0; at < f.length; at += 3 * stride) {
          const p = (k: number, c: number): number => f[at + k * stride + c] as number;
          const ux = p(1, 0) - p(0, 0);
          const uy = p(1, 1) - p(0, 1);
          const uz = p(1, 2) - p(0, 2);
          const vx = p(2, 0) - p(0, 0);
          const vy = p(2, 1) - p(0, 1);
          const vz = p(2, 2) - p(0, 2);
          const facing =
            (uy * vz - uz * vy) * p(0, 3) +
            (uz * vx - ux * vz) * p(0, 4) +
            (ux * vy - uy * vx) * p(0, 5);
          expect(facing, role).toBeGreaterThan(0);
          triangles += 1;
        }
      }
    }
    expect(triangles).toBeGreaterThan(500);
  });

  it('puts the door on the wall nearest the road, and faces it out', () => {
    const gable = planned('gable');
    const door = verticesOf(gable, 'door');
    expect(door).toHaveLength(6);
    // The gable is 35–45 m out: its near wall is the one at 35 m.
    const [nx, nz] = besideRoad(fixture.profile, fixture.origin, 330, 35);
    const [fx, fz] = besideRoad(fixture.profile, fixture.origin, 330, 45);
    const meanX = door.reduce((sum, [x]) => sum + (x as number), 0) / door.length;
    const meanZ = door.reduce((sum, [, , z]) => sum + (z as number), 0) / door.length;
    expect(Math.hypot(meanX - nx, meanZ - nz)).toBeLessThan(1);
    expect(Math.hypot(meanX - fx, meanZ - fz)).toBeGreaterThan(9);
    const normal = [gable.triangles.door[3] as number, gable.triangles.door[5] as number];
    expect((normal[0] ?? 0) * (nx - fx) + (normal[1] ?? 0) * (nz - fz)).toBeGreaterThan(0);
  });
});

describe('the build at ride start — #1540’s performance budget', () => {
  it('plans the 2 000-footprint town, every one of them, in a bounded time', () => {
    const town = denseTownFixture();
    const land = landClassMask(town.corridor);
    expect(town.corridor.buildings).toHaveLength(2_000);
    let fastest = Number.POSITIVE_INFINITY;
    let kept = 0;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      kept = footprintPlans(town.corridor, land, town.profile, town.origin).verdicts.kept;
      fastest = Math.min(fastest, performance.now() - started);
    }
    expect(kept).toBe(2_000);
    // The budget is 400 ms in Chromium, which `corridor.browser.spec.ts`
    // measures; Node measured 80–115 ms on the development machine. This
    // bound is ten times the budget, so coverage instrumentation is not a red
    // build and a plan that searched the whole road for every vertex is.
    expect(fastest).toBeLessThan(4_000);
  }, 60_000);
});

describe('deterministic — the same corridor, route and seed give the same plans', () => {
  it('builds byte-identical plans twice, and the ride’s progress does not move them', () => {
    const first = digestOf(
      footprintPlans(fixture.corridor, mask, fixture.profile, fixture.origin).plans,
    );
    // Frames along the ride warm every cache a plan reads: the relief nodes, the waterways.
    const start = atStartLine(fixture.profile);
    for (const along of [100, 900, 2_200]) {
      sceneFrame({
        profile: fixture.profile,
        origin: fixture.origin,
        state: {
          ...start,
          ride: { ...start.ride, distance: metres(distanceOnRoute(fixture.profile, along)) },
        },
        landClass: mask,
      });
    }
    const second = digestOf(
      footprintPlans(fixture.corridor, mask, fixture.profile, fixture.origin).plans,
    );
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });
});
