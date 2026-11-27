// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3287: the stylised world draws a building by its setting — read from the
 * scenery plan, the items `structuresAt` and `sceneFrame` hand the renderer,
 * as the shapes `stylised-shapes.ts` names for them.
 *
 * The route is `footprint-fixtures-testing.ts` §`settingsFixture`, which is
 * arithmetic: a straight level road with no footprints, so every house is a
 * lot (`settlements.ts` §`lotsAt`), with a rural, a suburban and a commercial
 * stretch. Its urban class is `urban-class.ts`' own reading of that land —
 * the class the realistic world reads — and nothing here is a real place.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';

import { footprintPlans, mappedTown } from './footprint-buildings';
import { SETTINGS_STRETCHES, settingsFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { scatterSeed, type ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import { SCENERY_MODELS, STYLISED_FOLD_MODELS, stylisedShapeNameOf } from './scenery-models';
import { structuresAt, type MappedTown } from './settlements';
import { atStartLine } from './simulation';
import { urbanClassMap } from './urban-class';

const ALL = { maxItems: 1_000_000, riderMetres: 0 } as const;

const { rural: RURAL, suburban: SUBURBAN, commercial: COMMERCIAL } = SETTINGS_STRETCHES;
const LENGTH = 3_000;

/** How far inside a stretch an item must stand to be counted as its: clear of the windows at its ends. */
const MARGIN = 100;

const BUILDINGS = SCENERY_MODELS.building ?? [];

function fixture(urbanRead = true) {
  const { profile, origin, corridor } = settingsFixture();
  const mask = landClassMask(corridor);
  const urban = urbanClassMap(corridor, mask, profile);
  const plans = footprintPlans(corridor, mask, profile, origin).plans;
  return {
    profile,
    origin,
    corridor,
    mask,
    urban,
    seed: scatterSeed(profile),
    town: urbanRead ? mappedTown(corridor, plans, urban) : mappedTown(corridor, plans),
  };
}

/** A north road: an item's local `z` is its distance along it. */
function within(item: ScatterItem, stretch: { readonly from: number; readonly to: number }) {
  return item.z >= stretch.from + MARGIN && item.z < stretch.to - MARGIN;
}

function housesOf(items: readonly ScatterItem[], stretch: { from: number; to: number }) {
  return items.filter((item) => item.kind === 'building' && within(item, stretch));
}

/** An item as the plan held it before #3287: everything but its setting. */
function withoutSetting(item: ScatterItem): ScatterItem {
  const copy: { -readonly [Key in keyof ScatterItem]: ScatterItem[Key] } = { ...item };
  delete copy.setting;
  return copy;
}

function shapesOf(houses: readonly ScatterItem[]): Set<string> {
  return new Set(houses.map((house) => stylisedShapeNameOf(house) ?? 'none'));
}

describe('#3287 a building is drawn by its setting', () => {
  const town = fixture();
  const plan = structuresAt(
    town.profile,
    town.origin,
    town.seed,
    0,
    LENGTH,
    ALL,
    undefined,
    town.mask,
    town.town,
  );

  it('reads the three stretches as the classes the settings come from', () => {
    expect(town.urban.classAt(600)).toBe('rural');
    expect(town.urban.classAt(1_350)).toBe('village');
    expect(town.urban.classAt(1_850)).toBe('town');
    expect(town.urban.classAt(2_500)).toBe('rural');
  });

  it('draws a different building set on a rural, a suburban and a commercial stretch', () => {
    const rural = shapesOf(housesOf(plan, RURAL));
    const suburban = shapesOf(housesOf(plan, SUBURBAN));
    const commercial = shapesOf(housesOf(plan, COMMERCIAL));

    // Every stretch has houses, and each a few shapes: the test is not vacuous.
    expect(housesOf(plan, RURAL).length).toBeGreaterThan(10);
    expect(housesOf(plan, SUBURBAN).length).toBeGreaterThan(10);
    expect(housesOf(plan, COMMERCIAL).length).toBeGreaterThan(10);

    // Rural: the three committed Kenney buildings, and nothing else.
    expect(rural).toEqual(new Set(BUILDINGS.map((model) => model.name)));
    // Suburban: each mesh's first fold; commercial: its second. All three of each.
    const folds = STYLISED_FOLD_MODELS.building ?? [];
    // Suburban are City Kit (Suburban)'s files and commercial City Kit (Commercial)'s.
    expect([...suburban].sort()).toEqual(['building-type-l', 'building-type-p', 'building-type-q']);
    expect([...commercial].sort()).toEqual(['building-a', 'building-d', 'building-e']);
    expect(suburban).toEqual(new Set(folds.map((mesh) => mesh[0]?.name)));
    expect(commercial).toEqual(new Set(folds.map((mesh) => mesh[1]?.name)));
    expect(suburban.size).toBe(3);
    expect(commercial.size).toBe(3);

    // And no shape is shared between any two of the three.
    for (const shape of rural) {
      expect(suburban.has(shape)).toBe(false);
      expect(commercial.has(shape)).toBe(false);
    }
    for (const shape of suburban) expect(commercial.has(shape)).toBe(false);
  });

  it('writes the setting on the item, and on a house alone', () => {
    for (const house of housesOf(plan, RURAL)) expect(house.setting).toBeUndefined();
    for (const house of housesOf(plan, SUBURBAN)) expect(house.setting).toBe('suburban');
    for (const house of housesOf(plan, COMMERCIAL)) expect(house.setting).toBe('commercial');
    // A row of shops stands on the commercial land, and is no house.
    const shops = plan.filter((item) => item.kind === 'shop-row');
    expect(shops.length).toBeGreaterThan(0);
    for (const item of plan) {
      if (item.kind !== 'building') expect(item.setting, item.kind).toBeUndefined();
    }
  });

  it('moves nothing: the same plan with no urban class, every house rural', () => {
    // The control. With no class read the lots stand where they stood and are
    // drawn as they were — the three Kenney buildings everywhere.
    const before = fixture(false);
    const unclassed = structuresAt(
      before.profile,
      before.origin,
      before.seed,
      0,
      LENGTH,
      ALL,
      undefined,
      before.mask,
      before.town,
    );
    expect(unclassed).toStrictEqual(plan.map(withoutSetting));
    expect(unclassed.some((item) => item.setting !== undefined)).toBe(false);
    const names = new Set(BUILDINGS.map((model) => model.name));
    for (const stretch of [SUBURBAN, COMMERCIAL]) {
      for (const shape of shapesOf(housesOf(unclassed, stretch))) {
        expect(names.has(shape)).toBe(true);
      }
    }
  });

  it('reads an open-world ride’s class along the profile it is asked about — #3131', () => {
    // An open-world ride has a class a profile and none of its own
    // (`MappedTown.urbanOn`). A setting read off `urban` alone would leave
    // every house of such a ride rural.
    const asked: RouteProfile[] = [];
    const openWorld: MappedTown = {
      overlaps: (lot) => town.town.overlaps(lot),
      commercialAt: (x, z) => town.town.commercialAt(x, z),
      urbanOn: (profile) => {
        asked.push(profile);
        return town.urban;
      },
    };
    const found = structuresAt(
      town.profile,
      town.origin,
      town.seed,
      0,
      LENGTH,
      ALL,
      undefined,
      town.mask,
      openWorld,
    );
    expect(asked).toContain(town.profile);
    expect(housesOf(found, SUBURBAN).length).toBeGreaterThan(10);
    for (const house of housesOf(found, SUBURBAN)) expect(house.setting).toBe('suburban');
    for (const house of housesOf(found, COMMERCIAL)) expect(house.setting).toBe('commercial');
  });

  it('reaches the frame a ride draws', () => {
    const start = atStartLine(town.profile);
    const frameAt = (distance: number) =>
      sceneFrame({
        profile: town.profile,
        origin: town.origin,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        worldCorridor: town.corridor,
        landClass: town.mask,
        mappedTown: town.town,
      }).scatter.filter((item) => item.kind === 'building');

    const suburban = frameAt(1_250).filter((item) => within(item, SUBURBAN));
    const commercial = frameAt(1_750).filter((item) => within(item, COMMERCIAL));
    expect(suburban.length).toBeGreaterThan(3);
    expect(commercial.length).toBeGreaterThan(3);
    for (const house of suburban) expect(house.setting).toBe('suburban');
    for (const house of commercial) expect(house.setting).toBe('commercial');
  });
});
