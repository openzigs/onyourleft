// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1793: a mapped house's start year narrows its archetype to those of its
 * era (`house-archetypes.ts` §`ARCHETYPE_ERAS`), and only narrows it. Held
 * where a rider sees it: the plans `footprintPlans` returns over #1793's dated
 * road and the roof, porch and wall vertex floats the belt uploads — and, for
 * the rule that a year never widens the choice, the classifier over every
 * archetype's footprint and every year from 1800 to 2025.
 *
 * ⚠️ The issue's pair, a one-storey rectangle that #1782 admits as both a
 * bungalow and a ranch, does not exist under #1782's tuned bands: a bungalow
 * is deeper than wide and a ranch is not. The pair that does is a rural,
 * near-square, two-storey house, admitted as a farmhouse and a Foursquare
 * (`footprint-fixtures-testing.ts` §`DATED_HOUSES`).
 */

import type { BuildingFeature } from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import {
  CLAD_CLAPBOARD,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  STYLE_BRICK_FOUNDATION,
  STYLE_OFFSET,
  type FootprintPlan,
  type FootprintPlanOptions,
} from './footprint-buildings';
import {
  DATED_HOUSES,
  datedStreetFixture,
  mixedTownFixture,
  planFingerprint,
} from './footprint-fixtures-testing';
import {
  ARCHETYPE_CUES,
  archetypeCandidates,
  HOUSE_ARCHETYPES,
  houseArchetypeOf,
  type ArchetypeInput,
  type HouseArchetype,
} from './house-archetypes';
import { landClassMask } from './land-class';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** #1793's dated road, with every footprint's year as `year` gives it, planned with its class. */
function planRoad(
  options: FootprintPlanOptions = {},
  year: (building: BuildingFeature) => number | null = (building) => building.startYear,
): { readonly plans: readonly FootprintPlan[]; readonly years: readonly (number | null)[] } {
  const road = datedStreetFixture();
  const corridor: WorldCorridor = {
    ...road.corridor,
    buildings: road.corridor.buildings.map((building) => ({
      ...building,
      startYear: year(building),
    })),
  };
  const land = landClassMask(corridor);
  const { plans } = footprintPlans(
    corridor,
    land,
    road.profile,
    road.origin,
    undefined,
    urbanClassMap(corridor, land, road.profile),
    options,
  );
  expect(plans).toHaveLength(corridor.buildings.length);
  return { plans, years: corridor.buildings.map((building) => building.startYear) };
}

/** The plans of the road's near-square houses (its first three rows), with their years. */
function squareHouses(
  planned: ReturnType<typeof planRoad>,
): (readonly [FootprintPlan, number | null])[] {
  return planned.plans
    .map((plan, index) => [plan, planned.years[index] ?? null] as const)
    .filter((_, index) => index % DATED_HOUSES.length < 3);
}

/** Whether a gable wall stands above the eaves: a wall vertex higher than they are. */
const hasGable = (plan: FootprintPlan): boolean => {
  const floats = plan.triangles.wall;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if ((floats[at + 1] as number) > plan.eaves + 1e-3) return true;
  }
  return false;
};

/** The steepest roof face's pitch, degrees, read off the roof triangles' normals. */
function steepestPitch(plan: FootprintPlan): number {
  const floats = plan.triangles.roof;
  let least = 1;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const ny = floats[at + 4] as number;
    if (ny > 0.05) least = Math.min(least, ny);
  }
  return (Math.acos(least) * 180) / Math.PI;
}

/** Whether any wall vertex is clad in clapboard over a brick foundation. */
const sidingOnBrick = (plan: FootprintPlan): boolean => {
  const floats = plan.triangles.wall;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const clad = Math.floor((floats[at + STYLE_OFFSET] as number) + 0.0001);
    const flags = Math.round(floats[at + STYLE_OFFSET + 1] as number);
    if (clad === CLAD_CLAPBOARD && (flags & STYLE_BRICK_FOUNDATION) !== 0) return true;
  }
  return false;
};

describe('#1793: a mapped start year, read back from the plan', () => {
  it('plans the near-square house of 1915 a Foursquare and that of 1965 a farmhouse', () => {
    const houses = squareHouses(planRoad());
    const of1915 = houses.filter(([, year]) => year === 1915).map(([plan]) => plan);
    const of1965 = houses.filter(([, year]) => year === 1965).map(([plan]) => plan);
    expect(of1915.length).toBeGreaterThan(1);
    expect(of1965.length).toBeGreaterThan(1);
    for (const plan of of1915) {
      // A Foursquare: a hip with no gable wall, its one hipped dormer, two storeys.
      expect(plan.archetype).toBe('foursquare');
      expect(plan.roof).toBe('hip');
      expect(hasGable(plan)).toBe(false);
      expect(plan.dormers).toBe(1);
      expect(plan.triangles.dormer.length).toBeGreaterThan(0);
      expect(plan.storeys).toBe(2);
    }
    for (const plan of of1965) {
      // A farmhouse: a steep gable over clapboard on brick.
      expect(plan.archetype).toBe('farmhouse');
      expect(hasGable(plan)).toBe(true);
      expect(steepestPitch(plan)).toBeGreaterThanOrEqual(39.5);
      expect(sidingOnBrick(plan)).toBe(true);
    }
    // Control: undated, the same footprint is the farmhouse #1782 chose.
    for (const [plan, year] of houses) {
      if (year === null) expect(plan.archetype).toBe('farmhouse');
    }
  });

  it('ignores a year that rules out every candidate: the shape-only plan, float for float', () => {
    const dated = planRoad();
    const undated = planRoad({}, (building) =>
      building.startYear === 1960 ? null : building.startYear,
    );
    let bungalows = 0;
    dated.plans.forEach((plan, index) => {
      if (dated.years[index] !== 1960) return;
      bungalows += 1;
      expect(plan.archetype).toBe('bungalow');
      expect(planFingerprint([plan])).toBe(
        planFingerprint([undated.plans[index] as FootprintPlan]),
      );
    });
    expect(bungalows).toBeGreaterThan(1);
  });

  it('keeps every plan of the road among the archetypes its footprint admits, for every year 1800 to 2025', () => {
    for (let year = 1_800; year <= 2_025; year += 5) {
      const { plans } = planRoad({}, () => year);
      plans.forEach((plan, index) => {
        const allowed =
          index % DATED_HOUSES.length < 3 ? ['farmhouse', 'foursquare'] : ['bungalow'];
        expect(allowed, `${String(year)}`).toContain(plan.archetype);
      });
    }
  });

  it('ignores every year with `mappedStartYear: false`, and with the archetypes off', () => {
    const undated = planFingerprint(planRoad({}, () => null).plans);
    expect(planFingerprint(planRoad({ mappedStartYear: false }).plans)).toBe(undated);
    expect(planFingerprint(planRoad({ houseArchetypes: false }).plans)).toBe(
      planFingerprint(planRoad({ houseArchetypes: false }, () => null).plans),
    );
    // Not vacuous: on, the road plans otherwise.
    expect(planFingerprint(planRoad().plans)).not.toBe(undated);
  });
});

/** A footprint each archetype's cue describes, and the farmhouse–Foursquare and ranch–Cape overlaps. */
function everyArchetypesFootprint(): readonly ArchetypeInput[] {
  const base = {
    rectangularity: 1,
    residential: true,
    terraced: false,
    pitched: true,
  } as const;
  const inputs: ArchetypeInput[] = [];
  for (const archetype of HOUSE_ARCHETYPES) {
    const cue = ARCHETYPE_CUES[archetype];
    const [leastArea, mostArea] = cue.area;
    const [leastAspect, mostAspect] = cue.aspect;
    for (const area of [leastArea, (leastArea + mostArea) / 2, mostArea]) {
      for (const aspect of [
        leastAspect,
        Math.min(leastAspect + 0.2, (leastAspect + mostAspect) / 2),
      ]) {
        for (const shape of cue.shapes) {
          for (const deep of [true, false]) {
            for (const urban of ['rural', 'village', 'town', 'unknown'] as const) {
              inputs.push({ ...base, area, aspect, shape, storeys: cue.storeys, deep, urban });
            }
          }
        }
      }
    }
  }
  return inputs;
}

describe('#1793: a year never widens the choice', () => {
  it('chooses, for every archetype’s footprint and every year 1800 to 2025, one the untagged rule admits', () => {
    const inputs = everyArchetypesFootprint();
    const chosen = new Set<HouseArchetype>();
    let narrowed = 0;
    for (const input of inputs) {
      const candidates = archetypeCandidates(input);
      const untagged = houseArchetypeOf(input);
      expect(untagged).toBe(candidates[0] ?? 'unknown');
      for (let year = 1_800; year <= 2_025; year += 5) {
        const dated = houseArchetypeOf(input, HOUSE_ARCHETYPES, year);
        if (candidates.length === 0) expect(dated).toBe('unknown');
        else expect(candidates).toContain(dated);
        if (dated !== untagged) narrowed += 1;
        chosen.add(dated);
      }
    }
    // Not vacuous: every archetype is chosen, and some year moves some footprint.
    for (const archetype of HOUSE_ARCHETYPES) expect(chosen.has(archetype)).toBe(true);
    expect(narrowed).toBeGreaterThan(0);
  });
});

describe('#1793: the era boundaries, and the year that leaves no candidate', () => {
  const base = {
    rectangularity: 1,
    residential: true,
    terraced: false,
    pitched: true,
    shape: 'rectangle',
    urban: 'rural',
  } as const;
  /** Admits the farmhouse and the Foursquare; the Foursquare is built 1895 to 1930, inclusive. */
  const farmhouseOrFoursquare: ArchetypeInput = {
    ...base,
    area: 80,
    aspect: 1,
    storeys: 2,
    deep: true,
  };
  /** Admits the ranch (first) and the Cape (built from 1930): the 120 m² edge between them. */
  const ranchOrCape: ArchetypeInput = {
    ...base,
    area: 120,
    aspect: 1.8,
    storeys: 1,
    deep: false,
  };

  it('treats both ends of an era as inside it', () => {
    const at = (year: number) => houseArchetypeOf(farmhouseOrFoursquare, HOUSE_ARCHETYPES, year);
    expect(at(1_894)).toBe('farmhouse');
    expect(at(1_895)).toBe('foursquare');
    expect(at(1_930)).toBe('foursquare');
    expect(at(1_931)).toBe('farmhouse');
    const capeAt = (year: number) => houseArchetypeOf(ranchOrCape, HOUSE_ARCHETYPES, year);
    expect(capeAt(1_929)).toBe('ranch');
    expect(capeAt(1_930)).toBe('cape');
  });

  it('gives a year that rules out every candidate the untagged result, not another candidate', () => {
    expect(archetypeCandidates(ranchOrCape)).toEqual(['ranch', 'cape']);
    const untagged = houseArchetypeOf(ranchOrCape);
    expect(untagged).toBe('ranch');
    for (const year of [1_800, 1_900, 1_929]) {
      expect(houseArchetypeOf(ranchOrCape, HOUSE_ARCHETYPES, year)).toBe(untagged);
    }
  });
});

/**
 * {@link mixedTownFixture}'s plans' fingerprint, paint included, planned with its urban class,
 * measured on `main` at b15b8ce3 — before #1793. No footprint there carries a year.
 */
const MIXED_TOWN_BEFORE_1793 = '2b5b40a1';

describe('#1793: an undated town plans as before', () => {
  it('plans the mixed town as before #1793, with the lever on and off', () => {
    const town = mixedTownFixture();
    expect(town.corridor.buildings.every((building) => (building.startYear ?? null) === null)).toBe(
      true,
    );
    const land = landClassMask(town.corridor);
    const urban = urbanClassMap(town.corridor, land, town.profile);
    for (const options of [{}, { mappedStartYear: false }]) {
      const { plans } = footprintPlans(
        town.corridor,
        land,
        town.profile,
        town.origin,
        undefined,
        urban,
        options,
      );
      expect(planFingerprint(plans)).toBe(MIXED_TOWN_BEFORE_1793);
    }
  });
});
