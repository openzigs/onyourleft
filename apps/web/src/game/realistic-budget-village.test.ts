// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two village ceilings — #1815, on the owner's ruling DL6b of 2026-10-27
 * (ADR 0059 D-3): Delivery's applies only to a frame that carries a round, and
 * every other frame is held to the frozen 50. The browser gate counts the
 * frames (`realistic-town.browser.spec.ts` §"#1689" for the ordinary one,
 * `realistic-delivery.browser.spec.ts` for Delivery's); this is the choice
 * between them, which a single-ceiling mistake would pass in both.
 */

import { describe, expect, it } from 'vitest';

import type { DeliveryInView, SceneFrame } from './port';
import {
  DELIVERY_VILLAGE_DRAW_CALLS,
  REALISTIC_VILLAGE_DRAW_CALLS,
  villageDrawCallCeiling,
} from './realistic-budget';

const ORDINARY: Pick<SceneFrame, 'delivery'> = {};
const PIECE = { x: 0, y: 0, z: 0, yaw: 0 };
const ROUND: DeliveryInView = {
  parcels: [PIECE],
  markers: [PIECE],
  obstacles: [{ ...PIECE, kind: 'bin' }],
};

/** Whether a frame that made `calls` draw calls is inside the ceiling it is held to. */
const within = (calls: number, frame: Pick<SceneFrame, 'delivery'>): boolean =>
  calls <= villageDrawCallCeiling(frame);

describe('the village frame’s two ceilings — #1815', () => {
  it('keeps the ordinary ride’s freeze at 50, and gives Delivery a ceiling above it', () => {
    expect(REALISTIC_VILLAGE_DRAW_CALLS).toBe(50);
    expect(DELIVERY_VILLAGE_DRAW_CALLS).toBeGreaterThan(REALISTIC_VILLAGE_DRAW_CALLS);
  });

  it('holds an ordinary frame that drew one call more than 50 to be over its ceiling', () => {
    expect(villageDrawCallCeiling(ORDINARY)).toBe(REALISTIC_VILLAGE_DRAW_CALLS);
    expect(villageDrawCallCeiling({ delivery: undefined })).toBe(REALISTIC_VILLAGE_DRAW_CALLS);
    expect(within(REALISTIC_VILLAGE_DRAW_CALLS, ORDINARY)).toBe(true);
    expect(within(REALISTIC_VILLAGE_DRAW_CALLS + 1, ORDINARY)).toBe(false);
    // The same call count IS inside Delivery's: the ceiling chosen is what decides it.
    expect(within(REALISTIC_VILLAGE_DRAW_CALLS + 1, { delivery: ROUND })).toBe(true);
  });

  it('holds a frame carrying a round to Delivery’s ceiling, and no further', () => {
    expect(villageDrawCallCeiling({ delivery: ROUND })).toBe(DELIVERY_VILLAGE_DRAW_CALLS);
    expect(within(DELIVERY_VILLAGE_DRAW_CALLS, { delivery: ROUND })).toBe(true);
    expect(within(DELIVERY_VILLAGE_DRAW_CALLS + 1, { delivery: ROUND })).toBe(false);
  });

  it('holds a round with nothing in view to Delivery’s ceiling: the round is still running', () => {
    const empty: DeliveryInView = { parcels: [], markers: [], obstacles: [] };
    expect(villageDrawCallCeiling({ delivery: empty })).toBe(DELIVERY_VILLAGE_DRAW_CALLS);
  });
});
