// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1660's lever reaches the thing it names: the realistic page's town, planned
 * from the page's own parsed config, has its L-shaped houses pitched without
 * `-split-roofs` and flat with it. Red if the lever is parsed but not handed
 * to the planner. Since #1782 `-house-archetypes` likewise: the street of
 * houses has its archetypes without it, and none, planned as before, with it.
 * Since #1785 `-roof-variants` likewise: the street's variants without it, and
 * none with it; and since #1786 `-dormer-variants`: the Foursquares' hipped
 * dormers without it, and none with it; and since #1784 `-archetype-porches`:
 * the bungalows' wide eaves without it, and #1581's with it; and since #1783
 * `-commercial-archetypes`: the commercial street's archetypes without it,
 * and none with it — and since #1922, the pair's frames planted alike but on
 * the driveways a garden apartment gives up.
 */

import { describe, expect, it } from 'vitest';

import {
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  mappedTown,
  minimumAreaRectangle,
  type FootprintPlan,
} from '../../src/game/footprint-buildings';
import {
  commercialStreetFixture,
  houseStreetFixture,
  mixedTownFixture,
} from '../../src/game/footprint-fixtures-testing';
import { BUILDING_ARCHETYPES } from '../../src/game/building-archetypes';
import { HOUSE_ARCHETYPES, ROOF_VARIANTS } from '../../src/game/house-archetypes';
import { mappedBuildingsOf, onMappedGround } from '../../src/game/mapped-buildings';
import { REALISTIC_LADDER, type QualitySettings } from '../../src/game/quality';
import { rectanglesOf } from '../../src/game/rectilinear-roofs';
import type { ScatterItem } from '../../src/game/scatter';
import { SETTLEMENT_CLEARED_KINDS } from '../../src/game/settlements';

import { parseConfig } from './config';
import { rideFrame } from './frame';
import { plannedTown } from './town';

describe('the realistic page’s `split-roofs` lever — #1660', () => {
  const town = mixedTownFixture();
  /** The town's split houses — 2 or 3 rectangles — and how many of them are pitched. */
  const pitchedSplit = (query: string): { readonly split: number; readonly pitched: number } => {
    const { plans } = plannedTown(town, parseConfig(query).leversOff);
    const split = plans.filter((plan) => (rectanglesOf(plan.footprint)?.length ?? 1) > 1);
    return { split: split.length, pitched: split.filter((plan) => plan.roof !== 'flat').length };
  };

  it('pitches the town’s L-shaped houses on the product’s page', () => {
    const product = pitchedSplit('?town=mixed');
    expect(product.split).toBeGreaterThan(0);
    expect(product.pitched).toBeGreaterThan(0);
  });

  it('puts every one of them flat with `levers=-split-roofs`, which is main’s rule', () => {
    const control = pitchedSplit('?town=mixed&levers=-split-roofs');
    expect(control.split).toBeGreaterThan(0);
    expect(control.pitched).toBe(0);
  });
});

describe('the realistic page’s `house-archetypes` lever — #1782', () => {
  const street = houseStreetFixture();

  it('gives the street of houses every archetype on the product’s page', () => {
    const { plans } = plannedTown(street, parseConfig('?town=houses').leversOff);
    const archetypes = new Set(plans.map((plan) => plan.archetype));
    for (const archetype of HOUSE_ARCHETYPES) expect(archetypes).toContain(archetype);
  });

  it('plans every house with none, as the planner with them off does, with `levers=-house-archetypes`', () => {
    const { land, plans, urban } = plannedTown(
      street,
      parseConfig('?town=houses&levers=-house-archetypes').leversOff,
    );
    expect(plans.every((plan) => plan.archetype === 'unknown')).toBe(true);
    const off = footprintPlans(
      street.corridor,
      land,
      street.profile,
      street.origin,
      undefined,
      urban,
      { houseArchetypes: false },
    ).plans;
    expect(plans.length).toBe(off.length);
    plans.forEach((plan, index) => {
      for (const role of FOOTPRINT_ROLES) {
        expect(plan.triangles[role]).toStrictEqual(off[index]?.triangles[role]);
      }
    });
  });
});

describe('the realistic page’s `roof-variants` lever — #1785', () => {
  const street = houseStreetFixture();

  it('gives the street of houses every roof variant on the product’s page', () => {
    const { plans } = plannedTown(street, parseConfig('?town=houses').leversOff);
    const variants = new Set(plans.map((plan) => plan.roofVariant));
    for (const variant of ROOF_VARIANTS) expect(variants).toContain(variant);
  });

  it('plans every house as the planner with them off does, with `levers=-roof-variants`', () => {
    const { land, plans, urban } = plannedTown(
      street,
      parseConfig('?town=houses&levers=-roof-variants').leversOff,
    );
    expect(plans.every((plan) => plan.roofVariant === 'plain')).toBe(true);
    const off = footprintPlans(
      street.corridor,
      land,
      street.profile,
      street.origin,
      undefined,
      urban,
      { roofVariants: false },
    ).plans;
    expect(plans.length).toBe(off.length);
    plans.forEach((plan, index) => {
      for (const role of FOOTPRINT_ROLES) {
        expect(plan.triangles[role]).toStrictEqual(off[index]?.triangles[role]);
      }
    });
  });
});

describe('the realistic page’s `dormer-variants` lever — #1786', () => {
  const street = houseStreetFixture();
  const foursquareDormers = (query: string): number =>
    plannedTown(street, parseConfig(query).leversOff)
      .plans.filter((plan) => plan.archetype === 'foursquare')
      .reduce((sum, plan) => sum + plan.dormers, 0);

  it('stands a dormer on the street’s Foursquares on the product’s page', () => {
    expect(foursquareDormers('?town=houses')).toBeGreaterThan(3);
  });

  it('plans every house as the planner with them off does, with `levers=-dormer-variants`', () => {
    expect(foursquareDormers('?town=houses&levers=-dormer-variants')).toBe(0);
    const { land, plans, urban } = plannedTown(
      street,
      parseConfig('?town=houses&levers=-dormer-variants').leversOff,
    );
    const off = footprintPlans(
      street.corridor,
      land,
      street.profile,
      street.origin,
      undefined,
      urban,
      { dormerVariants: false },
    ).plans;
    expect(plans.length).toBe(off.length);
    plans.forEach((plan, index) => {
      for (const role of FOOTPRINT_ROLES) {
        expect(plan.triangles[role]).toStrictEqual(off[index]?.triangles[role]);
      }
    });
  });
});

describe('the realistic page’s `archetype-porches` lever — #1784', () => {
  const street = houseStreetFixture();
  /** How far the street's bungalows' roofs reach past their walls across their slopes, at most. */
  const bungalowEaves = (query: string): number =>
    Math.max(
      ...plannedTown(street, parseConfig(query).leversOff)
        .plans.filter((plan) => plan.archetype === 'bungalow')
        .map((plan) => {
          const rectangle = minimumAreaRectangle(plan.footprint);
          const floats = plan.triangles.roof;
          let reach = 0;
          for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
            const dx = (floats[at] as number) - rectangle.cx;
            const dz = (floats[at + 2] as number) - rectangle.cz;
            reach = Math.max(
              reach,
              Math.abs(-dx * rectangle.uz + dz * rectangle.ux) - rectangle.halfShort,
            );
          }
          return reach;
        }),
    );

  it('gives the street’s bungalows their wide eaves on the product’s page', () => {
    expect(bungalowEaves('?town=houses')).toBeCloseTo(0.65, 3);
  });

  it('plans every house as the planner with them off does, with `levers=-archetype-porches`', () => {
    expect(bungalowEaves('?town=houses&levers=-archetype-porches')).toBeCloseTo(0.4, 3);
    const { land, plans, urban } = plannedTown(
      street,
      parseConfig('?town=houses&levers=-archetype-porches').leversOff,
    );
    const off = footprintPlans(
      street.corridor,
      land,
      street.profile,
      street.origin,
      undefined,
      urban,
      { archetypePorches: false },
    ).plans;
    expect(plans.length).toBe(off.length);
    plans.forEach((plan, index) => {
      for (const role of FOOTPRINT_ROLES) {
        expect(plan.triangles[role]).toStrictEqual(off[index]?.triangles[role]);
      }
    });
  });
});

describe('the realistic page’s `commercial-archetypes` lever — #1783', () => {
  const street = commercialStreetFixture();

  it('gives the commercial street every archetype on the product’s page', () => {
    const { plans } = plannedTown(street, parseConfig('?town=commercial').leversOff);
    const archetypes = new Set(plans.map((plan) => plan.buildingArchetype));
    for (const archetype of BUILDING_ARCHETYPES) expect(archetypes).toContain(archetype);
  });

  it('plans every footprint with none, as the planner with them off does, with `levers=-commercial-archetypes`', () => {
    const { land, plans, urban } = plannedTown(
      street,
      parseConfig('?town=commercial&levers=-commercial-archetypes').leversOff,
    );
    expect(plans.every((plan) => plan.buildingArchetype === 'unknown')).toBe(true);
    const off = footprintPlans(
      street.corridor,
      land,
      street.profile,
      street.origin,
      undefined,
      urban,
      { commercialArchetypes: false },
    ).plans;
    expect(plans.length).toBe(off.length);
    plans.forEach((plan, index) => {
      for (const role of FOOTPRINT_ROLES) {
        expect(plan.triangles[role]).toStrictEqual(off[index]?.triangles[role]);
      }
    });
  });

  // #1922: the owner's pair showed roadside trees moving with the lever. The one
  // way it reaches the planting is the driveway a garden apartment gives up
  // (`building-archetypes.ts` §`GARDEN_APARTMENT_FEATURES`): with the lever off
  // its seeded garage has one, whose ground #1588 clears; with it on there is
  // none, so that ground is planted as any other. Nothing else may move.
  it('moves no tree, shrub or structure but those on a driveway a garden apartment gives up — #1922', () => {
    const top = REALISTIC_LADDER[0] as QualitySettings;
    /** The page's town for `query`, built as `realistic-harness.ts` builds it. */
    const town = (query: string) => {
      const { land, plans, urban } = plannedTown(street, parseConfig(query).leversOff);
      return {
        plans,
        town: {
          corridor: street.corridor,
          land,
          buildings: mappedBuildingsOf(plans),
          lots: mappedTown(street.corridor, plans, urban),
        },
      };
    };
    const on = town('?town=commercial&levers=-people');
    const off = town('?town=commercial&levers=-people,-commercial-archetypes');
    // The driveways the lever takes away: a garden apartment's, whose plan has one without it.
    const dropped = mappedBuildingsOf(
      off.plans.filter((plan, index) => {
        const archetyped = on.plans[index] as FootprintPlan;
        return (
          plan.driveway.length > 0 &&
          archetyped.driveway.length === 0 &&
          archetyped.buildingArchetype === 'garden-apartment'
        );
      }),
    );
    const key = (item: ScatterItem): string => `${item.kind} ${String(item.x)} ${String(item.z)}`;
    let planted = 0;
    for (let distance = 900; distance <= 2_700; distance += 100) {
      const frame = (built: ReturnType<typeof town>): readonly ScatterItem[] =>
        rideFrame({
          profile: street.profile,
          origin: street.origin,
          distance,
          elapsed: 1,
          rung: top,
          peopleOff: true,
          town: built.town,
        }).scatter;
      const archetyped = frame(on);
      const control = frame(off);
      const archetypedKeys = new Set(archetyped.map(key));
      // Everything the pair's control draws, the product draws too: the lever only plants.
      for (const item of control) {
        expect(archetypedKeys.has(key(item)), `${key(item)} at ${String(distance)} m`).toBe(true);
      }
      const controlKeys = new Set(control.map(key));
      for (const item of archetyped) {
        if (controlKeys.has(key(item))) continue;
        // And what it plants stands on a dropped driveway's ground, and on no building's.
        expect(SETTLEMENT_CLEARED_KINDS.has(item.kind), key(item)).toBe(true);
        expect(onMappedGround(dropped, item.x, item.z), key(item)).toBe(true);
        expect(onMappedGround(on.town.buildings, item.x, item.z), key(item)).toBe(false);
        planted += 1;
      }
    }
    // The control: the street has a dropped driveway with planting on its ground, as the owner saw.
    expect(dropped.plans.length).toBeGreaterThan(0);
    expect(planted).toBeGreaterThan(0);
  }, 30_000);
});
