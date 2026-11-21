// SPDX-License-Identifier: Apache-2.0

/** The course ahead as the AI bots and the AI pacer are shown it — #2794. */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
} from '../quantities';
import {
  COURSE_AHEAD_MOST_METRES,
  COURSE_HILL_GRADE_PERCENT,
  COURSE_HILL_LEAST_METRES,
  courseAverageGrade,
  courseClimbing,
  courseHillsAhead,
  isCourseHill,
} from './course-ahead';
import type { RouteProfile } from './profile';

const STEP = 10;

/**
 * A profile on a 10 m grid whose heights are `height` exactly, and whose
 * grade at each sample is the slope to the next one: so a stretch of road is
 * on its grade from its first sample to its last, with no smoothing between.
 */
function profileOf(height: (along: number) => number, length: number, loop = false): RouteProfile {
  const count = Math.round(length / STEP) + 1;
  const heights = Array.from({ length: count }, (_, at) => height(at * STEP));
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

/** Heights along a road of straight pieces: each `[metres, grade %]`, from 100 m up. */
function pieces(...stretches: readonly (readonly [number, number])[]): (along: number) => number {
  return (along) => {
    let height = 100;
    let start = 0;
    for (const [length, grade] of stretches) {
      const on = Math.min(Math.max(0, along - start), length);
      height += (on * grade) / 100;
      start += length;
    }
    return height;
  };
}

/** Flat 1 km, 500 m at 6 %, flat 1 km, 400 m at −5 %, flat 2.1 km: 5 km, not a loop. */
const ROLLING = profileOf(pieces([1_000, 0], [500, 6], [1_000, 0], [400, -5], [2_100, 0]), 5_000);

/** A closed 5 km loop: flat 1 km, 500 m at 6 %, flat 1 km, 600 m at −5 %, flat 1.9 km. */
const LOOP = profileOf(
  pieces([1_000, 0], [500, 6], [1_000, 0], [600, -5], [1_900, 0]),
  5_000,
  true,
);

describe('courseHillsAhead', () => {
  it('finds the next climb and the next descent: how far, how long, how steep on average and at most', () => {
    expect(courseHillsAhead(ROLLING, 0)).toEqual({
      climb: { inM: 1_000, lengthM: 500, avgPct: 6, maxPct: 6 },
      descent: { inM: 2_500, lengthM: 400, avgPct: -5, maxPct: -5 },
    });
  });

  it('says nothing ahead on a flat road', () => {
    expect(
      courseHillsAhead(
        profileOf(() => 50, 3_000),
        0,
      ),
    ).toEqual({
      climb: null,
      descent: null,
    });
  });

  it('counts a road already on a climb from where it is, and only the climb still ahead', () => {
    expect(courseHillsAhead(ROLLING, 1_200).climb).toEqual({
      inM: 0,
      lengthM: 300,
      avgPct: 6,
      maxPct: 6,
    });
    // 150 m from the top is no significant climb ahead: there is none after it.
    expect(courseHillsAhead(ROLLING, 1_350).climb).toBeNull();
  });

  it('holds to the stated thresholds: a ramp too short or too shallow is no climb', () => {
    const short = COURSE_HILL_LEAST_METRES - STEP;
    const shallow = COURSE_HILL_GRADE_PERCENT - 0.5;
    const road = profileOf(
      pieces(
        [500, 0],
        [short, 9],
        [500, 0],
        [600, shallow],
        [500, 0],
        [COURSE_HILL_LEAST_METRES, 4],
      ),
      3_000,
    );
    expect(courseHillsAhead(road, 0).climb).toEqual({
      inM: 500 + short + 500 + 600 + 500,
      lengthM: COURSE_HILL_LEAST_METRES,
      avgPct: 4,
      maxPct: 4,
    });
  });

  it('gives a climb in two pitches its average and its steepest', () => {
    const road = profileOf(pieces([300, 0], [400, 4], [200, 9], [1_100, 0]), 2_000);
    expect(courseHillsAhead(road, 0).climb).toEqual({
      inM: 300,
      lengthM: 600,
      // 16 m and 18 m up over 600 m.
      avgPct: 6,
      maxPct: 9,
    });
  });

  it('looks no further than its reach, and cuts a climb short where the reach ends', () => {
    const far = profileOf(pieces([COURSE_AHEAD_MOST_METRES + 100, 0], [500, 6], [400, 0]), 6_000);
    expect(courseHillsAhead(far, 0).climb).toBeNull();
    // Nor further for a caller that asks it to.
    expect(courseHillsAhead(far, 0, 10_000).climb).toBeNull();
    const across = profileOf(
      pieces([COURSE_AHEAD_MOST_METRES - 300, 0], [600, 6], [700, 0]),
      6_000,
    );
    expect(courseHillsAhead(across, 0).climb).toEqual({
      inM: COURSE_AHEAD_MOST_METRES - 300,
      lengthM: 300,
      avgPct: 6,
      maxPct: 6,
    });
    // A shorter reach the caller asks for is held to as well.
    expect(courseHillsAhead(ROLLING, 0, 1_100).climb).toBeNull();
    expect(courseHillsAhead(ROLLING, 0, 1_200).climb).toMatchObject({ inM: 1_000, lengthM: 200 });
  });

  it('wraps round a loop to the climb after the line, and stops at the end of a road that is not one', () => {
    const shape = pieces([300, 6], [2_700, 0], [300, -6], [700, 0]);
    expect(courseHillsAhead(profileOf(shape, 4_000, true), 3_500).climb).toEqual({
      inM: 500,
      lengthM: 300,
      avgPct: 6,
      maxPct: 6,
    });
    expect(courseHillsAhead(profileOf(shape, 4_000, false), 3_500).climb).toBeNull();
  });

  it('ends a climb that runs to the end of a road that is not a loop at the end', () => {
    // The profile's last grade is the slope into it, which reads on past the end.
    const toTheTop = profileOf(pieces([700, 0], [300, 6]), 1_000);
    expect(courseHillsAhead(toTheTop, 0).climb).toEqual({
      inM: 700,
      lengthM: 300,
      avgPct: 6,
      maxPct: 6,
    });
  });

  it('reads a distance past the end of a loop on the loop', () => {
    expect(courseHillsAhead(LOOP, 5_000 * 2 + 700)).toEqual(courseHillsAhead(LOOP, 700));
    expect(courseHillsAhead(LOOP, 700).climb).toMatchObject({ inM: 300, lengthM: 500 });
  });
});

describe('courseClimbing', () => {
  it('counts the climbing left in a stretch', () => {
    expect(courseClimbing(ROLLING, 0, 5_000)).toBe(30);
    expect(courseClimbing(ROLLING, 1_250, 5_000)).toBe(15);
    expect(courseClimbing(ROLLING, 1_500, 5_000)).toBe(0);
  });

  it('wraps round a loop, and stops at the end of a road that is not one', () => {
    expect(courseClimbing(LOOP, 4_000, 2_600)).toBe(30);
    expect(courseClimbing(LOOP, 4_000, 2_000)).toBe(0);
    expect(courseClimbing(ROLLING, 4_000, 2_600)).toBe(0);
  });

  it('counts no wobble as climbing', () => {
    const wobble = profileOf((along) => 100 + Math.sin(along / 50), 2_000);
    expect(courseClimbing(wobble, 0, 2_000)).toBe(0);
  });
});

describe('courseAverageGrade', () => {
  it('is the rise over the run, whole percent', () => {
    expect(courseAverageGrade(ROLLING, 1_000, 1_500)).toBe(6);
    expect(courseAverageGrade(ROLLING, 2_500, 2_900)).toBe(-5);
    expect(courseAverageGrade(ROLLING, 1_000, 2_000)).toBe(3);
  });

  it('is nought for a stretch with no length', () => {
    expect(courseAverageGrade(ROLLING, 1_200, 1_200)).toBe(0);
  });

  it('reads across a loop’s line', () => {
    const loop = profileOf(pieces([300, 6], [3_700, -18 / 37]), 4_000, true);
    expect(courseAverageGrade(loop, 3_900, 4_200)).toBe(4);
  });
});

describe('isCourseHill', () => {
  const hill = { inM: 100, lengthM: 300, avgPct: 5, maxPct: 8 };

  it('takes a hill of exactly its shape', () => {
    expect(isCourseHill(hill)).toBe(true);
    expect(isCourseHill({ ...hill, avgPct: -5, maxPct: -8 })).toBe(true);
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      [],
      'hill',
      { ...hill, name: 'x' },
      { inM: 100, lengthM: 300, avgPct: 5 },
      { ...hill, inM: -10 },
      { ...hill, inM: COURSE_AHEAD_MOST_METRES + 10 },
      { ...hill, lengthM: Number.NaN },
      { ...hill, avgPct: 101 },
      { ...hill, maxPct: '8' },
    ]) {
      expect(isCourseHill(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
