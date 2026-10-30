// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1786: the archetypes' dormers — two gabled ones on a Cape, a hipped one on
 * a Foursquare's route-facing slope, a wide shed one on a bungalow — held
 * where a rider sees them: the plans `footprintPlans` returns and the packed
 * vertex floats the belt uploads, the `dormer` and `dormer-roof` roles and the
 * fronts' `FACADE_DORMER` code. The lever is held against frozen records of
 * the plans before this change.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import {
  DORMER_KIND_MIN_PITCH_DEGREES,
  DORMER_MIN_PITCH_DEGREES,
  FACADE_DOOR,
  FACADE_DORMER,
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  SHED_DORMER,
  STYLE_OFFSET,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  houseStreetFixture,
  mixedTownFixture,
  planFingerprint,
  rectangleBeside,
} from './footprint-fixtures-testing';
import { ARCHETYPE_FEATURES, type HouseArchetype } from './house-archetypes';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** A town's corridor on its own road. */
interface Town {
  readonly profile: ReturnType<typeof northRoute>;
  readonly origin: ReturnType<typeof corridorOrigin>;
  readonly corridor: WorldCorridor;
}

/** A town's plans, with its urban class as the press builds it — the realistic page's. */
function plan(town: Town, options: FootprintPlanOptions = {}): readonly FootprintPlan[] {
  const land = landClassMask(town.corridor);
  const urban = urbanClassMap(town.corridor, land, town.profile);
  return footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options)
    .plans;
}

const mixed = mixedTownFixture();
const houses = houseStreetFixture();
const mixedPlans = plan(mixed);
const housePlans = plan(houses);
const everyPlan = [...mixedPlans, ...housePlans];
const ofArchetype = (archetype: HouseArchetype): readonly FootprintPlan[] =>
  everyPlan.filter((each) => each.archetype === archetype);

/** One vertex as the belt uploads it. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      x: floats[at] as number,
      y: floats[at + 1] as number,
      z: floats[at + 2] as number,
      nx: floats[at + 3] as number,
      ny: floats[at + 4] as number,
      nz: floats[at + 5] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
      width: floats[at + STYLE_OFFSET + 2] as number,
      height: floats[at + STYLE_OFFSET + 3] as number,
    });
  }
  return out;
}

/** The dormers' fronts: six vertices each, coded {@link FACADE_DORMER}. */
const frontsOf = (plan: FootprintPlan): Vertex[][] => {
  const fronts = verticesOf(plan, 'dormer').filter((vertex) => vertex.top === FACADE_DORMER);
  const out: Vertex[][] = [];
  for (let at = 0; at + 6 <= fronts.length; at += 6) out.push(fronts.slice(at, at + 6));
  return out;
};

/** The way the front door faces, seen from above. */
function doorFacing(plan: FootprintPlan): readonly [number, number] {
  const door = verticesOf(plan, 'door').find((vertex) => vertex.top === FACADE_DOOR) as Vertex;
  return [door.nx, door.nz];
}

/** A dormer roof's distinct planes: each normal's lean along the front's outward way, and its pitch. */
function dormerRoofPlanes(
  plan: FootprintPlan,
  outward: readonly [number, number],
): { readonly out: number; readonly pitch: number }[] {
  const planes = new Map<string, { readonly out: number; readonly pitch: number }>();
  for (const vertex of verticesOf(plan, 'dormer-roof')) {
    const key = `${vertex.nx.toFixed(3)} ${vertex.ny.toFixed(3)} ${vertex.nz.toFixed(3)}`;
    const lean = Math.hypot(vertex.nx, vertex.nz);
    planes.set(key, {
      out: lean === 0 ? 0 : (vertex.nx * outward[0] + vertex.nz * outward[1]) / lean,
      pitch: (Math.acos(Math.min(1, vertex.ny)) * 180) / Math.PI,
    });
  }
  return [...planes.values()];
}

/** The heights of every roof triangle over `(x, z)`, seen from above. */
function roofHeightsAt(plan: FootprintPlan, x: number, z: number): number[] {
  const roof = verticesOf(plan, 'roof');
  const out: number[] = [];
  for (let at = 0; at + 2 < roof.length; at += 3) {
    const [p, q, r] = [roof[at], roof[at + 1], roof[at + 2]] as [Vertex, Vertex, Vertex];
    const det = (q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z);
    if (Math.abs(det) < 1e-9) continue;
    const s = ((x - p.x) * (r.z - p.z) - (r.x - p.x) * (z - p.z)) / det;
    const t = ((q.x - p.x) * (z - p.z) - (x - p.x) * (q.z - p.z)) / det;
    if (s < -1e-4 || t < -1e-4 || s + t > 1 + 1e-4) continue;
    out.push(p.y + s * (q.y - p.y) + t * (r.y - p.y));
  }
  return out;
}

describe('each archetype’s dormers, read back from the plan — #1786', () => {
  it('stands exactly two gabled dormers on the front slope of every Cape', () => {
    const capes = ofArchetype('cape');
    expect(capes.length).toBeGreaterThan(5);
    for (const each of capes) {
      expect(each.dormers).toBe(2);
      const fronts = frontsOf(each);
      expect(fronts).toHaveLength(2);
      const [dx, dz] = doorFacing(each);
      for (const front of fronts) {
        const [vertex] = front as [Vertex];
        expect(vertex.nx * dx + vertex.nz * dz).toBeGreaterThan(0.9);
      }
      // Gabled: its roof's two slopes lean along the eaves, none out over its front.
      const outward: readonly [number, number] = [
        (fronts[0]?.[0] as Vertex).nx,
        (fronts[0]?.[0] as Vertex).nz,
      ];
      const planes = dormerRoofPlanes(each, outward);
      expect(planes).toHaveLength(2);
      for (const plane of planes) expect(Math.abs(plane.out)).toBeLessThan(1e-3);
    }
  });

  it('stands one shed dormer on a bungalow, its roof one plane lower than the roof’s', () => {
    const bungalows = ofArchetype('bungalow');
    const sheds = bungalows.filter((each) => each.dormers > 0);
    // Every one but where the front would be too low for a sash (#1786's rule).
    expect(sheds.length).toBeGreaterThan(bungalows.length / 2);
    for (const each of sheds) {
      expect(each.dormers).toBe(1);
      const [front] = frontsOf(each) as [Vertex[]];
      expect(frontsOf(each)).toHaveLength(1);
      const [vertex] = front as [Vertex];
      // Wider than #1588's gabled one, and high enough for its sash.
      expect(vertex.width).toBeGreaterThan(2);
      expect(vertex.height).toBeGreaterThanOrEqual(SHED_DORMER.leastFront);
      const planes = dormerRoofPlanes(each, [vertex.nx, vertex.nz]);
      expect(planes).toHaveLength(1);
      const [shed] = planes as [{ readonly out: number; readonly pitch: number }];
      // Leaning out over its front, and lower than the roof.
      expect(shed.out).toBeGreaterThan(0.999);
      expect(shed.pitch).toBeCloseTo(each.pitchDegrees - SHED_DORMER.lessDegrees, 1);
      expect(shed.pitch).toBeLessThan(each.pitchDegrees);
    }
  });

  it('stands one hipped dormer on every Foursquare’s route-facing slope', () => {
    const foursquares = ofArchetype('foursquare');
    expect(foursquares.length).toBeGreaterThan(8);
    for (const each of foursquares) {
      expect(each.roof).toBe('hip');
      expect(each.dormers).toBe(1);
      const fronts = frontsOf(each);
      expect(fronts).toHaveLength(1);
      const [vertex] = fronts[0] as [Vertex];
      const [dx, dz] = doorFacing(each);
      // Facing the route as the front door does.
      expect(vertex.nx * dx + vertex.nz * dz).toBeGreaterThan(Math.SQRT1_2);
      // Hipped: two slopes along its eaves and one out over its front, at the roof's pitch.
      const planes = dormerRoofPlanes(each, [vertex.nx, vertex.nz]);
      expect(planes).toHaveLength(3);
      expect(planes.filter((plane) => Math.abs(plane.out) < 1e-3)).toHaveLength(2);
      expect(planes.filter((plane) => plane.out > 0.999)).toHaveLength(1);
      for (const plane of planes) expect(plane.pitch).toBeCloseTo(each.pitchDegrees, 1);
      // Each of its roof's triangles lies in the plane its normal names: its front's hip
      // leans back from the front, and is no upright gable.
      const roof = verticesOf(each, 'dormer-roof');
      for (let at = 0; at + 2 < roof.length; at += 3) {
        const [p, q, r] = [roof[at], roof[at + 1], roof[at + 2]] as [Vertex, Vertex, Vertex];
        for (const [from, to] of [
          [p, q],
          [q, r],
        ] as const) {
          const dot =
            (to.x - from.x) * from.nx + (to.y - from.y) * from.ny + (to.z - from.z) * from.nz;
          expect(Math.abs(dot)).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('gates each kind on its own least pitch, the gabled dormer keeping 40°', () => {
    expect(DORMER_KIND_MIN_PITCH_DEGREES.gabled).toBe(DORMER_MIN_PITCH_DEGREES);
    expect(DORMER_MIN_PITCH_DEGREES).toBe(40);
    // Each archetype's called-for kind stands on every pitch it is drawn at.
    for (const features of Object.values(ARCHETYPE_FEATURES)) {
      if (features.dormers === 'none' || features.pitches === 'seeded') continue;
      for (const pitch of features.pitches) {
        expect(pitch).toBeGreaterThanOrEqual(DORMER_KIND_MIN_PITCH_DEGREES[features.dormers[0]]);
      }
    }
  });

  it('control: with the lever off, the Foursquare and the bungalow have none', () => {
    const off = [
      ...plan(mixed, { dormerVariants: false }),
      ...plan(houses, { dormerVariants: false }),
    ];
    for (const each of off) {
      if (each.archetype === 'foursquare' || each.archetype === 'bungalow') {
        expect(each.dormers).toBe(0);
      }
    }
  });
});

/**
 * Whether any of a plan's dormers meets its chimney seen from above: each
 * dormer's box — along its front, and from its front back to its furthest
 * corner — against the chimney's box in the same frame.
 */
function dormerMeetsChimney(plan: FootprintPlan): boolean {
  const chimney = verticesOf(plan, 'chimney');
  if (chimney.length === 0) return false;
  const rest = [...verticesOf(plan, 'dormer'), ...verticesOf(plan, 'dormer-roof')];
  return frontsOf(plan).some((front) => {
    const [first] = front as [Vertex];
    const [nx, nz] = [first.nx, first.nz];
    const [ex, ez] = [-nz, nx];
    const mx = front.reduce((sum, vertex) => sum + vertex.x, 0) / front.length;
    const mz = front.reduce((sum, vertex) => sum + vertex.z, 0) / front.length;
    const along = (vertex: Vertex): number => (vertex.x - mx) * ex + (vertex.z - mz) * ez;
    const out = (vertex: Vertex): number => (vertex.x - mx) * nx + (vertex.z - mz) * nz;
    const half = Math.max(...front.map((vertex) => Math.abs(along(vertex))));
    const its = rest.filter((vertex) => Math.abs(along(vertex)) <= half + 1e-2);
    const back = Math.min(...its.map(out));
    const [a0, a1] = [Math.min(...chimney.map(along)), Math.max(...chimney.map(along))];
    const [c0, c1] = [Math.min(...chimney.map(out)), Math.max(...chimney.map(out))];
    return a0 < half - 1e-3 && a1 > -half + 1e-3 && c0 < -1e-3 && c1 > back + 1e-3;
  });
}

describe('inside the roof — #1786, over every dormered plan of the two towns', () => {
  it('stands no dormer above the ridge, past the eaves, or on the chimney', () => {
    let dormered = 0;
    let besideChimney = 0;
    for (const each of everyPlan) {
      if (each.dormers === 0) continue;
      dormered += 1;
      const ridge = Math.max(...verticesOf(each, 'roof').map((vertex) => vertex.y));
      if (each.triangles.chimney.length > 0) besideChimney += 1;
      for (const vertex of [...verticesOf(each, 'dormer'), ...verticesOf(each, 'dormer-roof')]) {
        expect(vertex.y).toBeLessThanOrEqual(ridge + 1e-4);
        expect(roofHeightsAt(each, vertex.x, vertex.z).length).toBeGreaterThan(0);
      }
      expect(dormerMeetsChimney(each)).toBe(false);
    }
    expect(dormered).toBeGreaterThan(30);
    expect(besideChimney).toBeGreaterThan(10);
  });

  it('builds no shed dormer where a short ridge leaves it no room beside the chimney', () => {
    // A bungalow's footprint under a side-hipped roof, whose ridge reaches 1 m from the middle.
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings = Array.from({ length: 12 }, (_, index) =>
      buildingBeside(
        profile,
        origin,
        [
          rectangleBeside(0, 0, 8.5, 10.5).map(
            ([a, n]) => [1_000 + index * 40 + a, 24 + n] as const,
          ),
        ],
        3.5,
      ),
    );
    const corridor: WorldCorridor = {
      routeId: 'short-ridged-bungalows',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [],
      buildings,
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
      {
        roofVariant: 'side-hipped',
      },
    );
    expect(plans.every((each) => each.archetype === 'bungalow')).toBe(true);
    expect(plans.filter((each) => each.triangles.chimney.length > 0).length).toBeGreaterThan(3);
    for (const each of plans) expect(dormerMeetsChimney(each)).toBe(false);
  });
});

describe('the caps — #1786', () => {
  it('holds a Cape with two dormers and a chimney, and a Foursquare with a hipped dormer and its porch, to 640 and 200', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    // The largest footprint each row admits (#1782's), eight of each along the road.
    const largest: readonly (readonly [
      HouseArchetype,
      readonly (readonly [number, number])[],
      number,
    ])[] = [
      ['cape', rectangleBeside(0, 0, 13, 9.2), 3.5],
      ['foursquare', rectangleBeside(0, 0, 10.7, 10.25), 6.5],
    ];
    const buildings: BuildingFeature[] = [];
    for (const [index, [, corners, height]] of largest.entries()) {
      for (let k = 0; k < 8; k += 1) {
        buildings.push(
          buildingBeside(
            profile,
            origin,
            [corners.map(([a, n]) => [1_000 + (index * 8 + k) * 40 + a, 24 + n] as const)],
            height,
          ),
        );
      }
    }
    const corridor: WorldCorridor = {
      routeId: 'largest-dormered',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    let capeWithChimney = 0;
    let foursquareWithPorch = 0;
    for (const each of plans) {
      expect(each.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(each.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      // Not on the far level: walls and roof alone.
      expect(each.farTriangleCount).toBe(
        (each.triangles.wall.length + each.triangles.roof.length) / (3 * FOOTPRINT_VERTEX_FLOATS),
      );
      if (each.archetype === 'cape' && each.dormers === 2 && each.triangles.chimney.length > 0) {
        capeWithChimney += 1;
      }
      if (each.archetype === 'foursquare' && each.dormers === 1 && each.porch)
        foursquareWithPorch += 1;
    }
    expect(plans.map((each) => each.archetype)).toStrictEqual([
      ...Array<HouseArchetype>(8).fill('cape'),
      ...Array<HouseArchetype>(8).fill('foursquare'),
    ]);
    expect(capeWithChimney).toBeGreaterThan(2);
    expect(foursquareWithPorch).toBeGreaterThan(2);
  });
});

/**
 * The plans before #1786, fingerprinted by `footprint-fixtures-testing.ts`
 * §`planFingerprint`: `origin/main`'s at `ac20712c` with #1785's roof
 * variants off as well (its own frozen record), and #1785's head
 * (`feature/issue-1785-roof-variants` at `44c72cfa`) with them on. Each town
 * with its urban class, the realistic page's.
 *
 * A frozen record of the planner before #1786, not a snapshot to refresh. If
 * #1785 changes before it merges, its head's two are re-derived from it, and
 * the PR says so.
 */
const BEFORE = {
  main: { mixed: '18e7375f', houses: '15da7210' },
  roofVariants: { mixed: 'f3054ead', houses: 'c99616bb' },
} as const;

describe('the lever — #1786', () => {
  it('plans every footprint as before #1786 with `-dormer-variants`', () => {
    // Since #1784 its eaves and porches are off too: neither had them.
    // And since #1783 the commercial archetypes.
    const off = {
      dormerVariants: false,
      archetypePorches: false,
      commercialArchetypes: false,
    } as const;
    expect(planFingerprint(plan(mixed, off))).toBe(BEFORE.roofVariants.mixed);
    expect(planFingerprint(plan(houses, off))).toBe(BEFORE.roofVariants.houses);
    const neither = { ...off, roofVariants: false } as const;
    expect(planFingerprint(plan(mixed, neither))).toBe(BEFORE.main.mixed);
    expect(planFingerprint(plan(houses, neither))).toBe(BEFORE.main.houses);
  });

  it('control: with the lever on, the towns are not as before', () => {
    expect(planFingerprint(mixedPlans)).not.toBe(BEFORE.roofVariants.mixed);
    expect(planFingerprint(housePlans)).not.toBe(BEFORE.roofVariants.houses);
  });
});
