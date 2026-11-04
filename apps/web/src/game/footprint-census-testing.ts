// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What became of each kind of mapped footprint along a ride — #2094: which
 * placement rule dropped it, or, kept, whether a rider ever passed within
 * reach of it and whether a refill ever drew it. Counts only: no coordinate,
 * no place name and no building is named in what it returns.
 *
 * It is how the orchestrating session reports the owner's course in aggregate
 * (the issue's first criterion) without committing it, and how
 * `footprint-census.test.ts` measures each cause on a synthetic corridor.
 *
 * - **Verdicts** are each footprint's own: it is planned alone through
 *   `footprintPlans`, since a verdict depends on no other footprint
 *   (`footprint-buildings.ts`' rules 1 to 6), and the alone counts are checked
 *   against the whole corridor's, or it throws.
 * - **Reach and drawing** are read from the whole corridor's plans, the
 *   index the ride builds (`mapped-buildings.ts` §`mappedBuildingsOf`) and the
 *   selection a refill makes (§`selectMappedBuildings`), with the rider on the
 *   drawn road at every {@link MAPPED_CHUNK_METRES}, the step a refill comes
 *   at. ⚠️ With no procedural structure ranked against them and no house
 *   model loaded, so a ride's frame may draw fewer, never more.
 *
 * ⚠️ **A `-testing.ts` file**, test support to `check-wiring.mjs`: imported by
 * Vitest suites and by nothing that ships.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import { buildingFamilyOf, isWorship, type BuildingFamily } from './building-types';
import {
  FOOTPRINT_VERDICTS,
  footprintPlans,
  type FootprintPlanOptions,
  type FootprintVerdict,
} from './footprint-buildings';
import type { LandClassMask } from './land-class';
import { mappedBuildingsOf, MappedSelection, selectMappedBuildings } from './mapped-buildings';
import {
  MAPPED_BUILDING_REACH_METRES,
  MAPPED_BUILDING_TRIANGLES,
  MAPPED_CHUNK_METRES,
} from './realistic-budget';
import { drawnRoadPosition, type CorridorOrigin } from './terrain';
import type { UrbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/**
 * A footprint's kind, from its mapped tags alone: `worship` for a place of
 * worship (`building-types.ts` §`isWorship`), its family otherwise — `civic`
 * then being a school, a town hall or another civic building — and
 * `untagged` with neither.
 */
export type CensusKind = 'worship' | BuildingFamily | 'untagged';

/**
 * What became of a footprint: the rule that dropped it, or, kept,
 * `out-of-reach` (never within {@link MAPPED_BUILDING_REACH_METRES} of the
 * rider at a refill), `never-drawn` (in reach, and never selected) or `drawn`.
 */
export type CensusFate =
  Exclude<FootprintVerdict, 'kept'> | 'out-of-reach' | 'never-drawn' | 'drawn';

/** Every {@link CensusFate}, in the rules' order and then the ride's. */
export const CENSUS_FATES: readonly CensusFate[] = [
  ...FOOTPRINT_VERDICTS.filter(
    (verdict): verdict is Exclude<FootprintVerdict, 'kept'> => verdict !== 'kept',
  ),
  'out-of-reach',
  'never-drawn',
  'drawn',
];

/** One kind's counts: each fate, and how many of its kept plans have a steeple. */
export type CensusRow = Readonly<Record<CensusFate, number>> & { readonly steeples: number };

/** Every kind met on the corridor, with its row. */
export type FootprintCensus = ReadonlyMap<CensusKind, CensusRow>;

/** A footprint's {@link CensusKind}. */
export function censusKindOf(building: BuildingFeature): CensusKind {
  if (isWorship(building.buildingType, building.landmark)) return 'worship';
  return buildingFamilyOf(building.buildingType, building.landmark) ?? 'untagged';
}

/**
 * The census of `corridor`'s footprints along `profile` — see the module.
 * `land`, `urban` and `options` are what the ride hands `footprintPlans`.
 */
export function footprintCensus(
  corridor: WorldCorridor,
  land: LandClassMask,
  profile: RouteProfile,
  origin: CorridorOrigin,
  urban?: UrbanClassMap,
  options: FootprintPlanOptions = {},
): FootprintCensus {
  const whole = footprintPlans(corridor, land, profile, origin, undefined, urban, options);
  const verdicts = corridor.buildings.map((building) => {
    const alone = footprintPlans(
      { ...corridor, buildings: [building] },
      land,
      profile,
      origin,
      undefined,
      undefined,
      options,
    ).verdicts;
    return FOOTPRINT_VERDICTS.find((verdict) => alone[verdict] === 1) as FootprintVerdict;
  });
  for (const verdict of FOOTPRINT_VERDICTS) {
    const alone = verdicts.filter((each) => each === verdict).length;
    if (alone !== whole.verdicts[verdict]) {
      throw new Error(`the census's ${verdict} count differs from the corridor's`);
    }
  }

  const index = mappedBuildingsOf(whole.plans);
  const selection = new MappedSelection();
  const inReach = new Set<number>();
  const drawn = new Set<number>();
  for (let along = 0; along <= profile.totalDistance; along += MAPPED_CHUNK_METRES) {
    const here = drawnRoadPosition(profile, origin, along);
    whole.plans.forEach((plan, at) => {
      const apart = Math.hypot(plan.centroid.x - here.x, plan.centroid.z - here.z);
      if (apart <= MAPPED_BUILDING_REACH_METRES) inReach.add(at);
    });
    selectMappedBuildings(index, here.x, here.z, MAPPED_BUILDING_TRIANGLES, selection);
    for (const at of selection.plans.subarray(0, selection.count)) drawn.add(at);
  }

  const rows = new Map<CensusKind, Record<CensusFate, number> & { steeples: number }>();
  let kept = 0;
  corridor.buildings.forEach((building, at) => {
    const kind = censusKindOf(building);
    let row = rows.get(kind);
    if (row === undefined) {
      row = { ...Object.fromEntries(CENSUS_FATES.map((fate) => [fate, 0])), steeples: 0 } as Record<
        CensusFate,
        number
      > & { steeples: number };
      rows.set(kind, row);
    }
    const verdict = verdicts[at] as FootprintVerdict;
    if (verdict !== 'kept') {
      row[verdict] += 1;
      return;
    }
    // The kept footprints' plans come first, in the corridor's order (#1637's terraces after).
    const plan = kept;
    kept += 1;
    if (whole.plans[plan]?.steeple === true) row.steeples += 1;
    row[drawn.has(plan) ? 'drawn' : inReach.has(plan) ? 'never-drawn' : 'out-of-reach'] += 1;
  });
  return rows;
}
