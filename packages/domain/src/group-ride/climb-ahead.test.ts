// SPDX-License-Identifier: Apache-2.0

/** The climb the line's front is told of, held to its crest — #3348. */

import { describe, expect, it } from 'vitest';

import type { BotCapacity } from '../lap-race/wbal';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
} from '../quantities';
import { courseHillsAhead } from '../route/course-ahead';
import { routeProfile, type RouteProfile } from '../route/profile';
import { LINE_CLIMB_EASING_METRES, lineClimbAheadM } from './climb-ahead';
import { GroupRideError } from './errors';
import { courseOf, type Stretch } from './fixtures/courses';
import { rideLine, type LineWindow } from './line-testing';
import { ROTATION_CLIMB_HOLD_METRES, type LineMember } from './rotation';

const STEP = 10;

/**
 * A made-up profile of straight pieces (`fixtures/courses.ts`: a 10 m grid,
 * unsmoothed), as a loop when asked. No place is real.
 */
function course(stretches: readonly Stretch[], loop = false): RouteProfile {
  return { ...courseOf(stretches), loop };
}

/**
 * The same stretches as {@link course}, built by `routeProfile` from points
 * every 5 m due east along the equator from 0° 0°: a made-up road, not a real
 * one. Its grades are a least-squares slope over 100 m, so they ramp in and
 * out of a climb rather than stepping: what a real caller holds.
 */
function built(stretches: readonly Stretch[]): RouteProfile {
  const length = stretches.reduce((sum, [long]) => sum + long, 0);
  const heightAt = (along: number): number => {
    let height = 100;
    let start = 0;
    for (const [long, grade] of stretches) {
      height += (Math.min(Math.max(0, along - start), long) * grade) / 100;
      start += long;
    }
    return height;
  };
  const metresPerDegree = 111_194.9;
  const points = [];
  for (let along = 0; along <= length; along += 5) {
    points.push({
      position: geographicPosition(degreesLatitude(0), degreesLongitude(along / metresPerDegree)),
      elevation: altitudeMetres(heightAt(along)),
    });
  }
  return routeProfile(points);
}

/** Every `step` metres from `from` up to, not including, `to`. */
function across(from: number, to: number, step: number): readonly number[] {
  const out: number[] = [];
  for (let at = from; at < to; at += step) out.push(at);
  return out;
}

/** The positions of `at` that do not read `want`. */
function misses(
  profile: RouteProfile,
  at: readonly number[],
  want: number | null,
): readonly number[] {
  return at.filter((where) => lineClimbAheadM(profile, where) !== want);
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

describe('a climb of the least length reads the same wherever the front is between samples (#3362)', () => {
  // A 200 m climb is 20 samples of the profile's 10 m grid, wherever the front stands on it.
  for (const grade of [5, 3.5]) {
    it(`is 0 all the way up a 200 m climb at ${grade} %, read every 0.25 m`, () => {
      const exact = course([
        [400, 0],
        [200, grade],
        [1_000, 0],
      ]);
      expect(misses(exact, across(400, 595, 0.25), 0)).toEqual([]);
      // The front is read at the sample nearest it: from 595 m that is the crest's.
      expect(misses(exact, across(595, 1_600, 0.25), null)).toEqual([]);
    });
  }

  it('a ramp a sample short of a climb is 0 nowhere on it', () => {
    const short = course([
      [400, 0],
      [190, 5],
      [1_000, 0],
    ]);
    expect(across(400, 590, 0.25).filter((at) => lineClimbAheadM(short, at) === 0)).toEqual([]);
  });
});

describe('a stepped climb is held to its top, over an easing shorter than LINE_CLIMB_EASING_METRES (#3362)', () => {
  it('is 0 over a 20 m easing and up the last 150 m ramp, and null from the top', () => {
    // 5 % from 300 m to 800 m, 20 m at 1 %, then 150 m at 5 % to the top at 970 m.
    const stepped = course([
      [300, 0],
      [500, 5],
      [20, 1],
      [150, 5],
      [1_000, 0],
    ]);
    expect(misses(stepped, across(300, 965, 0.5), 0)).toEqual([]);
    expect(misses(stepped, across(975, 1_970, 0.5), null)).toEqual([]);
  });

  it('carries the climb over more than one easing, the front on any of them', () => {
    const stairs = course([
      [300, 0],
      [300, 6],
      [40, 1],
      [150, 6],
      [60, 0],
      [150, 6],
      [1_000, 0],
    ]);
    // The second easing is level: an easing is any road under 3 %. The top is at 1 000 m.
    expect(misses(stairs, across(300, 995, 0.5), 0)).toEqual([]);
    expect(misses(stairs, across(1_005, 1_990, 0.5), null)).toEqual([]);
  });

  it(`ends the climb at an easing of ${LINE_CLIMB_EASING_METRES} m: a ramp after it is a ramp`, () => {
    const broken = course([
      [300, 0],
      [500, 5],
      [LINE_CLIMB_EASING_METRES, 1],
      [150, 5],
      [1_000, 0],
    ]);
    expect(lineClimbAheadM(broken, 790)).toBe(0);
    expect(misses(broken, across(805, 2_050, 0.5), null)).toEqual([]);
  });

  it('makes no climb of short ramps: one 200 m stretch at 3 % or more is still what starts one', () => {
    const ramps = course([
      [300, 0],
      [150, 6],
      [20, 1],
      [150, 6],
      [1_000, 0],
    ]);
    for (const at of across(0, 1_620, 0.5)) {
      expect([at, lineClimbAheadM(ramps, at)]).toEqual([at, null]);
    }
  });

  it('answers on a loop that is short ramps and short easings all the way round', () => {
    // Every easing bridges, so the walk back would go round for ever without its bound.
    const round = course(
      Array.from({ length: 10 }, (): readonly Stretch[] => [
        [150, 6],
        [50, 0],
      ]).flat(),
      true,
    );
    for (const at of [0, 75, 160, 1_000, 1_990]) {
      expect([at, lineClimbAheadM(round, at)]).toEqual([at, null]);
    }
  });
});

describe('on a profile routeProfile built (#3362)', () => {
  it('is 0 up a smoothed climb to near its crest, and null past it', () => {
    // 5 % from 1 000 m to 1 600 m. The smoothed grade crosses 3 % a few metres inside each end.
    const smooth = built([
      [1_000, 0],
      [600, 5],
      [1_400, 0],
    ]);
    expect(misses(smooth, across(1_020, 1_580, 0.5), 0)).toEqual([]);
    expect(misses(smooth, across(1_620, 3_000, 0.5), null)).toEqual([]);
    expect(lineClimbAheadM(smooth, 800)).toBeGreaterThan(150);
    expect(lineClimbAheadM(smooth, 800)).toBeLessThan(250);
  });

  it('holds a smoothed stepped climb over both easings to its top at 1 950 m', () => {
    // 300 m at 6 %, 100 m at 1 %, 300 m at 6 %, 100 m at 1 %, 150 m at 6 %.
    const stepped = built([
      [1_000, 0],
      [300, 6],
      [100, 1],
      [300, 6],
      [100, 1],
      [150, 6],
      [1_000, 0],
    ]);
    expect(misses(stepped, across(1_020, 1_930, 0.5), 0)).toEqual([]);
    expect(misses(stepped, across(1_970, 2_950, 0.5), null)).toEqual([]);
  });

  it('holds a climb across a loop’s start on the loop routeProfile closed', () => {
    // A square loop, 500 m a side, climbing its last 250 m and its first 250 m at 6 %.
    // routeProfile fits each end's grade on its own side of the line, so the smoothed
    // grade sags to about 3 % at the seam: the easing that bridges is the seam's own.
    const side = 500;
    const metresPerDegree = 111_194.9;
    const corner = (east: number, north: number) =>
      geographicPosition(
        degreesLatitude(north / metresPerDegree),
        degreesLongitude(east / metresPerDegree),
      );
    const heightAt = (along: number): number =>
      along <= 250
        ? along * 0.06
        : along < 1_750
          ? 15 - ((along - 250) / 1_500) * 30
          : (along - 2_000) * 0.06;
    const points = [];
    for (let along = 0; along < 4 * side; along += 5) {
      const leg = Math.floor(along / side);
      const into = along - leg * side;
      const [east, north] =
        leg === 0
          ? [into, 0]
          : leg === 1
            ? [side, into]
            : leg === 2
              ? [side - into, side]
              : [0, side - into];
      points.push({
        position: corner(east, north),
        elevation: altitudeMetres(100 + heightAt(along)),
      });
    }
    const loop = routeProfile(points, { loop: true });
    const total = loop.totalDistance as number;
    expect(loop.grades[0] as number).toBeLessThan(3.5);
    expect(misses(loop, [...across(total - 230, total, 0.5), ...across(0, 230, 0.5)], 0)).toEqual(
      [],
    );
    // A second lap reads the same road, and the crest is over.
    expect(lineClimbAheadM(loop, total + 60)).toBe(0);
    expect(lineClimbAheadM(loop, 300)).toBeGreaterThan(1_000);
  });
});

describe('the end of a route that is not a loop (#3362)', () => {
  // A summit finish: level to 1 000 m, then 5 % to the line at 1 500 m.
  const summit = course([
    [1_000, 0],
    [500, 5],
  ]);

  it('is 0 up to the line and null at it and past it', () => {
    expect(lineClimbAheadM(summit, 1_499)).toBe(0);
    for (const at of [1_500, 1_500.5, 1_600, 10_000]) {
      expect([at, lineClimbAheadM(summit, at)]).toEqual([at, null]);
    }
  });

  it('lets a line that rides on past the line change again', () => {
    const windows = rideLine({
      line: FIVE_BOTS,
      seed: 2,
      seconds: 400,
      climbAheadM: (at) => lineClimbAheadM(summit, at),
    }).windows;
    const past = changes(windows).filter((window) => frontM(window) >= 1_500);
    expect(past.length).toBeGreaterThan(0);
  });
});

describe('a profile with no spacing is refused (#3362)', () => {
  for (const resolution of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`throws view-out-of-range for a resolution of ${resolution}, on a climb or off one`, () => {
      // Cast past `metres`, which refuses most of these: a stored or hand-built profile need not have passed it.
      const bad = { ...CLIMB, resolution } as unknown as RouteProfile;
      for (const at of [0, 500]) {
        let thrown: unknown;
        try {
          lineClimbAheadM(bad, at);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(GroupRideError);
        expect((thrown as GroupRideError).code).toBe('view-out-of-range');
        expect((thrown as GroupRideError).message).not.toMatch(/\d/);
      }
    });
  }
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
