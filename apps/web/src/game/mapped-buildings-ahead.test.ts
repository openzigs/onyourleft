// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The mapped buildings are drawn ahead of the rider — #2429. The owner saw
 * buildings in the realistic world appear only when the bike was next to
 * them. A refill took the {@link MAPPED_BUILDING_MAX} plans nearest to where
 * the rider stood, behind as much as ahead, and held them for
 * {@link MAPPED_CHUNK_METRES} of riding; in a dense town those 36 stood
 * within about 45 m, so by the middle of the chunk the road ahead had none.
 * Since #2429 a refill ranks them by the road ahead
 * (`realistic-budget.ts` §`MAPPED_RANKED_AHEAD_METRES`).
 *
 * Read through the path `GameView` takes: `sceneFrame` builds the frame and
 * its view, `refillMappedBuildings` refills the real belt at each chunk,
 * and the belt says which plans it drew. A ride at 10 m/s (36 km/h), a frame
 * every 0.2 s. Both realistic rungs hand the refill the same
 * `REALISTIC_STRUCTURE_ITEMS` (`quality.ts`), so one ride stands for both.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';

import { footprintPlans, FOOTPRINT_MAX_VERTICES, mappedTown } from './footprint-buildings';
import {
  mixedTownFixture,
  rowTownFixture,
  UNZONED_SUBURB_FROM,
  unzonedSuburbFixture,
} from './footprint-fixtures-testing';
import { HOUSE_MODELS } from './house-models';
import { landClassMask } from './land-class';
import {
  mappedBuildingsOf,
  mappedChunk,
  MappedSelection,
  selectMappedBuildings,
} from './mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_CHUNK_METRES,
  REALISTIC_STRUCTURE_ITEMS,
} from './realistic-budget';
import { nearestOnDrawnRoad } from './road-grid';
import { drawnRiderDistance, sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { drawnRoadFrame } from './terrain';
import { MappedBuildingBelt, refillMappedBuildings } from './three-renderer';
import { urbanClassMap } from './urban-class';

/** A texture three would have loaded: the fields a material and a release read. */
function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

const TEXTURES = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    { colour: aTexture(), normal: aTexture() },
  ]),
);

/** The rider's speed, m/s (36 km/h), and a frame's step at five frames a second. */
const SPEED = 10;
const STEP = SPEED / 5;

/**
 * The stated draw distance: every building whose middle is within
 * {@link FRONT_METRES} of the road and between the rider and this far up it
 * is drawn, on every frame: **100 m**, a chunk.
 */
const AHEAD_METRES = MAPPED_CHUNK_METRES;

/** What "beside the road" is here: the front row, its middle within **30 m**. */
const FRONT_METRES = 30;

const belts: MappedBuildingBelt[] = [];
afterEach(() => {
  for (const belt of belts.splice(0)) belt.dispose();
});

/**
 * The house models as `selectMappedBuildings` prices them — #2655: each its
 * real triangles, 1 243 to 2 946, so a modelled house costs two to five
 * structures of the frame's cap. Drawn as one stand-in triangle each, as
 * `mapped-building-belt.test.ts` stands them in: the price is what is asserted.
 */
const HOUSES = {
  models: HOUSE_MODELS.map((_, index) => ({
    position: Float32Array.from([index, 0, 0, index + 1, 2, 0, index, 0, 3]),
    normal: Float32Array.from([1, 0, 0, 0, 0, 1, Math.SQRT1_2, 0, Math.SQRT1_2]),
    uv: Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
    triangles: 1,
  })),
  atlas: aTexture(),
  triangles: HOUSE_MODELS.map((model) => model.triangles),
};

/**
 * A ride through a fixture town, read back off the belt: what it drew, frame
 * by frame. `houses`, the house models the belt draws (#1585): none, every
 * plan its extrusion, unless given. `front`, how near the road a building's
 * middle is to be owed: {@link FRONT_METRES} unless given.
 */
function ride(
  fixture: ReturnType<typeof rowTownFixture>,
  from: number,
  to: number,
  houses?: typeof HOUSES,
  front = FRONT_METRES,
) {
  const { profile, origin, corridor } = fixture;
  const land = landClassMask(corridor);
  const urban = urbanClassMap(corridor, land, profile);
  const { plans } = footprintPlans(corridor, land, profile, origin, FOOTPRINT_MAX_VERTICES, urban);
  const buildings = mappedBuildingsOf(plans);
  const town = mappedTown(corridor, plans, urban);
  const belt = new MappedBuildingBelt(buildings, TEXTURES, houses);
  belts.push(belt);
  const start = atStartLine(profile);
  const place = plans.map((plan) =>
    nearestOnDrawnRoad(profile, origin, plan.centroid.x, plan.centroid.z, 400),
  );
  const missed: string[] = [];
  /** How far ahead each plan was when it first drew, metres. */
  const firstAhead = new Map<number, number>();
  let mostBuildings = 0;
  let mostCalls = 0;
  let mostModels = 0;
  let owed = 0;
  // A whole frame is built only where the rider's chunk changes, and every
  // other frame refills from that frame's view under its own chunk, which
  // returns at once. `GameView` builds a frame every animation frame, but the
  // belt reads the view only at a refill, so the belt draws the same plans.
  let built: ReturnType<typeof sceneFrame> | undefined;
  let builtChunk: number | undefined;
  let drawn = new Set<number>();
  /** #2655: how near a mapped footprint each frame's field boundaries stand, metres. */
  const boundaries: number[] = [];
  for (let distance = from; distance < to; distance += STEP) {
    const input = {
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      worldCorridor: corridor,
      landClass: land,
      mappedBuildings: buildings,
      mappedTown: town,
      structureItems: REALISTIC_STRUCTURE_ITEMS,
    };
    const chunk = mappedChunk(drawnRiderDistance(input));
    if (built === undefined || chunk !== builtChunk) {
      built = sceneFrame(input);
      builtChunk = chunk;
      for (const item of built.scatter) {
        if (BOUNDARY_KINDS.has(item.kind)) {
          boundaries.push(nearestFootprintMetres(plans, item.x, item.z));
        }
      }
    }
    const view = built.mappedBuildings;
    if (view === undefined) throw new Error('no mapped buildings in the frame');
    const refills = belt.refills;
    refillMappedBuildings(
      belt,
      { ...view, chunk },
      built.scatter,
      built.billboards.length,
      REALISTIC_STRUCTURE_ITEMS,
    );
    if (belt.refills !== refills) {
      mostBuildings = Math.max(mostBuildings, belt.stats.buildings);
      mostCalls = Math.max(mostCalls, belt.stats.drawCalls);
      mostModels = Math.max(mostModels, belt.stats.modelled);
      drawn = new Set<number>();
      for (let place = 0; place < belt.stats.buildings; place += 1) {
        const at = belt.drawnAt(place);
        if (at !== undefined) drawn.add(at.plan);
      }
    }
    for (const index of drawn) {
      const at = place[index];
      if (at !== undefined && !firstAhead.has(index)) firstAhead.set(index, at.along - distance);
    }
    place.forEach((at, index) => {
      if (at === undefined || Math.abs(at.lateral) > front) return;
      const ahead = at.along - distance;
      if (ahead <= 0 || ahead > AHEAD_METRES) return;
      owed += 1;
      if (!drawn.has(index))
        missed.push(`${String(index)} ${ahead.toFixed(0)} m ahead at ${distance.toFixed(0)}`);
    });
  }
  // Each plan's first-drawn distance, past the ride's first refill.
  const ahead = [...firstAhead]
    .filter(([index]) => (place[index] as { along: number }).along > from + 300)
    .map(([, metresAhead]) => metresAhead)
    .sort((a, b) => a - b);
  return { missed, owed, ahead, mostBuildings, mostCalls, mostModels, boundaries };
}

/** The field boundaries' kinds: what #2655 keeps off the houses and out of their ranking. */
const BOUNDARY_KINDS: ReadonlySet<string> = new Set(['wall', 'hedge', 'fence']);

/**
 * How far `(x, z)` is from the nearest of `plans`' footprints, metres: 0
 * inside one. Measured edge by edge here, not with the index the product
 * keeps its boundaries off them by, so the assertion is not the code's own.
 */
function nearestFootprintMetres(
  plans: readonly { readonly footprint: Float32Array }[],
  x: number,
  z: number,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const { footprint } of plans) {
    const count = footprint.length / 2;
    let inside = false;
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const ax = footprint[j * 2] as number;
      const az = footprint[j * 2 + 1] as number;
      const bx = footprint[i * 2] as number;
      const bz = footprint[i * 2 + 1] as number;
      if (bz > z !== az > z && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
      const dx = bx - ax;
      const dz = bz - az;
      const span = dx * dx + dz * dz;
      const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
      nearest = Math.min(nearest, Math.hypot(ax + dx * t - x, az + dz * t - z));
    }
    if (inside) return 0;
  }
  return nearest;
}

describe('the mapped buildings drawn ahead of the rider — #2429', () => {
  for (const [name, fixture, from, to] of [
    ['#1549’s row town', rowTownFixture(), 400, 2_400],
    ['#1581’s mixed town', mixedTownFixture(), 900, 2_000],
  ] as const) {
    it(`draws every front-row building ${String(AHEAD_METRES)} m ahead, on every frame, in ${name}`, () => {
      const run = ride(fixture, from, to);
      // The fixture: front-row buildings ahead on the frames, and the cap binding.
      expect(run.owed).toBeGreaterThan(1_000);
      expect(run.missed).toEqual([]);
      // Within the existing ceilings.
      expect(run.mostBuildings).toBeLessThanOrEqual(MAPPED_BUILDING_MAX);
      expect(run.mostCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
      // The measurement the issue asks for: how far ahead each first drew.
      const at = (share: number) => run.ahead[Math.floor(share * (run.ahead.length - 1))] as number;
      console.log(
        `#2429 ${name}: ${String(run.ahead.length)} buildings first drew ` +
          `${at(0).toFixed(0)} / ${at(0.1).toFixed(0)} / ${at(0.5).toFixed(0)} m ahead ` +
          `(least, tenth, median) at ${String(SPEED)} m/s`,
      );
      expect(at(0.1)).toBeGreaterThanOrEqual(AHEAD_METRES);
    });
  }

  it('ranks a procedural structure by the same road ahead as the buildings it shares the budget with', () => {
    // A signpost beside the road 150 m on, and one structure's worth of
    // budget: ranked by the road ahead it is nearer than every house (5 m
    // against 25 m), so it takes the budget and no house fits. Ranked from the
    // rider it would be 150 m off, behind every house in reach. A signpost,
    // since #2655: a field boundary is not ranked at all (the next case).
    const fixture = rowTownFixture();
    const { profile, origin, corridor } = fixture;
    const land = landClassMask(corridor);
    const { plans } = footprintPlans(corridor, land, profile, origin);
    const buildings = mappedBuildingsOf(plans);
    const start = atStartLine(profile);
    const view = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(1_000) } },
      worldCorridor: corridor,
      landClass: land,
      mappedBuildings: buildings,
    }).mappedBuildings;
    const verge = drawnRoadFrame(profile, origin, 1_150);
    if (view === undefined || verge === undefined) throw new Error('no view on the fixture');
    const signpost = {
      kind: 'signpost' as const,
      x: verge.x + verge.normalX * 5,
      y: 0,
      z: verge.z + verge.normalZ * 5,
      rotation: 0,
      scale: 1,
      variant: 0,
    };
    const belt = new MappedBuildingBelt(buildings, TEXTURES);
    belts.push(belt);
    // The control: with no structure, houses fill the one structure's worth.
    expect(refillMappedBuildings(belt, view, [], 0, 1)).toBe(0);
    expect(belt.stats.buildings).toBeGreaterThan(0);
    belt.invalidate();
    expect(refillMappedBuildings(belt, view, [signpost], 0, 1)).toBe(1);
    expect(belt.stats.buildings).toBe(0);
    // #2655: a hedge in the same place takes only what the houses leave — none.
    for (const kind of ['hedge', 'fence', 'wall'] as const) {
      belt.invalidate();
      expect(refillMappedBuildings(belt, view, [{ ...signpost, kind }], 0, 1), kind).toBe(0);
      expect(belt.stats.buildings, kind).toBeGreaterThan(0);
    }
  });

  it('still measures the near and far level from the rider, though it ranks by the road ahead', () => {
    // A house the road passes, with the rider 200 m off (past the near
    // distance, inside the reach). Ranked by the road it is 0 m away, well
    // inside the near distance; measured from the rider it is far, and a far
    // building is drawn as its far level.
    const { profile, origin, corridor } = rowTownFixture();
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    const buildings = mappedBuildingsOf(plans);
    const [plan] = plans;
    if (plan === undefined) throw new Error('no plans on the fixture');
    const { x, z } = plan.centroid;
    const apart = MAPPED_BUILDING_NEAR_METRES + 50;
    const ahead = new Float32Array([x - 1, z, x + 1, z]);
    const chosen = new MappedSelection();
    selectMappedBuildings(
      buildings,
      x + apart,
      z,
      1e9,
      chosen,
      undefined,
      undefined,
      undefined,
      ahead,
    );
    const at = [...chosen.plans.subarray(0, chosen.count)].indexOf(0);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(chosen.far[at]).toBe(1);
    // The control: the rider beside it, the same house is drawn whole.
    selectMappedBuildings(
      buildings,
      x + 10,
      z,
      1e9,
      chosen,
      undefined,
      undefined,
      undefined,
      ahead,
    );
    expect(chosen.far[[...chosen.plans.subarray(0, chosen.count)].indexOf(0)]).toBe(0);
  });
});

describe('a suburb with mapped houses and no residential land use — #2655', () => {
  // The owner's report: off a major road, a stretch the HUD map shows as a
  // dense grid of houses drew fences, trees and grass. With no
  // `landuse=residential` the ground reads `other`, the procedural fields
  // fenced it, and their pieces 5.6 m off the road ranked ahead of every
  // house 12 m off it for the 36 structures a frame draws. Ridden from the
  // fields into the suburb, so its edge, where #1586 lost a town, is in it,
  // and on into its one-sided stretch, where the fields across the road are
  // kept and still must not outrank the houses. The front row there stands
  // 36 m out, so 40 m is what is owed.
  const run = ride(unzonedSuburbFixture(), UNZONED_SUBURB_FROM - 400, 2_400, HOUSES, 40);

  it('draws every front-row house 100 m ahead, on every frame, the fields ahead of them or not', () => {
    // The fixture: front-row houses ahead on the frames, and fields in them.
    expect(run.owed).toBeGreaterThan(1_000);
    expect(run.boundaries.length).toBeGreaterThan(0);
    expect(run.mostModels).toBeGreaterThan(0);
    expect(run.missed).toEqual([]);
    expect(run.mostBuildings).toBeLessThanOrEqual(MAPPED_BUILDING_MAX);
    expect(run.mostCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
  });

  it('stands no field boundary within 30 m of a mapped house', () => {
    // The issue's 30–40 m: the boundaries kept are the fields' before the suburb.
    const near = run.boundaries.filter((metres) => metres < 30);
    expect(near).toEqual([]);
  });
});
