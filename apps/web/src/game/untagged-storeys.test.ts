// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1634: the storeys of a footprint with no mapped height, chosen by urban
 * class, use, area and the tagged footprints beside it, seeded — asserted on
 * what `footprintPlans` hands back, the call the press makes. `GameView`'s own
 * press is `untagged-storeys-press.test.tsx`.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import {
  DEFAULT_STOREYS,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_MAX_VERTICES,
  footprintPlans,
  LARGE_COMMERCIAL_AREA,
  storeysFor,
  UNTAGGED_CITY_MAX_STOREYS,
  UNTAGGED_STOREYS,
  untaggedStoreys,
  type FootprintPlan,
} from './footprint-buildings';
import { buildingBeside, footprintFixture, rectangleBeside } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { MAPPED_BUILDING_TRIANGLES } from './realistic-budget';
import { untaggedCorridor, urbanFixture } from './testing/urban-fixtures';
import { urbanClassMap, type UrbanClass, type UrbanClassMap } from './urban-class';

const CLASSES: readonly UrbanClass[] = ['unknown', 'rural', 'village', 'town', 'city-centre'];

/** Every stretch of the route the one class. */
const everywhere = (urban: UrbanClass): UrbanClassMap => ({ classAt: () => urban });

const fixture = footprintFixture();
const mask = landClassMask(fixture.corridor);

/** `buildings` planned in #1540's fixture corridor, every stretch `urban`. */
function plansIn(
  buildings: readonly BuildingFeature[],
  urban: UrbanClassMap | undefined,
): readonly FootprintPlan[] {
  return footprintPlans(
    { ...fixture.corridor, buildings: [...buildings] },
    mask,
    fixture.profile,
    fixture.origin,
    FOOTPRINT_MAX_VERTICES,
    urban,
  ).plans;
}

/** A 10 × 10 m footprint `lateral` metres out at `along`, on the fixture's level stretch. */
const house = (along: number, lateral: number, heightMetres: number | null = null) =>
  buildingBeside(
    fixture.profile,
    fixture.origin,
    [rectangleBeside(along, lateral, 10, 10)],
    heightMetres,
  );

/** The plan whose centroid is nearest the untagged house at `(600, 60)`. */
function theUntagged(plans: readonly FootprintPlan[]): FootprintPlan {
  const [x, z] = [house(600, 60).rings[0]?.[0], house(600, 60).rings[0]?.[1]] as [number, number];
  const near = [...plans].sort(
    (a, b) =>
      Math.hypot(a.centroid.x - x, a.centroid.z - z) -
      Math.hypot(b.centroid.x - x, b.centroid.z - z),
  )[0];
  if (near === undefined) throw new Error('the untagged house was not planned');
  return near;
}

/** A synthetic corridor's plans with no heights mapped, through its own urban class. */
function untaggedPlans(kind: 'village' | 'city-commerce') {
  const built = urbanFixture([{ kind, from: 1_000, to: 1_400 }]);
  const corridor = untaggedCorridor(built.corridor);
  const land = landClassMask(corridor);
  const urban = urbanClassMap(corridor, land, built.profile);
  return footprintPlans(corridor, land, built.profile, built.origin, FOOTPRINT_MAX_VERTICES, urban)
    .plans;
}

describe('untagged footprints by urban class — the read path (#1634)', () => {
  it('plans every untagged footprint of a city centre at 3 or 4 storeys, residential ones too', () => {
    const plans = untaggedPlans('city-commerce');
    expect(plans.length).toBeGreaterThan(100);
    for (const plan of plans) {
      expect(plan.urban).toBe('city-centre');
      expect(plan.storeys).toBeGreaterThanOrEqual(3);
      expect(plan.storeys).toBeLessThanOrEqual(4);
    }
    // City-commerce is residential beyond 150 m of the road: houses, as well as shops.
    expect(plans.some((plan) => plan.cladding.wall === 'clapboard')).toBe(true);
    // Seeded, not one number: both ends of the range are drawn.
    expect(new Set(plans.map((plan) => plan.storeys))).toEqual(new Set([3, 4]));
  });

  it('plans the same untagged houses in a village at 1 or 2 storeys', () => {
    const plans = untaggedPlans('village');
    expect(plans.length).toBeGreaterThan(50);
    for (const plan of plans) {
      expect(plan.urban).toBe('village');
      expect(plan.storeys).toBeGreaterThanOrEqual(1);
      expect(plan.storeys).toBeLessThanOrEqual(2);
    }
    expect(new Set(plans.map((plan) => plan.storeys))).toEqual(new Set([1, 2]));
  });

  it('chooses within each class’s row, and the large commercial row only for commerce', () => {
    for (const urban of CLASSES) {
      const row = UNTAGGED_STOREYS[urban];
      for (const share of [0, 0.25, 0.5, 0.75, 0.999_999]) {
        const residential = untaggedStoreys(urban, 'residential', 100, undefined, share);
        expect(residential).toBeGreaterThanOrEqual(row.residential[0]);
        expect(residential).toBeLessThanOrEqual(row.residential[1]);
        const large = untaggedStoreys(urban, 'commercial', LARGE_COMMERCIAL_AREA, undefined, share);
        expect(large).toBeGreaterThanOrEqual(row.large[0]);
        expect(large).toBeLessThanOrEqual(row.large[1]);
        const industrial = untaggedStoreys(urban, 'industrial', 5_000, undefined, share);
        expect(industrial).toBeGreaterThanOrEqual(row.other[0]);
        expect(industrial).toBeLessThanOrEqual(row.other[1]);
      }
    }
    // A city centre's large shop is 4 or 5; a small one, and a large factory, 3 or 4.
    expect(untaggedStoreys('city-centre', 'commercial', 1_500, undefined, 0.999)).toBe(5);
    expect(untaggedStoreys('city-centre', 'commercial', 1_499, undefined, 0.999)).toBe(4);
    expect(untaggedStoreys('city-centre', 'industrial', 1_500, undefined, 0.999)).toBe(4);
    expect(untaggedStoreys('town', 'commercial', 100, undefined, 0.999)).toBe(4);
    expect(untaggedStoreys('town', 'residential', 100, undefined, 0.999)).toBe(3);
  });
});

describe('tagged neighbours win — two or more within 100 m (#1634)', () => {
  // Three tagged 30 m (10-storey) footprints round the untagged one, all within 100 m.
  const towers = [house(560, 60, 30), house(640, 60, 30), house(600, 120, 30)];

  it('plans an untagged footprint beside three 10-storey ones in a city centre at 9 to 11', () => {
    expect(storeysFor(30)).toBe(10);
    const plan = theUntagged(plansIn([house(600, 60), ...towers], everywhere('city-centre')));
    expect(plan.storeys).toBeGreaterThanOrEqual(9);
    expect(plan.storeys).toBeLessThanOrEqual(11);
    // ...and a tower is concrete, as a tagged one would be.
    expect(plan.surfaces.wall).toBe('concrete');
  });

  it('keeps to the table beside ONE tagged tower: the clamp needs two', () => {
    const plan = theUntagged(
      plansIn([house(600, 60), towers[0] as BuildingFeature], everywhere('city-centre')),
    );
    expect(plan.storeys).toBeGreaterThanOrEqual(3);
    expect(plan.storeys).toBeLessThanOrEqual(4);
  });

  it('counts no tower beyond 100 m', () => {
    const far = [house(450, 60, 30), house(750, 60, 30), house(600, 200, 30)];
    const plan = theUntagged(plansIn([house(600, 60), ...far], everywhere('city-centre')));
    expect(plan.storeys).toBeLessThanOrEqual(4);
  });

  it('goes no higher than the table outside a city centre, nor past 12 inside one', () => {
    for (const urban of ['rural', 'village', 'town'] as const) {
      const plan = theUntagged(plansIn([house(600, 60), ...towers], everywhere(urban)));
      expect(plan.storeys).toBe(UNTAGGED_STOREYS[urban].residential[1]);
    }
    expect(untaggedStoreys('city-centre', 'residential', 100, 20, 0)).toBe(
      UNTAGGED_CITY_MAX_STOREYS,
    );
    // Low tagged neighbours bring a city centre's untagged one down to within a storey.
    expect(untaggedStoreys('city-centre', 'residential', 100, 1, 0.999)).toBe(2);
    // An even count's median between two storeys keeps within a storey of both.
    expect(untaggedStoreys('city-centre', 'residential', 100, 9.5, 0)).toBe(9);
  });

  it('leaves `unknown` at today’s 2, beside towers or not', () => {
    const plan = theUntagged(plansIn([house(600, 60), ...towers], everywhere('unknown')));
    expect(plan.storeys).toBe(DEFAULT_STOREYS);
  });
});

describe('seeded — lap two is lap one (#1634)', () => {
  it('plans the same corridor twice to the same storeys for every footprint', () => {
    const once = untaggedPlans('city-commerce').map((plan) => plan.storeys);
    const twice = untaggedPlans('city-commerce').map((plan) => plan.storeys);
    expect(twice).toEqual(once);
  });
});

describe('unchanged with no data, and tagged heights untouched (#1634)', () => {
  it('plans every untagged footprint at 2 with no urban class, as today', () => {
    const built = urbanFixture([{ kind: 'city-commerce', from: 1_000, to: 1_400 }]);
    const corridor = untaggedCorridor(built.corridor);
    const { plans } = footprintPlans(
      corridor,
      landClassMask(corridor),
      built.profile,
      built.origin,
    );
    expect(plans.length).toBeGreaterThan(100);
    expect(new Set(plans.map((plan) => plan.storeys))).toEqual(new Set([DEFAULT_STOREYS]));
  });

  it('plans a 9 m footprint at 3 storeys in every class, beside towers or not', () => {
    const towers = [house(560, 60, 30), house(640, 60, 30), house(600, 120, 30)];
    for (const urban of CLASSES) {
      const plan = theUntagged(plansIn([house(600, 60, 9), ...towers], everywhere(urban)));
      expect(plan.storeys).toBe(3);
    }
  });
});

describe('the triangles of a taller box — #1634', () => {
  it('draws one footprint at 2 storeys and at 8 in the same triangles, within the budgets', () => {
    // 25 × 20 m: past a gable's area, so flat-roofed at both heights.
    const box = (heightMetres: number) =>
      plansIn(
        [
          buildingBeside(
            fixture.profile,
            fixture.origin,
            [rectangleBeside(600, 60, 25, 20)],
            heightMetres,
          ),
        ],
        undefined,
      )[0];
    const low = box(6);
    const high = box(24);
    expect(low?.storeys).toBe(2);
    expect(high?.storeys).toBe(8);
    expect(high?.triangleCount).toBe(low?.triangleCount);
    expect(high?.farTriangleCount).toBe(low?.farTriangleCount);
    for (const plan of [low, high]) {
      expect(plan?.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan?.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      expect(plan?.triangleCount).toBeLessThanOrEqual(MAPPED_BUILDING_TRIANGLES);
    }
  });
});
