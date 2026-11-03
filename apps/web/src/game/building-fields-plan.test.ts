// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1789: the building fields reach the plan's input, and **nothing draws
 * differently yet**. The plan's use of each field is a sibling issue under
 * #1656; until one lands, a corridor plans exactly as it did before #1789,
 * whether its archive carries the fields (#1557's) or not (Protomaps' own, or
 * a self-hoster's). Since #1790 the roof and storey fields draw, and since
 * #1791 the building type; with both levers off (`mappedRoofShape: false`,
 * `buildingTypes: false`) nothing does.
 *
 * Each corridor here goes through the store's own pack and unpack
 * (`world-data/corridor.ts`), and each assertion reads `footprintPlans`'
 * output — its triangles are the vertex floats the belt uploads.
 */

import { createHash } from 'node:crypto';

import { BUILDING_FIELD_NAMES, type BuildingFeature } from '@onyourleft/map-features';
import { BUILDING_FIELDS_DECODED } from '@onyourleft/map-features/testing';
import { describe, expect, it } from 'vitest';

import { footprintPlans, type FootprintPlanOptions } from './footprint-buildings';
import { denseTownFixture, footprintFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import {
  corridorFeaturesOfPacked,
  packedCorridorFeatures,
  type CorridorFeatures,
  type WorldCorridor,
} from './world-data/corridor';

/**
 * `footprintPlans`' output for {@link footprintFixture}'s corridor, every
 * number and every triangle, measured on `main` at 67517b8c — before #1789 —
 * through the same pack and unpack. A change that moves one float of one
 * plan moves this.
 */
const PLANS_BEFORE_1789 = '624367cc86495d2803197b07668d642d6e772b37ca5d7e90fb2165ecdcbf19fc';

/** The raw JSON bytes of {@link denseTownFixture}'s 2 000 footprints packed at version 3. */
const DENSE_TOWN_PACKED_JSON_BYTES_V3 = 197_300;

/** `corridor`'s buildings and land use, packed and unpacked as the store keeps them. */
function throughTheStore(corridor: WorldCorridor): WorldCorridor {
  const features: CorridorFeatures = {
    landUse: corridor.landUse,
    buildings: corridor.buildings,
    paths: [],
    streets: [],
    places: [],
  };
  const back = corridorFeaturesOfPacked(
    JSON.parse(JSON.stringify(packedCorridorFeatures(features))) as ReturnType<
      typeof packedCorridorFeatures
    >,
  );
  return { ...corridor, landUse: back.landUse, buildings: back.buildings };
}

/** SHA-256 over every plan and the verdicts, typed arrays as their numbers. */
function plansDigest(
  corridor: WorldCorridor,
  options: FootprintPlanOptions = {},
): { readonly plans: number; readonly digest: string } {
  const fixture = footprintFixture();
  const { plans, verdicts } = footprintPlans(
    corridor,
    landClassMask(corridor),
    fixture.profile,
    fixture.origin,
    undefined,
    undefined,
    options,
  );
  // #2023 added the `inferred` flag to every plan; no footprint here is inferred anything, so
  // it is left out of the record, which predates it.
  expect(plans.every((plan) => !plan.inferred)).toBe(true);
  // #2021 added the `steeple` flag to every plan; no footprint here has one with the type
  // unread, so it is left out of the record, which predates it.
  if (options.buildingTypes === false) expect(plans.every((plan) => !plan.steeple)).toBe(true);
  const text = JSON.stringify({ plans, verdicts }, (key, value: unknown) =>
    key === 'inferred' || key === 'steeple'
      ? undefined
      : ArrayBuffer.isView(value)
        ? Array.from(value as Float32Array)
        : value,
  );
  return { plans: plans.length, digest: createHash('sha256').update(text).digest('hex') };
}

/** Every footprint of `corridor` carrying every field, set. */
function withEveryField(corridor: WorldCorridor): WorldCorridor {
  return {
    ...corridor,
    buildings: corridor.buildings.map((building): BuildingFeature => ({
      ...building,
      ...BUILDING_FIELDS_DECODED,
    })),
  };
}

describe('#1789: an archive without the building fields plans as before', () => {
  it('plans the fixture town to the same plans, float for float, as before #1789', () => {
    const corridor = throughTheStore(footprintFixture().corridor);
    // Every field null, as from Protomaps' own build.
    for (const building of corridor.buildings) {
      for (const name of BUILDING_FIELD_NAMES) expect(building[name]).toBeNull();
    }
    expect(plansDigest(corridor)).toStrictEqual({ plans: 12, digest: PLANS_BEFORE_1789 });
  });

  // Since #1790 the roof and storey fields draw, and since #1791 the building type
  // (`building-types.ts`) — every footprint here is set a church with a roof:shape and levels.
  it('nothing draws from the fields with #1790’s and #1791’s levers off: every field set plans the same as none', () => {
    const corridor = throughTheStore(withEveryField(footprintFixture().corridor));
    // Not vacuous: the fields survived the store's pack.
    expect(corridor.buildings[0]?.roofShape).toBe(BUILDING_FIELDS_DECODED.roofShape);
    expect(plansDigest(corridor, { mappedRoofShape: false, buildingTypes: false })).toStrictEqual({
      plans: 12,
      digest: PLANS_BEFORE_1789,
    });
    // Control: each lever alone draws from its own fields, read through the store's pack.
    expect(plansDigest(corridor, { buildingTypes: false }).digest).not.toBe(PLANS_BEFORE_1789);
    expect(plansDigest(corridor, { mappedRoofShape: false }).digest).not.toBe(PLANS_BEFORE_1789);
    expect(plansDigest(corridor).digest).not.toBe(PLANS_BEFORE_1789);
  });

  it('packs 2 000 footprints with no field set to the bytes version 3 packed, but for the version digit', () => {
    const { buildings } = denseTownFixture(2_000).corridor;
    expect(buildings).toHaveLength(2_000);
    const packed = (list: readonly BuildingFeature[]) =>
      JSON.stringify(
        packedCorridorFeatures({
          landUse: [],
          buildings: list,
          paths: [],
          streets: [],
          places: [],
        }),
      );
    expect(packed(buildings).length).toBe(DENSE_TOWN_PACKED_JSON_BYTES_V3);
    // With every field set the fields cost bytes, and only then.
    expect(
      packed(buildings.map((building) => ({ ...building, ...BUILDING_FIELDS_DECODED }))).length,
    ).toBeGreaterThan(DENSE_TOWN_PACKED_JSON_BYTES_V3);
  });
});
