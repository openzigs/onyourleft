// SPDX-License-Identifier: Apache-2.0

/**
 * What this package states that `@onyourleft/domain`'s lap race also states —
 * #1908, on `physics-agreement.test.ts`'s precedent.
 *
 * This package has no production dependency, so the item keys, the lane count
 * and the race-offset bound (#1897, #1899, ADR 0060 D-3.3 and D-6.3) are
 * restated in `schema.ts`. `@onyourleft/domain` is a **devDependency**, read
 * only here, so a moved constant is a red build rather than a wire that
 * refuses an item the room's own rules hand out.
 */

import { describe, expect, it } from 'vitest';

import {
  ITEM_KINDS,
  LANE_COUNT as DOMAIN_LANE_COUNT,
  RACE_OFFSET_BOUND_METRES,
} from '@onyourleft/domain';

import { ITEM_KEYS, LANE_COUNT, MAXIMUM_RACE_OFFSET_CENTIMETRES, MESSAGE_FIELDS } from './schema';

describe('agreement with @onyourleft/domain’s lap race — #1908', () => {
  it('carries exactly the items the item rules hand out', () => {
    expect([...ITEM_KEYS].sort()).toEqual([...ITEM_KINDS].sort());
  });

  it('holds a rider in exactly the lanes the race has', () => {
    expect(LANE_COUNT).toBe(DOMAIN_LANE_COUNT);
    expect(MESSAGE_FIELDS.lane.lane.shape).toMatchObject({
      minimum: 0,
      maximum: DOMAIN_LANE_COUNT - 1,
    });
  });

  it('bounds a race offset at B, in centimetres', () => {
    expect(MAXIMUM_RACE_OFFSET_CENTIMETRES).toBe(RACE_OFFSET_BOUND_METRES * 100);
  });
});
