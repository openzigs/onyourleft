// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309: the scores and the marks, on records written here. The rides
 * themselves are held by `marks.*.test.ts`; this file says each score
 * measures what its name says, so a mark reads the right number.
 */

import {
  CUE_CEILING_PER_MINUTE,
  ROTATION_FADE_DWELL_MS,
  ROTATION_RIDER_GRACE_MS,
  ROTATION_RIDER_PULL_MS,
} from '@onyourleft/domain';
import { DRAFT_REACH_METRES } from '@onyourleft/physics';
import { describe, expect, it } from 'vitest';

import { GROUP_RIDE_RIDER_ID } from '../../src/game/group-ride/ride-group';

import { holds, markRide, RECOVERY_SECONDS, STUCK_ON_FRONT_SECONDS } from './marks';
import type { RideRecord, WindowSample } from './ride';
import {
  COHESION_BAND_METRES,
  CRAWL_MPS,
  REJOIN_WATCH_SECONDS,
  rejoinsOf,
  scoreRide,
} from './score';

const NO_MARKS = {
  'past-front': 0,
  surging: 0,
  'eased-too-much': 0,
  'close-gap': 0,
  'shorter-pull': 0,
} as const;

/** A window at `seconds`, with the line together at the plan's 30 km/h unless named. */
function window(seconds: number, over: Partial<WindowSample> = {}): WindowSample {
  return {
    seconds,
    phase: 'steady',
    role: 'in-line',
    front: 'bot-1',
    widestGapM: 0.6,
    behindM: 0.6,
    groupSpeedMps: 30 / 3.6,
    ...over,
  };
}

/** A record of `windows`, ten minutes to the finish of 5 km unless named. */
function record(windows: readonly WindowSample[], over: Partial<RideRecord> = {}): RideRecord {
  return {
    rider: 'steady',
    course: 'flat',
    seed: 1,
    targetKmh: 30,
    courseMetres: 5_000,
    windows,
    cues: [],
    marks: NO_MARKS,
    presses: 0,
    groupFinishSeconds: 600,
    riderFinishSeconds: 600,
    finishBehindM: 0.6,
    ...over,
  };
}

const seconds = (count: number, at: (index: number) => Partial<WindowSample> = () => ({})) =>
  Array.from({ length: count }, (_, index) => window(index + 1, at(index)));

describe('scoreRide', () => {
  it('cohesion is the share of windows with every gap inside the band', () => {
    const windows = seconds(10, (at) => ({
      widestGapM: at < 3 ? COHESION_BAND_METRES + 0.1 : COHESION_BAND_METRES,
    }));
    expect(scoreRide(record(windows)).cohesion).toBe(0.7);
  });

  it("counts a rotation each time the front changes, and the rider's turns and their longest", () => {
    const fronts = [
      'bot-1',
      'bot-1',
      GROUP_RIDE_RIDER_ID,
      GROUP_RIDE_RIDER_ID,
      'bot-2',
      GROUP_RIDE_RIDER_ID,
    ];
    const windows = fronts.map((front, at) =>
      window(at + 1, { front, role: front === GROUP_RIDE_RIDER_ID ? 'on-front' : 'in-line' }),
    );
    const score = scoreRide(record(windows));
    expect(score.rotations).toBe(3);
    expect(score.riderPulls).toBe(2);
    expect(score.riderLongestPullSeconds).toBe(2);
  });

  it('counts a turn the rider starts the ride on', () => {
    const windows = [window(1, { front: GROUP_RIDE_RIDER_ID, role: 'on-front' }), window(2)];
    expect(scoreRide(record(windows)).riderPulls).toBe(1);
  });

  it('cues a minute counts every cue, and a correction counts said or marked', () => {
    const score = scoreRide(
      record(seconds(600), {
        cues: [
          { kind: 'next-up', seconds: 10 },
          { kind: 'surging', seconds: 20 },
          { kind: 'past-front', seconds: 30 },
        ],
        marks: { ...NO_MARKS, surging: 2 },
      }),
    );
    expect(score.cuesPerMinute).toBe(0.3);
    expect(score.corrections.surging).toBe(3);
    expect(score.corrections['past-front']).toBe(1);
    expect(score.correctionsAll).toBe(4);
    expect(score.pastFrontPerMinute).toBe(0.1);
  });

  it('beyond the reach counts the seconds past it and the longest of them', () => {
    const behind = [0, 31, 31, 0, 31, 31, 31, DRAFT_REACH_METRES];
    const windows = behind.map((behindM, at) => window(at + 1, { behindM }));
    const score = scoreRide(record(windows));
    expect(score.beyondReachSeconds).toBe(5);
    expect(score.longestBeyondReachSeconds).toBe(3);
  });

  it("the average is the first of the group's to the finish, against the one asked", () => {
    // 5 km in 612 s is 29.41 km/h: 1.96 % under 30.
    const score = scoreRide(
      record(seconds(612), { groupFinishSeconds: 612, riderFinishSeconds: 615 }),
    );
    expect(score.groupAverageKmh).toBe(29.412);
    expect(score.averageOffPercent).toBe(-1.961);
    expect(score.riderAverageKmh).toBe(29.268);
  });

  it('a ride cut before the finish has no average and no finish', () => {
    const score = scoreRide(
      record(seconds(100), {
        groupFinishSeconds: null,
        riderFinishSeconds: null,
        finishBehindM: null,
      }),
    );
    expect(score.finished).toBe(false);
    expect(score.averageOffPercent).toBeNull();
    expect(score.finishBehindM).toBeNull();
    expect(score.minutes).toBe(1.667);
  });

  it('a rejoin is a window off the wheel and the next on it; the slip after it is watched for the long mean', () => {
    const windows = seconds(400, (at) =>
      at < 10
        ? { role: 'off-the-back', behindM: 40 }
        : at === 50
          ? { behindM: 9 }
          : at === 10 + REJOIN_WATCH_SECONDS + 5
            ? { behindM: 20 }
            : {},
    );
    expect(rejoinsOf(windows)).toEqual([11]);
    const score = scoreRide(record(windows));
    expect(score.rejoins).toBe(1);
    // The 9 m at 51 s is inside the watch; the 20 m after it is not, nor the 40 m before.
    expect(score.afterRejoinMostBehindM).toBe(9);
    expect(score.afterRejoinGappedSeconds).toBe(1);
  });

  it('a crawl is the group under its speed, and its cohesion is read over the crawl only', () => {
    const windows = seconds(10, (at) =>
      at < 4
        ? { groupSpeedMps: CRAWL_MPS - 0.1, widestGapM: at === 0 ? 9 : 1 }
        : { groupSpeedMps: CRAWL_MPS, widestGapM: 9 },
    );
    const score = scoreRide(record(windows));
    expect(score.crawlSeconds).toBe(4);
    expect(score.crawlCohesion).toBe(0.75);
    expect(scoreRide(record(seconds(5))).crawlCohesion).toBeNull();
  });

  it("the group's speed swing is read while it rotates, not while it waits", () => {
    const windows = [
      window(1, { phase: 'waiting', groupSpeedMps: 0 }),
      window(2, { groupSpeedMps: 5 }),
      window(3, { phase: 'changing', groupSpeedMps: 10 }),
    ];
    const score = scoreRide(record(windows));
    expect(score.groupSpeedLeastKmh).toBe(18);
    expect(score.groupSpeedMostKmh).toBe(36);
  });
});

describe('the marks', () => {
  it('a mark holds at its bound and not past it, and never with no score', () => {
    expect(holds({ most: 1 }, 1)).toBe(true);
    expect(holds({ most: 1 }, 1.001)).toBe(false);
    expect(holds({ least: 1 }, 0)).toBe(false);
    expect(holds({ least: 1 }, null)).toBe(false);
    expect(holds({ most: 0 }, Number.NaN)).toBe(false);
  });

  it('a weak rider left behind at the finish is below the no-drop mark', () => {
    const left = scoreRide(record(seconds(600), { finishBehindM: DRAFT_REACH_METRES + 1 }));
    const back = scoreRide(record(seconds(600), { finishBehindM: DRAFT_REACH_METRES }));
    const passed = (score: typeof left) =>
      markRide('weak', 'hilly', score).map((each) => [each.mark, each.passed]);
    expect(passed(left)).toEqual([
      ['finishes-with-group', false],
      ['stays-in-reach', true],
    ]);
    expect(passed(back)).toEqual([
      ['finishes-with-group', true],
      ['stays-in-reach', true],
    ]);
  });

  it('a rider the group does not wait for is below the reach mark, past the recovery time and not at it', () => {
    const behind = (beyond: number) =>
      scoreRide(
        record(seconds(600, (at) => ({ behindM: at < beyond ? DRAFT_REACH_METRES + 1 : 0 }))),
      );
    const reach = (score: ReturnType<typeof behind>) =>
      markRide('absent', 'flat', score).find((each) => each.mark === 'stays-in-reach')?.passed;
    expect(reach(behind(RECOVERY_SECONDS))).toBe(true);
    expect(reach(behind(RECOVERY_SECONDS + 1))).toBe(false);
  });

  it('the steady rider is held to the average on the hilly course only, and to no correction and the ceiling everywhere', () => {
    expect(
      markRide('steady', 'flat', scoreRide(record(seconds(600)))).map((each) => each.mark),
    ).toEqual(['no-correction', 'cue-ceiling']);
    const nagged = scoreRide(
      record(seconds(60), {
        cues: Array.from({ length: Math.floor(CUE_CEILING_PER_MINUTE) + 1 }, (_, at) => ({
          kind: 'next-up' as const,
          seconds: at,
        })),
        marks: { ...NO_MARKS, 'close-gap': 1 },
        groupFinishSeconds: 600 * 1.02,
        riderFinishSeconds: 60,
      }),
    );
    expect(markRide('steady', 'hilly', nagged).map((each) => [each.mark, each.passed])).toEqual([
      ['makes-the-average', false],
      ['no-correction', false],
      ['cue-ceiling', false],
    ]);
  });

  it("the bound on a turn on the front is the rotation's pull, grace and fade dwell as they stand", () => {
    // A change to any of the three is a change to the mark: move it in the same change, on purpose.
    expect(STUCK_ON_FRONT_SECONDS * 1_000).toBe(
      ROTATION_RIDER_PULL_MS + ROTATION_RIDER_GRACE_MS + ROTATION_FADE_DWELL_MS,
    );
  });

  it('a rider who never presses is held to a turn on the front and to being passed within the bound', () => {
    const stuck = seconds(60, (at) => ({
      front: GROUP_RIDE_RIDER_ID,
      role: at < STUCK_ON_FRONT_SECONDS + 1 ? 'on-front' : 'in-line',
    }));
    expect(
      markRide('never-presses', 'flat', scoreRide(record(stuck))).map((each) => each.passed),
    ).toEqual([true, false]);
    expect(
      markRide('never-presses', 'flat', scoreRide(record(seconds(60)))).map((each) => each.passed),
    ).toEqual([false, true]);
  });

  it('the surger is held to a surging correction on the flat and hilly courses, not the rolling one', () => {
    const none = scoreRide(record(seconds(60)));
    expect(markRide('surger', 'flat', none).map((each) => each.passed)).toEqual([false]);
    expect(markRide('surger', 'rolling', none)).toEqual([]);
  });
});
