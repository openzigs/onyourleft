// SPDX-License-Identifier: Apache-2.0

/** The climb the line's front is told of, held to its crest — #3348. */

import { describe, expect, it } from 'vitest';

import type { BotCapacity } from '../lap-race/wbal';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
} from '../quantities';
import { courseHillsAhead } from '../route/course-ahead';
import type { RouteProfile } from '../route/profile';
import { lineClimbAheadM } from './climb-ahead';
import { rideLine, type LineWindow } from './line-testing';
import { ROTATION_CLIMB_HOLD_METRES, type LineMember } from './rotation';

const STEP = 10;

/**
 * A made-up profile on a 10 m grid of straight pieces, each `[metres, grade %]`,
 * from 100 m up: the grade at each sample is the slope to the next one, so a
 * piece is on its grade from its first sample to its last. No place is real.
 */
function course(stretches: readonly (readonly [number, number])[], loop = false): RouteProfile {
  const length = stretches.reduce((sum, [run]) => sum + run, 0);
  const heightAt = (along: number): number => {
    let height = 100;
    let start = 0;
    for (const [run, grade] of stretches) {
      height += (Math.min(Math.max(0, along - start), run) * grade) / 100;
      start += run;
    }
    return height;
  };
  const heights = Array.from({ length: Math.round(length / STEP) + 1 }, (_, at) =>
    heightAt(at * STEP),
  );
  const grades = heights.map((value, at) => {
    const next = heights[at + 1];
    // The last sample keeps the slope into it, as a real profile's end does.
    const prior = heights[at - 1] ?? value;
    return ((next === undefined ? value - prior : next - value) / STEP) * 100;
  });
  return {
    loop,
    resolution: metres(STEP),
    totalDistance: metres(length),
    totalAscent: metres(0),
    totalDescent: metres(0),
    elevations: heights.map((value) => altitudeMetres(value)),
    grades: grades.map((value) => gradePercent(value)),
    positions: heights.map(() => geographicPosition(degreesLatitude(0), degreesLongitude(0))),
  };
}

/** Level to 400 m, a 5 % climb from 400 m to its crest at 1 000 m, level to 2 000 m. */
const CLIMB = course([
  [400, 0],
  [600, 5],
  [1_000, 0],
]);

function bot(id: string): LineMember {
  const capacity: BotCapacity = {
    cpWatts: 250,
    wPrimeJoules: 18_000,
    peakWatts: 450,
    floorWatts: 200,
  };
  return { id, kind: 'bot', capacity };
}

const FIVE_BOTS: readonly LineMember[] = [bot('b1'), bot('b2'), bot('b3'), bot('b4'), bot('b5')];

/** The windows in which a pull change started: the line went from `steady` to `changing`. */
function changes(windows: readonly LineWindow[]): readonly LineWindow[] {
  return windows.filter(
    (window, at) => window.phase === 'changing' && windows[at - 1]?.phase === 'steady',
  );
}

/** Where the front was when a window decided: the furthest odometer in its view. */
function frontM(window: LineWindow): number {
  return Math.max(...Object.values(window.view.members).map((member) => member.distanceM));
}

describe('lineClimbAheadM: the next climb, held to its crest', () => {
  it('counts down to the climb, and is 0 from its start to its crest', () => {
    expect(lineClimbAheadM(CLIMB, 0)).toBe(400);
    expect(lineClimbAheadM(CLIMB, 100)).toBe(300);
    expect(lineClimbAheadM(CLIMB, 390)).toBe(10);
    for (let at = 400; at <= 990; at += STEP) {
      expect([at, lineClimbAheadM(CLIMB, at)]).toEqual([at, 0]);
    }
    // Between samples too: the front's odometer is never on the grid.
    expect(lineClimbAheadM(CLIMB, 803.7)).toBe(0);
    expect(lineClimbAheadM(CLIMB, 988.2)).toBe(0);
  });

  it('is on the climb in its last 200 m, where courseHillsAhead reports none ahead', () => {
    // What #3348 is: the summary for a model sees only the road ahead.
    expect(courseHillsAhead(CLIMB, 800).climb?.inM).toBe(0);
    for (const at of [810, 850, 900, 950, 990]) {
      expect([at, courseHillsAhead(CLIMB, at).climb]).toEqual([at, null]);
      expect([at, lineClimbAheadM(CLIMB, at)]).toEqual([at, 0]);
    }
  });

  it('is over at the crest: null with no climb left, or the metres to the next one', () => {
    expect(lineClimbAheadM(CLIMB, 1_000)).toBeNull();
    expect(lineClimbAheadM(CLIMB, 1_500)).toBeNull();
    const two = course([
      [600, 5],
      [500, 0],
      [400, 4],
      [500, 0],
    ]);
    expect(lineClimbAheadM(two, 590)).toBe(0);
    expect(lineClimbAheadM(two, 600)).toBe(500);
    expect(lineClimbAheadM(two, 1_100)).toBe(0);
    expect(lineClimbAheadM(two, 1_490)).toBe(0);
    expect(lineClimbAheadM(two, 1_500)).toBeNull();
  });

  it('a ramp shorter than a climb holds nothing, on it or before it', () => {
    const ramp = course([
      [500, 0],
      [150, 6],
      [1_000, 0],
    ]);
    for (let at = 0; at <= 1_600; at += STEP) {
      expect([at, lineClimbAheadM(ramp, at)]).toEqual([at, null]);
    }
  });

  it('a route that is not a loop has no road before its start or past its end', () => {
    // 100 m of ramp at each end: neither is a climb, however the ends are read.
    const ends = course([
      [100, 5],
      [800, 0],
      [100, 5],
    ]);
    for (const at of [0, 50, 90, 900, 950, 1_000]) {
      expect([at, lineClimbAheadM(ends, at)]).toEqual([at, null]);
    }
  });

  it('a climb across a loop’s start is one climb, held to its crest', () => {
    // 150 m up to the line and 150 m up from it; the height comes back down between.
    const loop = course(
      [
        [150, 5],
        [200, 0],
        [600, -2.5],
        [900, 0],
        [150, 5],
      ],
      true,
    );
    expect(lineClimbAheadM(loop, 1_850)).toBe(0);
    expect(lineClimbAheadM(loop, 1_990)).toBe(0);
    expect(lineClimbAheadM(loop, 0)).toBe(0);
    expect(lineClimbAheadM(loop, 140)).toBe(0);
    // A second lap reads the same road.
    expect(lineClimbAheadM(loop, 2_140)).toBe(0);
    expect(lineClimbAheadM(loop, 150)).toBe(1_700);
  });
});

describe('through stepRotation: no pull change from the hold’s start to the crest (#3348)', () => {
  // The first pull is due at about 30 s, when the front is about 250 m in:
  // inside the hold, which starts 300 m before the climb's 400 m.
  const ride = (climbAheadM: (frontM: number) => number | null) =>
    rideLine({ line: FIVE_BOTS, seed: 2, seconds: 240, climbAheadM }).windows;

  it('starts none between 300 m before the climb and its crest, and the first one just over it', () => {
    const windows = ride((at) => lineClimbAheadM(CLIMB, at));
    const starts = changes(windows);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.map(frontM).filter((at) => at >= 110 && at <= 990)).toEqual([]);
    for (const change of starts) {
      const ahead = change.view.climbAheadM;
      expect(ahead === null || ahead > ROTATION_CLIMB_HOLD_METRES).toBe(true);
    }
    // Deferred, not dropped: the change starts in the first window past the crest.
    const first = starts[0] as LineWindow;
    expect(frontM(first)).toBeGreaterThan(990);
    expect(frontM(first)).toBeLessThan(1_010);
    expect(windows[windows.indexOf(first) - 1]?.view.climbAheadM).toBe(0);
    // With no climb the same line changes at about 30 s: the hold is what deferred it.
    const flat = changes(ride(() => null))[0] as LineWindow;
    expect(frontM(flat)).toBeLessThan(400);
  });

  it('fed courseHillsAhead alone, the same line changes 200 m before the crest', () => {
    // The defect, kept in sight: this is why the view is not fed that number.
    const starts = changes(ride((at) => courseHillsAhead(CLIMB, at).climb?.inM ?? null));
    const first = frontM(starts[0] as LineWindow);
    expect(first).toBeGreaterThan(800);
    expect(first).toBeLessThan(830);
  });
});
