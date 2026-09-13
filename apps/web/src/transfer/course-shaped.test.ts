// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The course heuristic, and above all the two files it must tell apart.
 *
 * ⚠️ The load-bearing case in this file is {@link realRideWithNoSensors}: a
 * genuine recorded ride carrying positions, elevation, a time on every point
 * and **no speed channel at all**, which is
 * [#231](https://github.com/openzigs/onyourleft/issues/231)'s file. #232 names
 * "has no speed channel" as a heuristic that must not be used, and this is the
 * fixture that makes that a test rather than a note.
 */

import { describe, expect, it } from 'vitest';

import {
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metresPerSecond,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import type { TrackPoint } from '@onyourleft/fit';

import {
  COURSE_SIGNAL_TEXT,
  PACE_SAMPLE_MINIMUM,
  courseNote,
  courseVerdict,
} from './course-shaped';

/** ADR 0004 decision G: every fixture coordinate is in the NULL-ISLAND region. */
const START_LATITUDE = 0.01;
const START_LONGITUDE = 0.02;

/** Metres per degree of longitude at the equator, near enough for a fixture. */
const METRES_PER_DEGREE = 111_320;

function positionAt(eastwardMetres: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(START_LATITUDE),
    degreesLongitude(START_LONGITUDE + eastwardMetres / METRES_PER_DEGREE),
  );
}

function emptyPoint(): TrackPoint {
  return {
    timestamp: undefined,
    position: undefined,
    altitude: undefined,
    distance: undefined,
    speed: undefined,
    heartRate: undefined,
    cadence: undefined,
    power: undefined,
    temperature: undefined,
  };
}

/**
 * A line walked at one speed from end to end — what a planner writes when it
 * puts times on a course at all.
 */
function courseWithSteadyPace(count = 40): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    points.push({
      ...emptyPoint(),
      timestamp: unixSeconds(1_700_000_000 + index * 2),
      position: positionAt(index * 10),
    });
  }
  return points;
}

/**
 * #231's file in miniature: real riding, so the step between fixes varies the
 * way a rider's speed does, and not one sensor channel anywhere.
 *
 * The steps run from 4 m to 14 m per second — 14 to 50 km/h — which is an
 * ordinary hour on a bicycle and many times the heuristic's tolerance.
 */
function realRideWithNoSensors(): TrackPoint[] {
  const steps = [4, 9, 12, 6, 14, 7, 5, 11, 13, 8];
  const points: TrackPoint[] = [];
  let distance = 0;
  for (let index = 0; index < 40; index += 1) {
    points.push({
      ...emptyPoint(),
      timestamp: unixSeconds(1_700_000_000 + index),
      position: positionAt(distance),
    });
    distance += steps[index % steps.length] ?? 0;
  }
  return points;
}

/**
 * Forty one-second steps of ten metres, with four of them a different length.
 *
 * Four out of forty is chosen so that the **other** edge of the band stays
 * inside it: at `2` the mean is 9.2 and the fast edge clears a 10 % band by
 * 0.12 m/s, at `20` the mean is 11 and the slow edge clears it by 0.1. Either
 * fixture alone would leave half of `hasSteadyPace`'s band deletable with the
 * suite still green, which is how a guard ends up untested while looking
 * covered.
 */
function lineWithFourStepsOf(odd: number): TrackPoint[] {
  const points: TrackPoint[] = [];
  let distance = 0;
  for (let index = 0; index <= 40; index += 1) {
    points.push({
      ...emptyPoint(),
      timestamp: unixSeconds(1_700_000_000 + index),
      position: positionAt(distance),
    });
    distance += index >= 20 && index < 24 ? odd : 10;
  }
  return points;
}

describe('courseVerdict', () => {
  it('calls a steadily paced line with no sensors a course', () => {
    const verdict = courseVerdict(courseWithSteadyPace());

    expect(verdict.courseShaped).toBe(true);
    expect(verdict.signals).toStrictEqual(['no-sensors', 'steady-pace']);
  });

  it('does NOT call a real ride with no speed channel a course', () => {
    // #231's file: positions, times, no sensors — and a pace that varies,
    // which is the half "has no speed channel" cannot see.
    const verdict = courseVerdict(realRideWithNoSensors());

    expect(verdict.signals).toStrictEqual(['no-sensors']);
    expect(verdict.courseShaped).toBe(false);
  });

  it('calls a positioned file with no time on any point a course outright', () => {
    const points = courseWithSteadyPace().map((point) => ({ ...point, timestamp: undefined }));

    const verdict = courseVerdict(points);

    // Decisive on its own: `steady-pace` cannot even be judged without times.
    expect(verdict.signals).toStrictEqual(['no-times', 'no-sensors']);
    expect(verdict.courseShaped).toBe(true);
  });

  it('does not call a steadily paced line with a sensor on it a course', () => {
    const points = courseWithSteadyPace().map((point) => ({
      ...point,
      heartRate: beatsPerMinute(132),
    }));

    const verdict = courseVerdict(points);

    expect(verdict.signals).toStrictEqual(['steady-pace']);
    expect(verdict.courseShaped).toBe(false);
  });

  it('counts a speed channel as a sensor reading, like power, heart rate and cadence', () => {
    const points = courseWithSteadyPace().map((point) => ({
      ...point,
      speed: metresPerSecond(5),
    }));

    expect(courseVerdict(points).signals).toStrictEqual(['steady-pace']);
  });

  it('says nothing about a file with no positions at all', () => {
    // An indoor trainer ride: times, maybe channels, and no line to make a
    // route out of. #231's last criterion keeps this importing cleanly, and
    // this keeps the screen from offering a route it could not build.
    const points = courseWithSteadyPace().map((point) => ({ ...point, position: undefined }));

    const verdict = courseVerdict(points);

    expect(verdict.courseShaped).toBe(false);
    expect(verdict.signals).toStrictEqual([]);
  });

  it('says nothing about an empty document', () => {
    expect(courseVerdict([])).toStrictEqual({ courseShaped: false, signals: [] });
  });

  it('will not judge a pace from fewer than the minimum number of steps', () => {
    // One step short of the minimum, so the only thing that changed is the
    // count. A handful of even steps is luck, not a planner.
    const points = courseWithSteadyPace(PACE_SAMPLE_MINIMUM);

    const verdict = courseVerdict(points);

    expect(verdict.signals).toStrictEqual(['no-sensors']);
    expect(verdict.courseShaped).toBe(false);
  });

  it('does not read a hole in the track as a slow step', () => {
    // Ten minutes between two fixes is a dropout, not a step ridden at one
    // metre per second. Skipping it keeps the rest of the line steady.
    const points = courseWithSteadyPace(60).map((point, index) =>
      index < 30 ? point : { ...point, timestamp: unixSeconds((point.timestamp ?? 0) + 600) },
    );

    expect(courseVerdict(points).courseShaped).toBe(true);
  });

  it('does not call a line with a pause in it a course, steady though the rest is', () => {
    // A rider held at a junction for four seconds and rolling at one speed
    // either side of it. The FAST edge of the band is satisfied — the quick
    // steps are all identical — so this is the fixture that makes the SLOW
    // half of the band a test rather than a line nothing exercises.
    const verdict = courseVerdict(lineWithFourStepsOf(2));

    expect(verdict.signals).toStrictEqual(['no-sensors']);
    expect(verdict.courseShaped).toBe(false);
  });

  it('does not call a line with a sprint in it a course, steady though the rest is', () => {
    // The mirror of the case above, and it is a separate fixture because a
    // single one cannot pin both edges: here the SLOW edge is satisfied and the
    // fast one is not, so between the two neither half of the band can be
    // deleted without a test going red.
    const verdict = courseVerdict(lineWithFourStepsOf(20));

    expect(verdict.signals).toStrictEqual(['no-sensors']);
    expect(verdict.courseShaped).toBe(false);
  });

  it('does not call a file that never moves a course', () => {
    // Every fix at the same place: a median speed of zero would otherwise make
    // every step "within ten per cent of the median" and flag a broken
    // recording as a planned line.
    const points = courseWithSteadyPace().map((point) => ({
      ...point,
      position: positionAt(0),
    }));

    expect(courseVerdict(points).courseShaped).toBe(false);
  });
});

describe('courseNote', () => {
  it('names every signal that fired', () => {
    const note = courseNote(courseVerdict(courseWithSteadyPace()));

    expect(note).toBe(
      'This looks like a course to ride rather than a ride you did: ' +
        `${COURSE_SIGNAL_TEXT['no-sensors']} and ${COURSE_SIGNAL_TEXT['steady-pace']}.`,
    );
  });

  it('reads as one clause when one signal decided it', () => {
    const points = courseWithSteadyPace(4).map((point) => ({
      ...point,
      timestamp: undefined,
      heartRate: beatsPerMinute(140),
    }));

    expect(courseNote(courseVerdict(points))).toBe(
      'This looks like a course to ride rather than a ride you did: ' +
        `${COURSE_SIGNAL_TEXT['no-times']}.`,
    );
  });

  it('is undefined for a file that is not course-shaped, so nothing renders a blank notice', () => {
    expect(courseNote(courseVerdict(realRideWithNoSensors()))).toBeUndefined();
  });
});
