// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1660's lever reaches the thing it names: the realistic page's town, planned
 * from the page's own parsed config, has its L-shaped houses pitched without
 * `-split-roofs` and flat with it. Red if the lever is parsed but not handed
 * to the planner.
 */

import { describe, expect, it } from 'vitest';

import { mixedTownFixture } from '../../src/game/footprint-fixtures-testing';
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
