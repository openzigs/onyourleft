// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2657: a protected area's boundary — the archive's `forest` for a Forest
 * Service area, `national_park`, `nature_reserve` — is not a forest. A town
 * inside one keeps its houses; a mapped `wood` still drops them (ADR 0054
 * D-5.2, as its 2026-11-15 amendment narrows it).
 *
 * Every assertion reads back through the path the ride uses: the mask's
 * `classAt` and `protectedArea`, `footprintPlans`' verdicts, the belt's
 * `selectMappedBuildings` at the rider, and `scatterAt` with
 * `clearOfMappedBuildings` for what grows. Each has its control: the same
 * square drawn as a mapped `wood`, which must drop what the change keeps.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import { footprintPlans, type FootprintVerdict, FOOTPRINT_VERDICTS } from './footprint-buildings';
import {
  besideRoad,
  NATIONAL_FOREST_TOWN_VERDICTS,
  nationalForestTownFixture,
} from './footprint-fixtures-testing';
import { kindAt, landClassMask, PROTECTED_AREA_KINDS, type LandClassMask } from './land-class';
import {
  clearOfMappedBuildings,
  mappedBuildingsOf,
  MappedSelection,
  selectMappedBuildings,
} from './mapped-buildings';
import { MAPPED_BUILDING_TRIANGLES } from './realistic-budget';
import { scatterAt, scatterSeed, type ScatterItem } from './scatter';

const forest = nationalForestTownFixture();
const forestMask = landClassMask(forest.corridor);
const wood = nationalForestTownFixture('wood');
const woodMask = landClassMask(wood.corridor);

/** A point `lateral` metres off the fixture's road at `along`. */
const at = (along: number, lateral: number): readonly [number, number] =>
  besideRoad(forest.profile, forest.origin, along, lateral);

/** One footprint, planned alone in `fixture`'s corridor: its verdict. */
function verdictOf(
  fixture: ReturnType<typeof nationalForestTownFixture>,
  land: LandClassMask,
  building: BuildingFeature,
): FootprintVerdict {
  const { verdicts } = footprintPlans(
    { ...fixture.corridor, buildings: [building] },
    land,
    fixture.profile,
    fixture.origin,
  );
  return FOOTPRINT_VERDICTS.find((verdict) => verdicts[verdict] > 0) as FootprintVerdict;
}

const VEGETATION = new Set(['tree-broadleaf', 'tree-conifer', 'shrub', 'rock']);

describe('the land class under a protected area’s boundary — #2657', () => {
  it('names the three kinds, and only those', () => {
    expect([...PROTECTED_AREA_KINDS].sort()).toStrictEqual([
      'forest',
      'national_park',
      'nature_reserve',
    ]);
  });

  it('reads a residential block inside the forest as built-up, and the forest round it as wood', () => {
    expect(forestMask.classAt(...at(500, 100))).toBe('built-up');
    expect(forestMask.protectedArea(...at(500, 100))).toBe(false);
    expect(kindAt(forest.corridor, ...at(500, 100))).toBe('residential');
    // The forest alone: still a wood to what grows, and a protected area.
    expect(forestMask.classAt(...at(1_300, 100))).toBe('wood');
    expect(forestMask.protectedArea(...at(1_300, 100))).toBe(true);
    expect(kindAt(forest.corridor, ...at(1_300, 100))).toBe('forest');
    // Control: a mapped wood over the block is a wood, as it always was.
    expect(woodMask.classAt(...at(500, 100))).toBe('wood');
    expect(woodMask.protectedArea(...at(1_300, 100))).toBe(false);
  });

  it('keeps a mapped wood inside the forest a wood, and reads a national park and a nature reserve as protected parks', () => {
    expect(forestMask.classAt(...at(2_150, -100))).toBe('wood');
    expect(forestMask.protectedArea(...at(2_150, -100))).toBe(false);
    expect(kindAt(forest.corridor, ...at(2_150, -100))).toBe('wood');
    for (const [along, lateral] of [
      [2_500, 100],
      [2_750, -100],
    ] as const) {
      expect(forestMask.classAt(...at(along, lateral))).toBe('park');
      expect(forestMask.protectedArea(...at(along, lateral))).toBe(true);
    }
  });

  it('is false off every covered chunk', () => {
    expect(forestMask.protectedArea(5_000, 5_000)).toBe(false);
    expect(forestMask.protectedArea(Number.NaN, 0)).toBe(false);
  });
});

describe('a town inside a national forest keeps its houses — #2657', () => {
  it('comes to each named footprint’s verdict', () => {
    for (const [name, expected] of Object.entries(NATIONAL_FOREST_TOWN_VERDICTS)) {
      const building = forest.named[name as keyof typeof NATIONAL_FOREST_TOWN_VERDICTS];
      expect(verdictOf(forest, forestMask, building), name).toBe(expected);
    }
  });

  it('control: the same square drawn as a mapped wood drops every house inside it', () => {
    for (const name of ['onResidential', 'onForestOnly', 'inMappedWood'] as const) {
      expect(verdictOf(wood, woodMask, wood.named[name]), name).toBe('on-excluded-land');
    }
  });

  it('control: a mapped park where the national park and the nature reserve are drops their houses', () => {
    const parks = {
      ...forest,
      corridor: {
        ...forest.corridor,
        landUse: forest.corridor.landUse.map((feature) =>
          feature.kind === 'national_park' || feature.kind === 'nature_reserve'
            ? { ...feature, kind: 'park' }
            : feature,
        ),
      },
    };
    const parksMask = landClassMask(parks.corridor);
    for (const name of ['inNationalPark', 'inNatureReserve'] as const) {
      expect(verdictOf(parks, parksMask, parks.named[name]), name).toBe('on-excluded-land');
    }
  });

  it('plans the whole town, and the belt draws houses at the rider', () => {
    const { plans, verdicts } = footprintPlans(
      forest.corridor,
      forestMask,
      forest.profile,
      forest.origin,
    );
    // Every footprint but the one in the mapped wood.
    expect(verdicts.kept).toBe(forest.corridor.buildings.length - 1);
    expect(verdicts['on-excluded-land']).toBe(1);
    const buildings = mappedBuildingsOf(plans);
    for (const along of [500, 1_300]) {
      const selection = new MappedSelection();
      const [x, z] = at(along, 0);
      selectMappedBuildings(buildings, x, z, MAPPED_BUILDING_TRIANGLES, selection);
      expect(selection.count, `at ${along} m`).toBeGreaterThan(5);
    }
    // Control: as a mapped wood, nothing is drawn at the rider in the forest-only stretch.
    const woodPlans = footprintPlans(wood.corridor, woodMask, wood.profile, wood.origin).plans;
    const selection = new MappedSelection();
    selectMappedBuildings(
      mappedBuildingsOf(woodPlans),
      ...at(1_300, 0),
      MAPPED_BUILDING_TRIANGLES,
      selection,
    );
    expect(selection.count).toBe(0);
  });
});

describe('trees stay off built-up land inside the forest — #2657', () => {
  const ALL = { maxItems: 100_000, riderMetres: 0 };
  const seed = scatterSeed(forest.profile);
  const grown = (land: LandClassMask): readonly ScatterItem[] =>
    scatterAt(forest.profile, forest.origin, seed, 0, 1_000, ALL, land).filter((item) =>
      VEGETATION.has(item.kind),
    );
  const onResidential = (item: ScatterItem): boolean =>
    kindAt(forest.corridor, item.x, item.z) === 'residential';

  it('grows nothing on the residential block, and still plants the forest round it', () => {
    const trees = grown(forestMask);
    expect(trees.filter(onResidential)).toStrictEqual([]);
    expect(
      trees.filter((item) => forestMask.classAt(item.x, item.z) === 'wood').length,
    ).toBeGreaterThan(0);
    // Control: as a mapped wood, the block is planted like the rest.
    expect(grown(woodMask).filter(onResidential).length).toBeGreaterThan(0);
  });

  it('clears the forest’s trees off every house built on it', () => {
    const plans = footprintPlans(forest.corridor, forestMask, forest.profile, forest.origin).plans;
    const buildings = mappedBuildingsOf(plans);
    const trees = scatterAt(forest.profile, forest.origin, seed, 900, 1_700, ALL, forestMask);
    const onAHouse = (item: ScatterItem): boolean =>
      VEGETATION.has(item.kind) &&
      plans.some((plan) => Math.hypot(item.x - plan.centroid.x, item.z - plan.centroid.z) < 4);
    // Non-vacuity: the forest plants where the houses stand.
    expect(trees.filter(onAHouse).length).toBeGreaterThan(0);
    expect(clearOfMappedBuildings(trees, buildings).filter(onAHouse)).toStrictEqual([]);
  });
});
