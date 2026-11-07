// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The climb-ahead lookahead — #399. Pure arithmetic, so a plain `*.test.ts`;
 * the announcement reaching the HUD's region is `hud-announcer.a11y.test.tsx`.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import {
  MINIMUM_SLOPE_METRES,
  SLOPE_GRADE_PERCENT,
  slopeAhead,
  slopeEvent,
  slopeSentence,
  slopesOf,
  wholePercent,
  type SlopeAnnounced,
} from './climb-ahead';
import type { AnnouncementEvent } from './announce';

const RESOLUTION = 10;

/**
 * A profile with exactly these grades on a 10 m grid — the only fields this
 * module reads, and a real `RouteProfile` otherwise. The positions are a
 * straight line north so nothing here depends on geometry.
 */
function graded(grades: readonly number[], loop = false): RouteProfile {
  return {
    loop,
    resolution: metres(RESOLUTION),
    totalDistance: metres((grades.length - 1) * RESOLUTION),
    totalAscent: metres(0),
    totalDescent: metres(0),
    elevations: grades.map(() => altitudeMetres(0)),
    grades: grades.map((grade) => gradePercent(grade)),
    positions: grades.map((_, index) =>
      geographicPosition(
        degreesLatitude(51.5 + (index * RESOLUTION) / 111_320),
        degreesLongitude(-0.12),
      ),
    ),
  };
}

/** `count` samples of `grade`. */
const stretch = (count: number, grade: number): number[] => Array<number>(count).fill(grade);

/** 1 km flat, a 500 m climb at 6 %, 500 m flat, a 300 m descent at −5 %, 500 m flat. */
const ROLLING = [
  ...stretch(100, 0),
  ...stretch(50, 6),
  ...stretch(50, 0),
  ...stretch(30, -5),
  ...stretch(51, 0),
];

describe('what counts as a slope', () => {
  it('finds the climb and the descent, where they start and how steep', () => {
    const slopes = slopesOf(graded(ROLLING));
    expect(slopes.map((slope) => [slope.kind, slope.start, slope.length])).toEqual([
      ['climb', 1000, 500],
      ['descent', 2000, 300],
    ]);
    expect(slopes[0]?.grade).toBeCloseTo(6);
    expect(slopes[1]?.grade).toBeCloseTo(-5);
  });

  it('announces nothing on a road whose gradient wanders inside the threshold', () => {
    // ±2.9 %, flipping every sample — the "continuous unusable speech" failure
    // in a new place if anything thresholded on the SIGN rather than the size.
    const wandering = Array.from({ length: 400 }, (_, index) =>
      index % 2 === 0 ? SLOPE_GRADE_PERCENT - 0.1 : -(SLOPE_GRADE_PERCENT - 0.1),
    );
    const profile = graded(wandering);
    expect(slopesOf(profile)).toEqual([]);
    const events = ride(profile, 0, 3990, 5, 250);
    expect(events).toEqual([]);
  });

  it('announces nothing on a long, gentle roll that never reaches the threshold', () => {
    // ±2.5 % in half-kilometre swells: every stretch is far longer than the
    // minimum, so the ONLY thing between this road and a sentence every 500 m
    // is the grade threshold itself. (The case above cannot show that on its
    // own — its runs are one sample long and the minimum length drops them.)
    const rolling = Array.from({ length: 401 }, (_, index) =>
      Math.floor(index / 50) % 2 === 0 ? 2.5 : -2.5,
    );
    const profile = graded(rolling);
    expect(slopesOf(profile)).toEqual([]);
    expect(ride(profile, 0, 4000, 5, 250)).toEqual([]);
  });

  it('announces nothing on a real profile built from noisy elevation', () => {
    // Through the domain's own three windows: ±1.5 m of noise every 30 m on a
    // flat road. What reaches `grades` is what a GPX with a poor barometer
    // produces, and none of it is a hill.
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 300; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (index * 10) / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(50 + 1.5 * Math.sin((index * 10 * 2 * Math.PI) / 60)),
      });
    }
    const profile = routeProfile(points);
    expect(ride(profile, 0, profile.totalDistance as number, 5, 250)).toEqual([]);
  });

  it('does not call a stretch shorter than the minimum a slope', () => {
    const short = Math.floor(MINIMUM_SLOPE_METRES / RESOLUTION) - 1;
    expect(slopesOf(graded([...stretch(50, 0), ...stretch(short, 8), ...stretch(50, 0)]))).toEqual(
      [],
    );
  });

  it('does not split one climb at a short easing in the middle of it', () => {
    const slopes = slopesOf(
      graded([
        ...stretch(50, 0),
        ...stretch(20, 6),
        ...stretch(3, 1),
        ...stretch(20, 6),
        ...stretch(50, 0),
      ]),
    );
    expect(slopes).toHaveLength(1);
    expect(slopes[0]?.length).toBe(430);
  });
});

/**
 * #2291, the owner's screenshots of 2026-11-06: a 10 % climb said "9 %" and a
 * 4.5 % one "4 %". The profile's grade is a slope over a 100 m window, so a
 * climb's run starts and ends partway up the ramps that window draws; these
 * are those ramps, written out, either side of a steady body.
 */
describe('a climb’s average, as the rider is told it — #2291', () => {
  /** 1 km flat, a ramp up, 500 m at `grade`, the same ramp down, 500 m flat. */
  const ramped = (ramp: readonly number[], grade: number): RouteProfile =>
    graded([
      ...stretch(100, 0),
      ...ramp,
      ...stretch(50, grade),
      ...[...ramp].reverse(),
      ...stretch(50, 0),
    ]);

  it('is the mean over the climb’s body, not the ramps at its ends', () => {
    const gentle = slopesOf(ramped([1.5, 3.2, 4, 4.4], 4.5));
    expect(gentle).toHaveLength(1);
    // With its ramps the mean was 4.43, said "4".
    expect(gentle[0]?.grade).toBe(4.5);
    const hard = slopesOf(ramped([0.5, 1.3, 2.4, 3.6, 5, 6.4, 7.6, 8.7, 9.6], 10));
    // With its ramps 9.38, said "9". One sample of each ramp is inside the trim.
    expect(hard[0]?.grade).toBeCloseTo(9.985, 3);
    // The climb itself still starts and ends where it crosses the threshold.
    expect(gentle[0]?.start).toBe(1010);
    expect(gentle[0]?.length).toBe(560);
  });

  it('is said in whole percent, the gradient field’s tenth rounded half up', () => {
    expect(wholePercent(4.5)).toBe(5);
    // The gradient field shows 4.45 as 4.5, so the climb is "5", not "4".
    expect(wholePercent(4.45)).toBe(5);
    expect(wholePercent(4.4999)).toBe(5);
    expect(wholePercent(4.44)).toBe(4);
    expect(wholePercent(7)).toBe(7);
    expect(wholePercent(9.985)).toBe(10);
    expect(wholePercent(-10)).toBe(10);
  });

  it('reaches the voice: a 4.5 % climb is "5 percent", a 10 % one "10 percent"', () => {
    for (const [ramp, grade, said] of [
      [[1.5, 3.2, 4, 4.4], 4.5, '5 percent'],
      [[0.5, 1.3, 2.4, 3.6, 5, 6.4, 7.6, 8.7, 9.6], 10, '10 percent'],
    ] as const) {
      const profile = ramped(ramp, grade);
      const ahead = slopeAhead(slopesOf(profile), profile, 800, 250);
      expect(ahead === undefined ? '' : slopeSentence(ahead, 'metric')).toMatch(
        new RegExp(`^Climb in \\d+ metres, ${said}$`),
      );
    }
  });

  it('keeps the mean over all of a slope too short to have a body', () => {
    // Exactly MINIMUM_SLOPE_METRES (10 samples), then 110 m and 140 m: each
    // under three trims, so the mean is over every sample, never NaN, and
    // never one or a few samples from the middle.
    const peak = [3.5, 4, 5, 6, 7, 7, 6, 5, 4, 3.5];
    for (const pitch of [
      peak,
      [...peak.slice(0, 5), 8, ...peak.slice(5)],
      [...peak.slice(0, 5), 8, 8, 8, 8, ...peak.slice(5)],
    ]) {
      const slopes = slopesOf(graded([...stretch(100, 0), ...pitch, ...stretch(100, 0)]));
      const mean = pitch.reduce((sum, grade) => sum + grade, 0) / pitch.length;
      expect(slopes).toHaveLength(1);
      expect(slopes[0]?.length).toBe(pitch.length * RESOLUTION);
      expect(Number.isFinite(slopes[0]?.grade)).toBe(true);
      expect(slopes[0]?.grade).toBeCloseTo(mean, 10);
    }
    // At three trims (150 m) the body is taken: the middle 50 m, here 8 %.
    const long = [...peak.slice(0, 5), 8, 8, 8, 8, 8, ...peak.slice(5)];
    expect(
      slopesOf(graded([...stretch(100, 0), ...long, ...stretch(100, 0)]))[0]?.grade,
    ).toBeCloseTo(8, 10);
  });

  it('on a loop, takes the mean over both halves of a climb across the line', () => {
    // The tail at the end of the lap is 6 %, the head after the line 8 %.
    const profile = graded([...stretch(30, 8), ...stretch(150, 0), ...stretch(30, 6), 8], true);
    const slopes = slopesOf(profile);
    expect(slopes).toHaveLength(1);
    expect(slopes[0]?.grade).toBeGreaterThan(6.5);
  });
});

describe('the lookahead distance — criterion 1', () => {
  const profile = graded(ROLLING);
  const slopes = slopesOf(profile);
  const lead = 250;
  const climbStart = 1000;

  it('says it at D − N', () => {
    const found = slopeAhead(slopes, profile, climbStart - lead, lead);
    expect(found?.slope.kind).toBe('climb');
    expect(found?.metresAhead).toBeCloseTo(lead);
  });

  it('does not say it at D − N − ε', () => {
    expect(slopeAhead(slopes, profile, climbStart - lead - 0.01, lead)).toBeUndefined();
  });

  it('does not warn about a climb the rider is already on', () => {
    expect(slopeAhead(slopes, profile, climbStart + 10, 100)).toBeUndefined();
  });

  it('says each approach once, not once per frame', () => {
    const events = ride(profile, 0, 1700, 0.2, lead);
    expect(events.map((event) => event.text)).toEqual(['Climb in 250 metres, 6 percent']);
  });
});

describe('a climb and a descent are different words — criterion 3', () => {
  it('does not render the two identically', () => {
    const profile = graded(ROLLING);
    const [climb, descent] = slopesOf(profile);
    if (climb === undefined || descent === undefined) throw new Error('fixture has two slopes');
    const up = slopeSentence({ slope: climb, metresAhead: 250, approach: '0:0' }, 'metric');
    const down = slopeSentence({ slope: descent, metresAhead: 250, approach: '0:1' }, 'metric');
    expect(up).toBe('Climb in 250 metres, 6 percent');
    expect(down).toBe('Descent in 250 metres, 5 percent');
    // Not merely a sign: strip the numbers and the two must still differ.
    expect(up.replace(/[\d-]+/g, '')).not.toBe(down.replace(/[\d-]+/g, ''));
  });

  it('speaks the distance in the rider’s own unit, and no coordinate at all', () => {
    const profile = graded(ROLLING);
    const [climb] = slopesOf(profile);
    if (climb === undefined) throw new Error('fixture has a climb');
    const sentence = slopeSentence({ slope: climb, metresAhead: 250, approach: '0:0' }, 'imperial');
    expect(sentence).toBe('Climb in 820 feet, 6 percent');
    // ADR 0004 D: nothing that could be a latitude or a longitude.
    expect(sentence).toMatch(/^(Climb|Descent) in \d+ (metres|feet), \d+ percent$/);
  });

  it('says a quarter of a mile or more in miles to an imperial rider — #1440’s review', () => {
    const profile = graded(ROLLING);
    const [climb] = slopesOf(profile);
    if (climb === undefined) throw new Error('fixture has a climb');
    const said = (metresAhead: number, units: 'metric' | 'imperial'): string =>
      slopeSentence({ slope: climb, metresAhead, approach: '0:0' }, units);

    // First seen just inside the 0.25 mi and 0.5 mi steps (402.336 m, 804.672 m).
    expect(said(402, 'imperial')).toBe('Climb in 0.3 miles, 6 percent');
    expect(said(804, 'imperial')).toBe('Climb in 0.5 miles, 6 percent');
    // Under a quarter of a mile it is still feet, in tens.
    expect(said(400, 'imperial')).toBe('Climb in 1310 feet, 6 percent');
    // Metric is unchanged at the same distances.
    expect(said(804, 'metric')).toBe('Climb in 800 metres, 6 percent');
    expect(said(1500, 'metric')).toBe('Climb in 1500 metres, 6 percent');
    // ADR 0004 D still holds: a distance and a percent, no coordinate.
    expect(said(804, 'imperial')).toMatch(/^(Climb|Descent) in [\d.]+ miles, \d+ percent$/);
  });
});

describe('the wrapped position — criteria 4 and 5', () => {
  /** A 2 km loop: 500 m flat, a 500 m climb at 6 %, then flat back to the line. */
  const LOOP = [...stretch(50, 0), ...stretch(50, 6), ...stretch(101, 0)];

  it('warns a rider on lap TWO about lap two’s climb, at the same point as lap one', () => {
    const profile = graded(LOOP, true);
    const total = profile.totalDistance as number;
    // On lap two, 250 m before the climb: the route position is 250 m, the
    // odometer is a lap further on. A clamped position reads the end of the
    // route here and finds nothing — that is the mutation this test is for.
    const found = slopeAhead(slopesOf(profile), profile, total + 250, 250);
    expect(found?.slope.kind).toBe('climb');
    expect(found?.metresAhead).toBeCloseTo(250);
  });

  it('never warns a rider on lap two about lap one’s climb behind them', () => {
    const profile = graded(LOOP, true);
    const total = profile.totalDistance as number;
    // From just past lap two's climb to 300 m before lap three's: the climb
    // is behind the rider the whole way, and nothing may be said.
    const events = ride(profile, total + 1010, 2 * total - 1, 1, 250);
    expect(events).toEqual([]);
  });

  it('says a loop’s climb once per lap, and again on the next', () => {
    const profile = graded(LOOP, true);
    const total = profile.totalDistance as number;
    const events = ride(profile, 0, 3 * total, 1, 250);
    expect(events.map((event) => event.text)).toEqual([
      'Climb in 250 metres, 6 percent',
      'Climb in 250 metres, 6 percent',
      'Climb in 250 metres, 6 percent',
    ]);
  });

  it('warns across the line: lap two’s early climb from the end of lap one', () => {
    // A climb 100 m after the line. From 150 m before the line, it is 250 m
    // ahead — on the NEXT lap.
    const profile = graded([...stretch(10, 0), ...stretch(40, 6), ...stretch(151, 0)], true);
    const total = profile.totalDistance as number;
    const found = slopeAhead(slopesOf(profile), profile, total - 150, 250);
    expect(found?.metresAhead).toBeCloseTo(250);
  });

  it('treats a climb that runs across the line as ONE climb, starting where it starts', () => {
    // 150 m of climb at the end of the loop and 150 m more after the line:
    // one hill, announced once per lap, and never "a climb" at 0 m.
    const profile = graded([...stretch(15, 6), ...stretch(150, 0), ...stretch(36, 6)], true);
    const slopes = slopesOf(profile);
    expect(slopes).toHaveLength(1);
    expect(slopes[0]?.start).toBe(1650);
    expect(slopes[0]?.length).toBe(510);
    // Inside its tail after the line, nothing is ahead: the rider is on it.
    expect(
      slopeAhead(slopes, profile, (profile.totalDistance as number) + 50, 250),
    ).toBeUndefined();
    const total = profile.totalDistance as number;
    expect(ride(profile, 0, 2 * total, 1, 250).map((event) => event.text)).toEqual([
      'Climb in 250 metres, 6 percent',
      'Climb in 250 metres, 6 percent',
    ]);
  });

  it('says nothing on a point-to-point route ridden past its end — it does not wrap', () => {
    const profile = graded(LOOP, false);
    const total = profile.totalDistance as number;
    // Past the end of a one-way route, the same odometer that is "250 m before
    // the climb on lap two" of the loop above. The wrap and the clamp are right
    // in different cases, and confusing them is the defect.
    expect(slopeAhead(slopesOf(profile), profile, total + 250, 250)).toBeUndefined();
    expect(ride(profile, total, total + 2000, 1, 250)).toEqual([]);
  });
});

describe('never', () => {
  it('says nothing about a climb when the rider chose never', () => {
    expect(ride(graded(ROLLING), 0, 3000, 1, 'never')).toEqual([]);
  });
});

/** Ride from `from` to `to` in steps, collecting every event `slopeEvent` produced. */
function ride(
  profile: RouteProfile,
  from: number,
  to: number,
  step: number,
  lead: number | 'never',
): AnnouncementEvent[] {
  const slopes = slopesOf(profile);
  let announced: SlopeAnnounced = undefined;
  const events: AnnouncementEvent[] = [];
  for (let distance = from; distance <= to; distance += step) {
    const out = slopeEvent(announced, { slopes, profile, distance, lead, units: 'metric' });
    announced = out.announced;
    if (out.event !== undefined) events.push(out.event);
  }
  return events;
}
