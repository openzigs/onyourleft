// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2975: a footprint the map's POIs make a shop, a café or a fuel station is
 * drawn as one. Held where a rider sees it: the plans `footprintPlans`
 * returns and the triangles the belt uploads, over `poiStreetFixture`'s
 * street, every footprint on residential land, so that only its POI can make
 * one a shop. With `-map-pois` every plan is as it is with no POI at all.
 */

import { describe, expect, it } from 'vitest';

import { FOUNDATION_METRES, PLINTH_TOP_METRES } from './buildings';
import {
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  FUEL_CANOPY,
  footprintPlans,
  type FootprintPlan,
  type FootprintPlanOptions,
} from './footprint-buildings';
import { planFingerprint, poiStreetFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf, onMappedGround } from './mapped-buildings';

const fixture = poiStreetFixture();

/** The fixture's plans, by row, both sides; and the verdicts. */
function plan(
  options: FootprintPlanOptions = {},
  corridor = fixture.corridor,
): { readonly byRow: Map<string, FootprintPlan[]>; readonly plans: readonly FootprintPlan[] } {
  const land = landClassMask(corridor);
  const { plans, verdicts } = footprintPlans(
    corridor,
    land,
    fixture.profile,
    fixture.origin,
    undefined,
    undefined,
    options,
  );
  // Every footprint kept, so plan `i` is footprint `i`.
  expect(verdicts.kept).toBe(corridor.buildings.length);
  const byRow = new Map<string, FootprintPlan[]>();
  plans.forEach((each, index) => {
    const row = fixture.rows[index] as string;
    byRow.set(row, [...(byRow.get(row) ?? []), each]);
  });
  return { byRow, plans };
}

const product = plan();
const rowOf = (row: string): FootprintPlan[] => product.byRow.get(row) ?? [];

/** Every vertex's height in a role's triangles. */
function heights(floats: Float32Array): number[] {
  const out: number[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push(floats[at + 1] as number);
  }
  return out;
}

/** The fixture with every footprint's POI taken off. */
const withoutPois = {
  ...fixture.corridor,
  buildings: fixture.corridor.buildings.map((building) => {
    const rest = { ...building };
    delete rest.poi;
    return rest;
  }),
};

describe('a shop or a café the map marks — #2975', () => {
  it('an untyped footprint with a shop’s POI has a shop front; its twin with none, on the same land, has none', () => {
    for (const shop of rowOf('shop')) {
      expect(shop.shop.front).toBe(true);
      expect(shop.family).toBe('commercial');
      expect(shop.triangles.shopfront.length).toBeGreaterThan(0);
    }
    for (const twin of rowOf('no-poi')) {
      expect(twin.shop.front).toBe(false);
      expect(twin.triangles.shopfront.length).toBe(0);
    }
  });

  it('a café always has its awning; the same footprint as a shop does not always', () => {
    expect(rowOf('cafe')).toHaveLength(2);
    for (const cafe of rowOf('cafe')) {
      expect(cafe.shop.front).toBe(true);
      expect(cafe.shop.awning).toBe(true);
    }
    // Not vacuous: an awning is not every other shop front's (#1590's share is a half).
    const fronts = ['shop', 'kiosk', 'fuel-too-big']
      .flatMap(rowOf)
      .filter((each) => each.shop.front);
    expect(fronts.filter((each) => !each.shop.awning).length).toBeGreaterThan(0);
  });

  it('a block of flats with a café is a shop below; a mapped house and garage keep their looks', () => {
    for (const flats of rowOf('flats')) {
      expect(flats.shop.front).toBe(true);
      expect(flats.shop.awning).toBe(true);
    }
    const off = plan({}, withoutPois).byRow;
    for (const row of ['house', 'garage']) {
      for (const [side, each] of rowOf(row).entries()) {
        expect(each.shop.front, row).toBe(false);
        expect(planFingerprint([each]), row).toBe(
          planFingerprint([(off.get(row) ?? [])[side] as FootprintPlan]),
        );
      }
    }
  });
});

describe('a fuel station the map marks — #2975', () => {
  it('its untyped footprint is an open canopy: no wall, roof, door or window, and no far level', () => {
    for (const canopy of [...rowOf('canopy'), ...rowOf('canopy-no-height')]) {
      for (const role of FOOTPRINT_ROLES) {
        if (role === 'trim') expect(canopy.triangles.trim.length).toBeGreaterThan(0);
        else expect(canopy.triangles[role].length, role).toBe(0);
      }
      expect(canopy.farTriangleCount).toBe(0);
      expect(canopy.shop.front).toBe(false);
      expect(canopy.frontStep).toBeUndefined();
      expect(canopy.model).toBeUndefined();
      expect(canopy.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(canopy.triangleCount * 3 * FOOTPRINT_VERTEX_FLOATS).toBe(canopy.triangles.trim.length);
    }
  });

  it('its slab’s top is its mapped height, or with none the forecourt’s, and its posts reach the ground', () => {
    for (const [row, rise] of [
      ['canopy', 6.4],
      ['canopy-no-height', FUEL_CANOPY.clearance + FUEL_CANOPY.thickness],
    ] as const) {
      for (const canopy of rowOf(row)) {
        // A level road: the ground under it is flat, at the base and its foundation.
        const ground = canopy.base + FOUNDATION_METRES;
        const floor = ground + PLINTH_TOP_METRES;
        const ys = heights(canopy.triangles.trim);
        const top = Math.max(...ys);
        expect(top).toBeCloseTo(canopy.eaves, 5);
        expect(top - (row === 'canopy' ? ground : floor), row).toBeCloseTo(rise, 4);
        // The underside, the slab's thickness under its top.
        expect(ys.some((y) => Math.abs(y - (top - FUEL_CANOPY.thickness)) < 1e-4)).toBe(true);
        // The posts: from 0.1 m under the ground to the underside, and nothing else below it.
        expect(Math.min(...ys)).toBeCloseTo(ground - 0.1, 4);
        const below = ys.filter((y) => y < top - FUEL_CANOPY.thickness - 1e-4);
        // Four posts, each four upright faces of two triangles, two of whose three corners are at the foot or the top.
        expect(below.length).toBe(4 * 4 * 3);
      }
    }
  });

  it('no tree or rock stands under it: its outline is cleared as a building’s is', () => {
    const buildings = mappedBuildingsOf(product.plans);
    for (const canopy of rowOf('canopy')) {
      // Under the middle of the slab, where nothing stands but the posts at its corners.
      expect(onMappedGround(buildings, canopy.centroid.x, canopy.centroid.z)).toBe(true);
    }
  });

  it('its `retail` kiosk, and an untyped footprint too big for a canopy, are shops with walls', () => {
    for (const row of ['kiosk', 'fuel-too-big']) {
      for (const each of rowOf(row)) {
        expect(each.triangles.wall.length, row).toBeGreaterThan(0);
        expect(each.farTriangleCount, row).toBeGreaterThan(0);
        expect(each.shop.front, row).toBe(true);
      }
    }
  });
});

describe('`-map-pois` — #2975', () => {
  it('plans every footprint as it is planned with no POI at all, byte for byte', () => {
    const off = plan({ mappedPois: false }).plans;
    const none = plan({}, withoutPois).plans;
    expect(planFingerprint(off)).toBe(planFingerprint(none));
    for (const [index, each] of off.entries()) {
      expect(each.shop).toStrictEqual(none[index]?.shop);
    }
    // Not vacuous: with the lever on, the plans differ.
    expect(planFingerprint(product.plans)).not.toBe(planFingerprint(none));
  });
});
