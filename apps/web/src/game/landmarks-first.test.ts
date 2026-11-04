// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2094: a refill takes the nearest {@link MAPPED_LANDMARKS_AHEAD} landmarks
 * in reach before every other mapped building, so a church set back from the
 * road survives {@link MAPPED_BUILDING_MAX} where the houses nearer the rider
 * used to fill it. Read back the way the ride reads it: the plans
 * `footprintPlans` makes, indexed by `mappedBuildingsOf`, and the set
 * `selectMappedBuildings` hands the belt.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature, BuildingType, Landmark } from '@onyourleft/map-features';

import { footprintPlans, type FootprintPlan } from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  rectangleBeside,
  starBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import {
  MAPPED_LANDMARKS_AHEAD,
  mappedBuildingsOf,
  MappedSelection,
  NO_RIVALS,
  selectMappedBuildings,
  type MappedBuildings,
  type RivalStructures,
} from './mapped-buildings';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_REACH_METRES,
  MAPPED_BUILDING_TRIANGLES,
} from './realistic-budget';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin, drawnRoadPosition } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);
/** Where the rider is: level with the village's middle. */
const RIDER_ALONG = 1_600;
const rider = drawnRoadPosition(profile, origin, RIDER_ALONG);

type Tags = { readonly type: BuildingType | null; readonly landmark: Landmark | null };
const CHURCH: Tags = { type: 'church', landmark: 'worship' };
const HOUSE: Tags = { type: 'house', landmark: null };

const tagged = (
  corners: readonly (readonly [number, number])[],
  tags: Tags,
  height = 6,
): BuildingFeature => ({
  ...buildingBeside(profile, origin, [corners], height),
  buildingType: tags.type,
  landmark: tags.landmark,
});

/** A house every 10 m from 1 450 to 1 750 m, both sides, 25 m out: 62, far more than the cap. */
function village(): BuildingFeature[] {
  const houses: BuildingFeature[] = [];
  for (let along = 1_450; along <= 1_750; along += 10) {
    for (const side of [1, -1]) houses.push(tagged(rectangleBeside(along, side * 25, 8, 6), HOUSE));
  }
  return houses;
}

/** The village, then `extra`, on residential land wide enough to level them all; planned and indexed. */
function plannedWith(extra: readonly BuildingFeature[]): {
  readonly buildings: MappedBuildings;
  readonly extras: readonly number[];
} {
  const houses = village();
  const corridor: WorldCorridor = {
    routeId: 'landmarks-first',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 900, 2_300, -460, 460)],
    buildings: [...houses, ...extra],
    paths: [],
    streets: [],
  };
  const { plans, verdicts } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
  // Every footprint kept, so the plans are the buildings, in order.
  expect(verdicts.kept).toBe(houses.length + extra.length);
  return {
    buildings: mappedBuildingsOf(plans),
    extras: extra.map((_, at) => houses.length + at),
  };
}

function select(
  buildings: MappedBuildings,
  budget: number = MAPPED_BUILDING_TRIANGLES,
  rivals: RivalStructures = NO_RIVALS,
): MappedSelection {
  const selection = new MappedSelection();
  selectMappedBuildings(
    buildings,
    rider.x,
    rider.z,
    budget,
    selection,
    MAPPED_BUILDING_DRAW_CALLS,
    rivals,
  );
  return selection;
}

const drawn = (selection: MappedSelection): readonly number[] => [
  ...selection.plans.subarray(0, selection.count),
];

const apartOf = (plan: FootprintPlan): number =>
  Math.hypot(plan.centroid.x - rider.x, plan.centroid.z - rider.z);

describe('#2094: a landmark in reach is drawn ahead of the houses nearer the rider', () => {
  it('draws a mapped church 300 m out, where a house in its place loses to the cap', () => {
    const church = plannedWith([tagged(rectangleBeside(RIDER_ALONG, 300, 24, 12), CHURCH, 8)]);
    const plan = church.buildings.plans[church.extras[0] as number] as FootprintPlan;
    expect(plan.steeple).toBe(true);
    expect(apartOf(plan)).toBeLessThan(MAPPED_BUILDING_REACH_METRES);
    const selection = select(church.buildings);
    expect(selection.count).toBe(MAPPED_BUILDING_MAX);
    expect(drawn(selection)).toContain(church.extras[0]);
    expect(selection.surfaces.length).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    // The cap bites: an ordinary house of the same footprint, in the same place, is not drawn.
    const house = plannedWith([tagged(rectangleBeside(RIDER_ALONG, 300, 24, 12), HOUSE, 8)]);
    expect(drawn(select(house.buildings))).not.toContain(house.extras[0]);
    // And the church took the farthest house's place, not a nearer one's.
    const houses = drawn(select(house.buildings));
    const kept = drawn(selection);
    const lost = houses.filter((index) => !kept.includes(index));
    expect(lost).toHaveLength(1);
    const farthest = Math.max(
      ...houses.map((index) => apartOf(house.buildings.plans[index] as FootprintPlan)),
    );
    expect(apartOf(church.buildings.plans[lost[0] as number] as FootprintPlan)).toBe(farthest);
  });

  it(`takes at most ${String(MAPPED_LANDMARKS_AHEAD)} landmarks ahead, the nearest`, () => {
    const alongs = [1_600, 1_620, 1_650, 1_690, 1_740, 1_800];
    const churches = plannedWith(
      alongs.map((along) => tagged(rectangleBeside(along, 300, 24, 12), CHURCH, 8)),
    );
    const selection = drawn(select(churches.buildings));
    expect(selection).toHaveLength(MAPPED_BUILDING_MAX);
    expect(churches.extras.filter((index) => selection.includes(index))).toStrictEqual(
      churches.extras.slice(0, MAPPED_LANDMARKS_AHEAD),
    );
  });

  it('ranks no rival in ahead of the houses nearer than it', () => {
    const church = plannedWith([tagged(rectangleBeside(RIDER_ALONG, 300, 24, 12), CHURCH, 8)]);
    const alone = select(church.buildings);
    // Exactly the budget the buildings take, and hedges from 100 m out to the church.
    const distances = Float64Array.from({ length: 20 }, (_, at) => 100 + at * 10);
    const rivals: RivalStructures = { distances, count: distances.length, triangles: 50 };
    const ranked = select(church.buildings, alone.triangles, rivals);
    expect(drawn(ranked)).toStrictEqual(drawn(alone));
    expect(ranked.rivals).toBe(0);
  });

  it('skips a landmark that does not fit the budget, and draws the houses that do', () => {
    // A many-sided cathedral near enough to be drawn whole: more triangles than a house.
    const cathedral = plannedWith([
      tagged(starBeside(RIDER_ALONG, 120, 20, 12, 24), { type: 'cathedral', landmark: null }, 24),
    ]);
    const plan = cathedral.buildings.plans[cathedral.extras[0] as number] as FootprintPlan;
    const nearest = cathedral.buildings.plans[0] as FootprintPlan;
    expect(plan.triangleCount).toBeGreaterThan(nearest.triangleCount);
    const selection = select(cathedral.buildings, plan.triangleCount - 1);
    expect(drawn(selection)).not.toContain(cathedral.extras[0]);
    expect(selection.count).toBeGreaterThan(0);
  });
});
