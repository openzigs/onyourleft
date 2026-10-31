// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lap race's own ceiling — #1903, ADR 0060 D-10.2: it applies only while
 * a frame carries a lap race, and never to an ordinary ride or to Delivery.
 * The village's two ceilings (#1815) are unchanged, and the village chooser
 * never hands out the lap race's. The browser gate counts the frames
 * (`game.browser.spec.ts` §"#1903"); this is the choice between the
 * ceilings, which a single-ceiling mistake would pass in the browser.
 */

import { describe, expect, it } from 'vitest';

import type { DeliveryInView, LapRaceInView, SceneFrame } from './port';
import {
  DELIVERY_VILLAGE_DRAW_CALLS,
  LAP_RACE_SCENE_DRAW_CALLS,
  REALISTIC_VILLAGE_DRAW_CALLS,
  STYLISED_SCENE_DRAW_CALLS,
  stylisedSceneDrawCallCeiling,
  villageDrawCallCeiling,
} from './realistic-budget';

const PIECE = { x: 0, y: 0, z: 0, yaw: 0 };
const ROUND: DeliveryInView = {
  parcels: [PIECE],
  markers: [PIECE],
  obstacles: [{ ...PIECE, kind: 'bin' }],
};
const RACE: LapRaceInView = { pickUps: [PIECE], hazards: [PIECE] };

const ORDINARY: Pick<SceneFrame, 'delivery' | 'lapRace'> = {};
const DELIVERY: Pick<SceneFrame, 'delivery' | 'lapRace'> = { delivery: ROUND };
const LAP_RACE: Pick<SceneFrame, 'delivery' | 'lapRace'> = { lapRace: RACE };

describe('the lap race’s own ceiling — #1903', () => {
  it('leaves the ordinary ride’s 50 and Delivery’s 53 as they were', () => {
    expect(REALISTIC_VILLAGE_DRAW_CALLS).toBe(50);
    expect(DELIVERY_VILLAGE_DRAW_CALLS).toBe(53);
  });

  it('never applies the lap race’s ceiling to an ordinary ride or to Delivery', () => {
    expect(villageDrawCallCeiling(ORDINARY)).toBe(REALISTIC_VILLAGE_DRAW_CALLS);
    expect(villageDrawCallCeiling(DELIVERY)).toBe(DELIVERY_VILLAGE_DRAW_CALLS);
    expect(stylisedSceneDrawCallCeiling(ORDINARY)).toBe(STYLISED_SCENE_DRAW_CALLS);
    expect(stylisedSceneDrawCallCeiling(DELIVERY)).toBe(STYLISED_SCENE_DRAW_CALLS);
    expect(stylisedSceneDrawCallCeiling({ lapRace: undefined })).toBe(STYLISED_SCENE_DRAW_CALLS);
  });

  it('holds a frame carrying a lap race to the lap race’s ceiling, and no further', () => {
    expect(stylisedSceneDrawCallCeiling(LAP_RACE)).toBe(LAP_RACE_SCENE_DRAW_CALLS);
    // A race with nothing in view is still a race running.
    expect(stylisedSceneDrawCallCeiling({ lapRace: { pickUps: [], hazards: [] } })).toBe(
      LAP_RACE_SCENE_DRAW_CALLS,
    );
    // The same count is over an ordinary frame's ceiling and inside a race's: the choice decides it.
    const calls = STYLISED_SCENE_DRAW_CALLS + 1;
    expect(calls <= stylisedSceneDrawCallCeiling(ORDINARY)).toBe(false);
    expect(calls <= stylisedSceneDrawCallCeiling(LAP_RACE)).toBe(true);
    expect(LAP_RACE_SCENE_DRAW_CALLS + 1 <= stylisedSceneDrawCallCeiling(LAP_RACE)).toBe(false);
  });

  it('does not raise the village for a lap race: the lap race’s ceiling is the stylised world’s', () => {
    expect(villageDrawCallCeiling(LAP_RACE)).toBe(REALISTIC_VILLAGE_DRAW_CALLS);
    // The belt's three calls, over the stylised world's own budget, and nothing rounded up past them.
    expect(LAP_RACE_SCENE_DRAW_CALLS).toBe(STYLISED_SCENE_DRAW_CALLS + 3);
  });
});
