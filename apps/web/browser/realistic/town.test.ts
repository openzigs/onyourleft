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
 * the bungalows' wide eaves without it, and #1581's with it.
 */

import { describe, expect, it } from 'vitest';

import {
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  minimumAreaRectangle,
} from '../../src/game/footprint-buildings';
import { houseStreetFixture, mixedTownFixture } from '../../src/game/footprint-fixtures-testing';
import { HOUSE_ARCHETYPES, ROOF_VARIANTS } from '../../src/game/house-archetypes';
import { rectanglesOf } from '../../src/game/rectilinear-roofs';

import { parseConfig } from './config';
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
