// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a group ride's debrief counts** — #3310, ADR 0101 D-5.8. The pure
 * half: a scripted log whose answers are worked by hand in the fixture, read
 * by `group-ride-debrief.ts` §`groupRideDebrief`. The page's half, through the
 * real store, is `GroupRideDebriefSection.test.tsx`.
 */

import { metres, seconds } from '@onyourleft/domain';
import type { GroupRideFact } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { groupRideDebrief } from './group-ride-debrief';
import { GROUP_RIDE_WAITED as WAITED, GROUP_RIDE_WAITED_RIDE as WAITED_RIDE } from './testing';

describe('the group ride debrief — #3310', () => {
  it('counts the pulls and the times the scripted ride produced', () => {
    const debrief = groupRideDebrief(WAITED, WAITED_RIDE);
    expect(debrief).toStrictEqual({
      pulls: 2,
      frontSeconds: 180,
      averagePullSeconds: 90,
      draftSeconds: 330,
      withGroupSeconds: 540,
      gapsOpened: 1,
      gapsClosed: 1,
      targetSpeed: 30 / 3.6,
      riddenSpeed: 7.5,
      logCut: false,
    });
  });

  it('counts one pull for a turn on the front logged twice, as the phase changed under it', () => {
    const fact: GroupRideFact = {
      ...WAITED,
      ridden: 100,
      log: [
        { at: 0, phase: 'steady', role: 'on-front', groupSpeed: 8 },
        { at: 30, phase: 'changing', role: 'on-front', groupSpeed: 8 },
        { at: 50, phase: 'changing', role: 'drifting-back', groupSpeed: 8 },
      ],
    };
    const debrief = groupRideDebrief(fact, WAITED_RIDE);
    expect(debrief.pulls).toBe(1);
    expect(debrief.frontSeconds).toBe(50);
    expect(debrief.averagePullSeconds).toBe(50);
    // Drifting back is with the group and not on a wheel.
    expect(debrief.withGroupSeconds).toBe(100);
    expect(debrief.draftSeconds).toBe(0);
  });

  it('ends the last entry on the group’s clock, not the recording’s — PR #3364’s delta review', () => {
    // A recording twice as long as the group ride: a HUD pause, or a ride on alone past the finish.
    const longer = { ...WAITED_RIDE, elapsedTime: seconds(1_200) };
    expect(groupRideDebrief(WAITED, longer).draftSeconds).toBe(330);
    expect(groupRideDebrief(WAITED, longer).withGroupSeconds).toBe(540);
  });

  it('reads a fact kept before #3310 to the recording’s end, from where the group began on it', () => {
    const { ridden, ...before } = WAITED;
    void ridden;
    // Begun 10 s into the recording: the group's 600 s end at the recording's 610.
    const kept: GroupRideFact = { ...before, startedAt: 10 };
    const debrief = groupRideDebrief(kept, { ...WAITED_RIDE, elapsedTime: seconds(610) });
    expect(debrief.draftSeconds).toBe(330);
    expect(debrief.withGroupSeconds).toBe(540);
    // Never before the last entry began.
    const short = groupRideDebrief(kept, { ...WAITED_RIDE, elapsedTime: seconds(1) });
    expect(short.draftSeconds).toBe(270);
  });

  it('counts the last kept entry of a cut log as nothing: what came after it is not known', () => {
    const debrief = groupRideDebrief({ ...WAITED, logCut: true }, WAITED_RIDE);
    expect(debrief.logCut).toBe(true);
    // The sitting-in entry at 540 s is the last kept: its 60 s are not counted.
    expect(debrief.draftSeconds).toBe(270);
    expect(debrief.withGroupSeconds).toBe(480);
  });

  it('has no average pull with no pull, and no average ridden with no distance', () => {
    const fact: GroupRideFact = {
      ...WAITED,
      log: [{ at: 0, phase: 'steady', role: 'in-line', groupSpeed: 8 }],
    };
    const debrief = groupRideDebrief(fact, {
      ...WAITED_RIDE,
      distance: metres(0),
    });
    expect(debrief.pulls).toBe(0);
    expect(debrief.averagePullSeconds).toBeUndefined();
    expect(debrief.riddenSpeed).toBeUndefined();
    expect(debrief.draftSeconds).toBe(600);
  });
});
