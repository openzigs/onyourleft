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
import { mixedTownFixture, rowTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_CHUNK_METRES,
  REALISTIC_STRUCTURE_ITEMS,
} from './realistic-budget';
import { nearestOnDrawnRoad } from './road-grid';
import { sceneFrame } from './scene';
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

/** A ride through a fixture town, read back off the belt: what it drew, frame by frame. */
function ride(fixture: ReturnType<typeof rowTownFixture>, from: number, to: number) {
  const { profile, origin, corridor } = fixture;
  const land = landClassMask(corridor);
  const urban = urbanClassMap(corridor, land, profile);
  const { plans } = footprintPlans(corridor, land, profile, origin, FOOTPRINT_MAX_VERTICES, urban);
  const buildings = mappedBuildingsOf(plans);
  const town = mappedTown(corridor, plans, urban);
  const belt = new MappedBuildingBelt(buildings, TEXTURES);
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
  let owed = 0;
  for (let distance = from; distance < to; distance += STEP) {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      worldCorridor: corridor,
      landClass: land,
      mappedBuildings: buildings,
      mappedTown: town,
      structureItems: REALISTIC_STRUCTURE_ITEMS,
    });
    const view = frame.mappedBuildings;
    if (view === undefined) throw new Error('no mapped buildings in the frame');
    refillMappedBuildings(
      belt,
      view,
      frame.scatter,
      frame.billboards.length,
      REALISTIC_STRUCTURE_ITEMS,
    );
    mostBuildings = Math.max(mostBuildings, belt.stats.buildings);
    mostCalls = Math.max(mostCalls, belt.stats.drawCalls);
    const drawn = new Set<number>();
    for (let place = 0; place < belt.stats.buildings; place += 1) {
      const at = belt.drawnAt(place);
      if (at !== undefined) drawn.add(at.plan);
    }
    for (const index of drawn) {
      const at = place[index];
      if (at !== undefined && !firstAhead.has(index)) firstAhead.set(index, at.along - distance);
    }
    place.forEach((at, index) => {
      if (at === undefined || Math.abs(at.lateral) > FRONT_METRES) return;
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
  return { missed, owed, ahead, mostBuildings, mostCalls };
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
    // A hedge beside the road 150 m on, and one structure's worth of budget:
    // ranked by the road ahead it is nearer than every house (5 m against
    // 25 m), so it takes the budget and no house fits. Ranked from the rider
    // it would be 150 m off, behind every house in reach.
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
    const hedge = {
      kind: 'hedge' as const,
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
    expect(refillMappedBuildings(belt, view, [hedge], 0, 1)).toBe(1);
    expect(belt.stats.buildings).toBe(0);
  });
});
