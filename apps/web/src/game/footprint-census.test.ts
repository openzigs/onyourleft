// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2094: why a mapped place of worship is not drawn, each cause measured on a
 * synthetic corridor by `footprint-census-testing.ts` — the census the
 * orchestrating session runs on the owner's course for its aggregate counts.
 * One church a cause beside a village of houses: in a churchyard, on the
 * road, a large one on invented relief off built-up land, one beyond the
 * reach of every point of the road, one set back behind more houses than the
 * cap, and one beside the road.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature, BuildingType, Landmark } from '@onyourleft/map-features';

import { CENSUS_FATES, censusKindOf, footprintCensus } from './footprint-census-testing';
import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { MAPPED_BUILDING_MAX, MAPPED_BUILDING_REACH_METRES } from './realistic-budget';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);

type Tags = { readonly type: BuildingType | null; readonly landmark: Landmark | null };

const footprint = (
  along: number,
  lateral: number,
  [length, depth]: readonly [number, number],
  tags: Tags,
): BuildingFeature => ({
  ...buildingBeside(profile, origin, [rectangleBeside(along, lateral, length, depth)], 8),
  buildingType: tags.type,
  landmark: tags.landmark,
});

const CHURCH: Tags = { type: 'church', landmark: 'worship' };
const NAVE: readonly [number, number] = [24, 12];

/** Each cause's church, by name, and the corridor they stand in. */
function censusCorridor(): WorldCorridor {
  const houses: BuildingFeature[] = [];
  for (let along = 1_450; along <= 1_750; along += 10) {
    for (const side of [1, -1]) {
      houses.push(footprint(along, side * 25, [8, 6], { type: 'house', landmark: null }));
    }
  }
  const churches = {
    beside: footprint(1_000, 30, NAVE, CHURCH),
    // Set back 300 m, level with the village: more than the cap's houses are nearer at every refill.
    setBack: footprint(1_600, 300, NAVE, CHURCH),
    // In its churchyard: `cemetery` is a park (`land-class.ts`), rule 2.
    churchyard: footprint(500, 30, NAVE, CHURCH),
    // Its front wall on the road's verge: rule 3.
    onRoad: footprint(700, 4, NAVE, CHURCH),
    // A large church on no mapped land, so on the invented relief #1547 levels only on built-up land: rule 4.
    onRelief: footprint(2_500, 150, [36, 16], CHURCH),
    // Kept, levelled, and farther than the reach from every point of the road.
    beyondReach: footprint(1_200, MAPPED_BUILDING_REACH_METRES + 40, NAVE, CHURCH),
  };
  return {
    routeId: 'census',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [
      landBeside(profile, origin, 'landuse', 'residential', 900, 2_300, -460, 460),
      landBeside(profile, origin, 'landuse', 'cemetery', 470, 530, 15, 50),
    ],
    buildings: [...houses, ...Object.values(churches)],
    paths: [],
    streets: [],
  };
}

describe('#2094: the footprint census', () => {
  it('names each cause a mapped church is not drawn for, in counts, and draws the set-back one', () => {
    const corridor = censusCorridor();
    const census = footprintCensus(corridor, landClassMask(corridor), profile, origin);
    expect([...census.keys()]).toStrictEqual(['house', 'worship']);
    expect(census.get('worship')).toStrictEqual({
      'on-excluded-land': 1,
      'on-road': 1,
      'too-steep': 1,
      'too-small': 0,
      'too-large': 0,
      'out-of-reach': 1,
      'never-drawn': 0,
      drawn: 2,
      steeples: 3,
    });
    // The village is more than the cap, and every house is drawn at one refill or another.
    expect(census.get('house')?.drawn).toBeGreaterThan(MAPPED_BUILDING_MAX);
    expect(census.get('house')).toMatchObject({ 'never-drawn': 0, 'out-of-reach': 0 });
  });

  it('counts a building of any other kind in the cap’s shadow as never drawn', () => {
    const corridor = censusCorridor();
    const ordinary: WorldCorridor = {
      ...corridor,
      buildings: corridor.buildings.map((building) =>
        building.buildingType === 'church'
          ? { ...building, buildingType: 'house', landmark: null }
          : building,
      ),
    };
    const census = footprintCensus(ordinary, landClassMask(ordinary), profile, origin);
    expect([...census.keys()]).toStrictEqual(['house']);
    expect(census.get('house')).toMatchObject({
      'on-excluded-land': 1,
      'on-road': 1,
      'too-steep': 1,
      'out-of-reach': 1,
      'never-drawn': 1,
      steeples: 0,
    });
  });

  it('reads a footprint’s kind from its tags alone, and lists every fate once', () => {
    const at = (tags: Tags): string => censusKindOf(footprint(1_000, 30, NAVE, tags));
    expect(at({ type: null, landmark: 'worship' })).toBe('worship');
    expect(at({ type: 'chapel', landmark: null })).toBe('worship');
    expect(at({ type: null, landmark: 'school' })).toBe('civic');
    expect(at({ type: 'garage', landmark: null })).toBe('garage');
    expect(at({ type: null, landmark: null })).toBe('untagged');
    expect(new Set(CENSUS_FATES).size).toBe(CENSUS_FATES.length);
    expect(CENSUS_FATES).not.toContain('kept');
  });
});
