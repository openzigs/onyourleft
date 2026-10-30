// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1660's lever reaches the thing it names: the realistic page's town, planned
 * from the page's own parsed config, has its L-shaped houses pitched without
 * `-split-roofs` and flat with it. Red if the lever is parsed but not handed
 * to the planner. Since #1782 `-house-archetypes` likewise: the street of
 * houses has its archetypes without it, and none, planned as before, with it.
 */

import { describe, expect, it } from 'vitest';

import { FOOTPRINT_ROLES, footprintPlans } from '../../src/game/footprint-buildings';
import { houseStreetFixture, mixedTownFixture } from '../../src/game/footprint-fixtures-testing';
import { HOUSE_ARCHETYPES } from '../../src/game/house-archetypes';
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
