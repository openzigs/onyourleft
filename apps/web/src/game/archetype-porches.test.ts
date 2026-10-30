// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1784: the archetypes' full-width front porches on posts — a Foursquare's,
 * a bungalow's, a farmhouse's — and their own eaves: wide on a bungalow and a
 * Foursquare, tight on a Cape. Held where a rider sees them: the plans
 * `footprintPlans` returns and the packed vertex floats the belt uploads, the
 * `porch` and `roof` roles. The lever is held against frozen records of the
 * plans before this change.
 */

import { describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import {
  EAVES_OVERHANG_METRES,
  eavePitchOf,
  FACADE_DOOR,
  FACADE_OFFSET,
  FACADE_RAILING,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  GUTTER,
  minimumAreaRectangle,
  PORCH_ROLES,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  eavesOverhangOf,
  houseStreetFixture,
  landBeside,
  mixedTownFixture,
  planFingerprint,
  rectangleBeside,
} from './footprint-fixtures-testing';
import { ARCHETYPE_FEATURES, type HouseArchetype } from './house-archetypes';
import { landClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { FRONT_PORCH } from './porch';
import { rectanglesOf } from './rectilinear-roofs';
import { nearestOnRoadSegments, roadSegmentsNear, type BesideTheRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin, type CorridorOrigin } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** A town's corridor on its own road. */
interface Town {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
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
const housePlans = plan(houses);
const everyPlan = [...plan(mixed), ...housePlans];

/** One vertex as the belt uploads it. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
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
      nx: floats[at + 3] as number,
      ny: floats[at + 4] as number,
      nz: floats[at + 5] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
    });
  }
  return out;
}

/** The front door's frame: its middle, the way it faces, the way along its wall, and the floor. */
function doorOf(plan: FootprintPlan): {
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly floor: number;
} {
  const door = verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_DOOR);
  const [first] = door as [Vertex];
  return {
    x: door.reduce((sum, vertex) => sum + vertex.x, 0) / door.length,
    z: door.reduce((sum, vertex) => sum + vertex.z, 0) / door.length,
    nx: first.nx,
    nz: first.nz,
    floor: Math.min(...door.map((vertex) => vertex.y)),
  };
}

/** The front wall's length: the footprint's edge the door stands on. */
function frontLengthOf(plan: FootprintPlan): number {
  const door = doorOf(plan);
  const ring = plan.footprint;
  const n = ring.length / 2;
  let best = Number.POSITIVE_INFINITY;
  let length = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const [ax, az] = [ring[i * 2] as number, ring[i * 2 + 1] as number];
    const [bx, bz] = [ring[j * 2] as number, ring[j * 2 + 1] as number];
    const run = Math.hypot(bx - ax, bz - az);
    const t = Math.max(
      0,
      Math.min(1, ((door.x - ax) * (bx - ax) + (door.z - az) * (bz - az)) / run ** 2),
    );
    const off = Math.hypot(ax + (bx - ax) * t - door.x, az + (bz - az) * t - door.z);
    if (off < best) {
      best = off;
      length = run;
    }
  }
  return length;
}

/** A porch's deck along its wall, from the door's middle: its two ends. */
function deckOf(plan: FootprintPlan): readonly [number, number] {
  const door = doorOf(plan);
  const along = (vertex: Vertex): number =>
    (vertex.x - door.x) * -door.nz + (vertex.z - door.z) * door.nx;
  const deck = verticesOf(plan, 'porch').filter(
    (vertex) => vertex.ny > 0.999 && Math.abs(vertex.y - door.floor) < 1e-3,
  );
  return [Math.min(...deck.map(along)), Math.max(...deck.map(along))];
}

/** Where along the wall a porch's posts stand: its upright faces' feet on the deck, clustered. */
function postsOf(plan: FootprintPlan): number[] {
  const door = doorOf(plan);
  const along = (vertex: Vertex): number =>
    (vertex.x - door.x) * -door.nz + (vertex.z - door.z) * door.nx;
  const feet = verticesOf(plan, 'porch')
    .filter(
      (vertex) =>
        Math.abs(vertex.ny) < 1e-3 &&
        vertex.top !== FACADE_RAILING &&
        Math.abs(vertex.y - door.floor) < 1e-3,
    )
    .map(along)
    .sort((p, q) => p - q);
  const clusters: number[][] = [];
  for (const at of feet) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && at - (last[last.length - 1] as number) < FRONT_PORCH.post + 0.05) {
      last.push(at);
    } else {
      clusters.push([at]);
    }
  }
  return clusters.map((each) => each.reduce((sum, at) => sum + at, 0) / each.length);
}

const ofArchetype = (archetype: HouseArchetype): readonly FootprintPlan[] =>
  everyPlan.filter((each) => each.archetype === archetype);

describe('the full-width porch, read back from the plan — #1784', () => {
  it.each(['foursquare', 'bungalow'] as const)(
    'spans every %s’s front wall, less its end margins, on four posts',
    (archetype) => {
      const porched = ofArchetype(archetype).filter((each) => each.porch);
      expect(porched.length).toBeGreaterThan(5);
      for (const each of porched) {
        const length = frontLengthOf(each);
        const [from, to] = deckOf(each);
        expect(to - from).toBeCloseTo(length - 2 * FRONT_PORCH.endMargin, 2);
        expect(from).toBeCloseTo(-(length / 2 - FRONT_PORCH.endMargin), 2);
        // Four posts: one at each end, and two a third of the way in from each.
        const posts = postsOf(each);
        expect(posts).toHaveLength(4);
        const half = (to - from) / 2;
        expect(posts[1] as number).toBeCloseTo(-half / 3, 1);
        expect(posts[2] as number).toBeCloseTo(half / 3, 1);
      }
    },
  );

  it('control: with the lever off, the same houses’ porches are #1589’s seeded width', () => {
    const off = [
      ...plan(mixed, { archetypePorches: false }),
      ...plan(houses, { archetypePorches: false }),
    ];
    const widths = off
      .filter(
        (each) => (each.archetype === 'foursquare' || each.archetype === 'bungalow') && each.porch,
      )
      .map((each) => {
        const [from, to] = deckOf(each);
        return to - from;
      });
    expect(widths.length).toBeGreaterThan(5);
    for (const width of widths) expect(width).toBeLessThanOrEqual(FRONT_PORCH.width.most + 1e-3);
  });

  it('gives the farmhouse the full-width porch, and every other archetype #1589’s', () => {
    for (const [archetype, features] of Object.entries(ARCHETYPE_FEATURES)) {
      expect(features.porchWidth).toBe(
        ['foursquare', 'bungalow', 'farmhouse'].includes(archetype) ? 'full' : 'seeded',
      );
    }
    const farmhouses = ofArchetype('farmhouse').filter((plan) => plan.porch);
    // A floor, so the loop cannot pass on an empty set: the fixtures give it one.
    expect(farmhouses.length).toBeGreaterThanOrEqual(1);
    for (const each of farmhouses) {
      const [from, to] = deckOf(each);
      expect(to - from).toBeCloseTo(frontLengthOf(each) - 2 * FRONT_PORCH.endMargin, 2);
    }
  });
});

/** How far a point is from the drawn road's centreline. */
function fromRoad(profile: RouteProfile, origin: CorridorOrigin, x: number, z: number): number {
  const segments: number[] = [];
  const road = roadSegmentsNear(profile, origin, x, z, 300, segments);
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  nearestOnRoadSegments(road, segments, x, z, beside);
  return beside.distance;
}

/** A row of Foursquares, their fronts `gap` metres past the road's clearance. */
function foursquaresAt(gap: number): Town & { readonly plans: readonly FootprintPlan[] } {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const lateral = ROAD_CLEARANCE_METRES + gap + 4.5;
  const buildings: BuildingFeature[] = [];
  for (let along = 200; along < 2_600; along += 40) {
    buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, lateral, 9.5, 9)], 6.5));
  }
  const corridor: WorldCorridor = {
    routeId: 'foursquare-row',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 100, 2_700, -60, 60)],
    buildings,
    paths: [],
    streets: [],
  };
  const town = { profile, origin, corridor };
  return { ...town, plans: plan(town) };
}

describe('the full-width porch keeps #1540’s road clearance — #1784, as #1589’s does', () => {
  const near = foursquaresAt(2.6);
  const close = foursquaresAt(1.5);
  const nearestOf = (row: ReturnType<typeof foursquaresAt>, each: FootprintPlan): number =>
    Math.min(
      ...PORCH_ROLES.flatMap((role) =>
        verticesOf(each, role).map((vertex) =>
          fromRoad(row.profile, row.origin, vertex.x, vertex.z),
        ),
      ),
    );

  it('shortens a full-width porch that would reach the clearance', () => {
    expect(near.plans.every((each) => each.archetype === 'foursquare')).toBe(true);
    const porched = near.plans.filter((each) => each.porch);
    expect(porched.length).toBeGreaterThan(10);
    for (const each of porched) {
      expect(nearestOf(near, each)).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES - 1e-3);
      const [from, to] = deckOf(each);
      expect(to - from).toBeCloseTo(9.5 - 2 * FRONT_PORCH.endMargin, 1);
    }
  });

  it('drops one that would reach it even at its least depth', () => {
    expect(close.plans.length).toBeGreaterThan(10);
    expect(close.plans.every((each) => each.archetype === 'foursquare')).toBe(true);
    expect(close.plans.filter((each) => each.porch)).toStrictEqual([]);
  });
});

describe('the archetypes’ eaves, read back from the plan — #1784', () => {
  /** How far a plan's roof reaches past its walls across its slopes. */
  const reachOf = (each: FootprintPlan): number => {
    const rectangle = minimumAreaRectangle(each.footprint);
    let reach = 0;
    for (const vertex of verticesOf(each, 'roof')) {
      const dx = vertex.x - rectangle.cx;
      const dz = vertex.z - rectangle.cz;
      reach = Math.max(
        reach,
        Math.abs(-dx * rectangle.uz + dz * rectangle.ux) - rectangle.halfShort,
      );
    }
    return reach;
  };

  it.each([
    ['bungalow', 0.65],
    ['foursquare', 0.65],
    ['cape', 0.15],
  ] as const)('overhangs every %s’s walls by %d m across its slopes', (archetype, overhang) => {
    const plans = ofArchetype(archetype);
    expect(plans.length).toBeGreaterThan(5);
    for (const each of plans) expect(reachOf(each)).toBeCloseTo(overhang, 3);
  });

  it('overhangs every other pitched plan by #1581’s 0.4 m, as before', () => {
    const others = everyPlan.filter(
      (each) =>
        each.roof !== 'flat' &&
        !['bungalow', 'foursquare', 'cape'].includes(each.archetype) &&
        each.roofVariant === 'plain' &&
        // #1660's split roofs reach past their own rectangles, not this one.
        (rectanglesOf(each.footprint)?.length ?? 1) === 1,
    );
    expect(others.length).toBeGreaterThan(20);
    for (const each of others) expect(reachOf(each)).toBeCloseTo(EAVES_OVERHANG_METRES, 3);
  });

  it('control: with the lever off, a bungalow’s and a Cape’s eaves are #1581’s', () => {
    for (const each of [
      ...plan(mixed, { archetypePorches: false }),
      ...plan(houses, { archetypePorches: false }),
    ]) {
      if (each.roof === 'flat' || (each.archetype !== 'bungalow' && each.archetype !== 'cape'))
        continue;
      expect(reachOf(each)).toBeCloseTo(EAVES_OVERHANG_METRES, 3);
    }
  });
});

describe('a porch under the archetype’s eaves — #1784', () => {
  /** A row of 60 bungalows, 7.5 m along by 13 m deep, one storey, on residential land. */
  const bungalows = (): readonly FootprintPlan[] => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings = Array.from({ length: 60 }, (_, index) =>
      buildingBeside(profile, origin, [rectangleBeside(200 + index * 40, 30, 7.5, 13)], 3.5),
    );
    const town = {
      profile,
      origin,
      corridor: {
        routeId: 'bungalow-row',
        origin,
        covered: () => true,
        coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
        landUse: [landBeside(profile, origin, 'landuse', 'residential', 100, 2_700, -60, 60)],
        buildings,
        paths: [],
        streets: [],
      },
    };
    return plan(town);
  };

  it('ties every porch’s roof to its wall under the gutter, whatever the eave’s overhang', () => {
    let tied = 0;
    const row = bungalows();
    expect(row.every((each) => each.archetype === 'bungalow')).toBe(true);
    for (const each of [...everyPlan, ...row]) {
      if (!each.porch || each.roof === 'flat') continue;
      tied += 1;
      const pitch = (eavePitchOf(each.roofVariant, each.pitchDegrees) * Math.PI) / 180;
      const gutterFoot =
        each.eaves - eavesOverhangOf(each) * Math.tan(pitch) - GUTTER.below - GUTTER.depth;
      const top = Math.max(...verticesOf(each, 'porch-roof').map((vertex) => vertex.y));
      // Under it by the 3 cm `porchWallTopOf` leaves between them.
      expect(top).toBeLessThanOrEqual(gutterFoot - 0.03 + 1e-4);
    }
    expect(tied).toBeGreaterThan(20);
  });
});

describe('the caps — #1784', () => {
  it('holds a Foursquare with a full-width porch, a dormer and a chimney to 640 and 200, its porch not far', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    // The largest the Foursquare's row admits (#1782's), a dozen along the road.
    const buildings = Array.from({ length: 12 }, (_, index) =>
      buildingBeside(
        profile,
        origin,
        [
          rectangleBeside(0, 0, 10.7, 10.25).map(
            ([a, n]) => [1_000 + index * 40 + a, 24 + n] as const,
          ),
        ],
        6.5,
      ),
    );
    const corridor: WorldCorridor = {
      routeId: 'largest-foursquares',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    let full = 0;
    for (const each of plans) {
      expect(each.archetype).toBe('foursquare');
      expect(each.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(each.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      // The far level is walls and roof alone: no porch in it.
      expect(each.farTriangleCount).toBe(
        (each.triangles.wall.length + each.triangles.roof.length) / (3 * FOOTPRINT_VERTEX_FLOATS),
      );
      if (each.porch && each.dormers === 1 && each.triangles.chimney.length > 0) full += 1;
    }
    expect(full).toBeGreaterThan(3);
  });
});

/**
 * The plans before #1784, fingerprinted by `footprint-fixtures-testing.ts`
 * §`planFingerprint`, each town with its urban class: `origin/main`'s at
 * `ac20712c` with every later lever off as well (its own frozen record), and
 * #1786's head (`feature/issue-1786-dormer-variants` at `b178f7c4`) as it
 * planned them.
 *
 * A frozen record of the planner before #1784, not a snapshot to refresh. If
 * #1785 or #1786 changes before it merges, #1786's head's two are re-derived
 * from it, and the PR says so.
 */
const BEFORE = {
  main: { mixed: '18e7375f', houses: '15da7210' },
  dormerVariants: { mixed: 'cdb29b12', houses: '29c7aa09' },
} as const;

describe('the lever — #1784', () => {
  it('plans every footprint as before #1784 with `-archetype-porches`', () => {
    expect(planFingerprint(plan(mixed, { archetypePorches: false }))).toBe(
      BEFORE.dormerVariants.mixed,
    );
    expect(planFingerprint(plan(houses, { archetypePorches: false }))).toBe(
      BEFORE.dormerVariants.houses,
    );
    const none = {
      archetypePorches: false,
      dormerVariants: false,
      roofVariants: false,
    } as const;
    expect(planFingerprint(plan(mixed, none))).toBe(BEFORE.main.mixed);
    expect(planFingerprint(plan(houses, none))).toBe(BEFORE.main.houses);
  });

  it('control: with the lever on, the towns are not as before', () => {
    expect(planFingerprint(plan(mixed))).not.toBe(BEFORE.dormerVariants.mixed);
    expect(planFingerprint(housePlans)).not.toBe(BEFORE.dormerVariants.houses);
  });
});
