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
