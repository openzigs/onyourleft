// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road ahead — #2075. Pure arithmetic over a synthetic route, so a plain
 * `*.test.ts`; what reaches the rendered HUD is `look-ahead-strip.test.tsx`.
 *
 * The route is built through the real `routeProfile` from elevations, so the
 * grades the strip bands by are the ones the trainer would be sent and the
 * slopes it names are the ones the announcer finds.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { slopeAhead, slopesOf } from './climb-ahead';
import {
  GRADE_BANDS,
  LOOK_AHEAD_METRES,
  LOOK_AHEAD_RISE_METRES,
  gradeBand,
  lookAhead,
  nextClimbLabel,
  nextClimbText,
} from './look-ahead';

const STEP = 10;

/**
 * A route through these elevations, one every 10 m, due north. Real
 * `routeProfile`, so its despike and gradient windows apply as on a ride.
 */
function route(elevations: readonly number[]): RouteProfile {
  const points: RoutePoint[] = elevations.map((elevation, index) => ({
    position: geographicPosition(
      degreesLatitude(51.5 + (index * STEP) / 111_320),
      degreesLongitude(-0.12),
    ),
    elevation: altitudeMetres(elevation),
  }));
  return routeProfile(points);
}

/**
 * A LOOP through these elevations: a circle whose last point is its first, so
 * `routeProfile` accepts it as one, about 10 m between points.
 */
function loopRoute(elevations: readonly number[]): RouteProfile {
  const segments = elevations.length - 1;
  const radius = (segments * STEP) / (2 * Math.PI);
  const metresPerDegree = 111_320;
  const points: RoutePoint[] = elevations.map((elevation, index) => {
    const angle = (2 * Math.PI * index) / segments;
    return {
      position: geographicPosition(
        degreesLatitude(51.5 + (radius * Math.sin(angle)) / metresPerDegree),
        degreesLongitude(
          -0.12 + (radius * Math.cos(angle)) / (metresPerDegree * Math.cos((51.5 * Math.PI) / 180)),
        ),
      ),
      elevation: altitudeMetres(elevation),
    };
  });
  return routeProfile(points, { loop: true });
}

/** `metres` of road at `grade` per cent, from `from` metres up. */
function rise(from: number, metres: number, grade: number): number[] {
  return Array.from(
    { length: metres / STEP },
    (_, index) => from + ((index + 1) * STEP * grade) / 100,
  );
}

/**
 * The synthetic climb: 1 km flat at 100 m, a 600 m climb at 6 %, 1.4 km flat
 * at the top. 3 km, ending at 136 m.
 */
const CLIMB = [100, ...rise(100, 1000, 0), ...rise(100, 600, 6), ...rise(136, 1400, 0)];

describe('the grade bands (#2075)', () => {
  it('are five, gentlest first, each with its own pattern', () => {
    expect(GRADE_BANDS.map((band) => band.key)).toEqual([
      'descent',
      'flat',
      'climb',
      'steep',
      'wall',
    ]);
    expect(new Set(GRADE_BANDS.map((band) => band.pattern)).size).toBe(GRADE_BANDS.length);
  });

  it('puts each grade in its band, with the announcer’s 3 % as the flat’s edges', () => {
    expect(gradeBand(-8).key).toBe('descent');
    expect(gradeBand(-3).key).toBe('descent');
    expect(gradeBand(-2.9).key).toBe('flat');
    expect(gradeBand(2.9).key).toBe('flat');
    expect(gradeBand(3).key).toBe('climb');
    expect(gradeBand(5.9).key).toBe('climb');
    expect(gradeBand(6).key).toBe('steep');
    expect(gradeBand(9).key).toBe('wall');
    expect(gradeBand(20).key).toBe('wall');
  });
});

describe('the next kilometre of a synthetic climb (#2075)', () => {
  const profile = route(CLIMB);

  it('draws the window from the rider forward, sampled on the profile’s grid', () => {
    const ahead = lookAhead(profile, 500);
    expect(ahead.length).toBe(LOOK_AHEAD_METRES);
    expect(ahead.points[0]?.ahead).toBe(0);
    expect(ahead.points.at(-1)?.ahead).toBe(LOOK_AHEAD_METRES);
  });

  it('is at a fixed scale: the climb rises its own metres, not the strip’s height', () => {
    // From 1 km the window holds 600 m of 6 % (36 m) and 400 m of flat.
    const ahead = lookAhead(profile, 1000);
    const top = Math.max(...ahead.points.map((point) => point.height));
    expect(top).toBeGreaterThan(30);
    expect(top).toBeLessThan(40);
    // A min-max stretch would put the top at the strip's full height.
    expect(top).toBeLessThan(LOOK_AHEAD_RISE_METRES);
    // And the rider, at the foot, is on the floor.
    expect(ahead.riderHeight).toBeCloseTo(0, 0);
  });

  it('draws the same climb the same height wherever it is in the window', () => {
    const near = lookAhead(profile, 1000);
    const far = lookAhead(profile, 1300);
    const rise = (heights: readonly number[]): number =>
      Math.max(...heights) - Math.min(...heights);
    // 600 m of climb in the first window, 300 m in the second: half the rise.
    expect(rise(far.points.filter((p) => p.ahead <= 300).map((p) => p.height))).toBeCloseTo(
      rise(near.points.filter((p) => p.ahead >= 300 && p.ahead <= 600).map((p) => p.height)),
      0,
    );
  });

  it('bands the flat as flat and the 6 % climb as steep, and covers the window', () => {
    const ahead = lookAhead(profile, 600);
    const bands = ahead.runs.map((run) => run.band);
    expect(bands[0]).toBe('flat');
    expect(bands).toContain('steep');
    expect(ahead.runs[0]?.start).toBe(0);
    expect(ahead.runs.at(-1)?.end).toBe(ahead.length);
    ahead.runs.slice(1).forEach((run, index) => {
      expect(run.start).toBe(ahead.runs[index]?.end);
    });
    // Where the strip leaves the flat is where the climb starts, within the
    // profile's smoothing windows: 400 m ahead of a rider at 600 m.
    const climbing = ahead.runs.find((run) => run.band !== 'flat');
    expect(climbing?.start).toBeGreaterThan(330);
    expect(climbing?.start).toBeLessThan(430);
  });

  it('names the next climb exactly as the announcer finds it', () => {
    const ahead = lookAhead(profile, 600);
    const announced = slopeAhead(
      slopesOf(profile).filter((slope) => slope.kind === 'climb'),
      profile,
      600,
      LOOK_AHEAD_METRES,
    );
    expect(ahead.nextClimb).toEqual(announced);
    expect(ahead.nextClimb?.slope.grade).toBeGreaterThan(5);
    expect(ahead.nextClimb?.slope.grade).toBeLessThan(7);
    expect(nextClimbText(ahead.nextClimb, 'metric')).toMatch(/^Climb in \d+0 m · 6 %$/);
    expect(nextClimbLabel(ahead.nextClimb, 'metric')).toMatch(
      /^next climb in \d+0 metres, 6 per cent average$/,
    );
  });

  it('says it in the rider’s own unit', () => {
    const ahead = lookAhead(profile, 600);
    expect(nextClimbText(ahead.nextClimb, 'imperial')).toMatch(/^Climb in \d+ ft · 6 %$/);
  });

  it('names no climb when none starts within the window, and says so', () => {
    // At 1.7 km the climb is behind and 1.3 km of flat is all that is left.
    const ahead = lookAhead(profile, 1700);
    expect(ahead.nextClimb).toBeUndefined();
    expect(nextClimbText(ahead.nextClimb, 'metric')).toBeUndefined();
    expect(nextClimbLabel(ahead.nextClimb, 'metric')).toBe('no climb in the next kilometre');
  });

  it('names the next CLIMB, not a nearer descent', () => {
    // 500 m flat, 300 m down at −5 %, 300 m flat, 400 m up at 6 %, 500 m flat.
    const valley = route([
      100,
      ...rise(100, 500, 0),
      ...rise(100, 300, -5),
      ...rise(85, 300, 0),
      ...rise(85, 400, 6),
      ...rise(109, 500, 0),
    ]);
    const ahead = lookAhead(valley, 300);
    expect(ahead.runs.map((run) => run.band)).toContain('descent');
    expect(ahead.nextClimb?.slope.kind).toBe('climb');
    // The climb starts 1.1 km in: 800 m ahead of a rider at 300 m.
    expect(ahead.nextClimb?.metresAhead).toBeGreaterThan(750);
    expect(ahead.nextClimb?.metresAhead).toBeLessThan(850);
  });

  it('names no climb the rider is already on', () => {
    expect(lookAhead(profile, 1200).nextClimb).toBeUndefined();
  });
});

describe('the end of the road and the lap seam (#2075)', () => {
  it('stops where a one-way route ends', () => {
    const profile = route(CLIMB);
    const total = profile.totalDistance as number;
    const ahead = lookAhead(profile, total - 400);
    expect(ahead.length).toBeCloseTo(400, 6);
    expect(ahead.points.at(-1)?.ahead).toBeCloseTo(400, 6);
    expect(lookAhead(profile, total + 200).length).toBe(0);
  });

  /**
   * A 2 km loop: 300 m flat at 100 m, a 300 m climb at 6 %, 300 m back down
   * at −6 % and 1.1 km flat to the line. The climb starts 300 m into a lap.
   */
  const LOOP = [
    100,
    ...rise(100, 300, 0),
    ...rise(100, 300, 6),
    ...rise(118, 300, -6),
    ...rise(100, 1100, 0),
  ];

  it('runs across the line on a loop, into the next lap’s climb', () => {
    const loop = loopRoute(LOOP);
    const total = loop.totalDistance as number;
    // 400 m before the line: the window is 400 m of this lap and 600 m of the
    // next, whose climb starts 300 m in — 700 m ahead.
    const nearLine = lookAhead(loop, total - 400);
    expect(nearLine.length).toBe(LOOK_AHEAD_METRES);
    expect(nearLine.nextClimb?.metresAhead).toBeGreaterThan(650);
    expect(nearLine.nextClimb?.metresAhead).toBeLessThan(750);
    const climbing = nearLine.runs.find((run) => run.band !== 'flat');
    expect(climbing?.start).toBeGreaterThan(600);
    expect(climbing?.start).toBeLessThan(750);
    // And it is drawn: the road past the line rises.
    expect(Math.max(...nearLine.points.map((point) => point.height))).toBeGreaterThan(10);
  });

  it('draws lap two’s road as lap one’s', () => {
    const loop = loopRoute(LOOP);
    const total = loop.totalDistance as number;
    const lapOne = lookAhead(loop, 100);
    const lapTwo = lookAhead(loop, total + 100);
    expect(lapTwo.runs).toEqual(lapOne.runs);
    expect(lapTwo.nextClimb?.metresAhead).toBeCloseTo(lapOne.nextClimb?.metresAhead ?? -1, 6);
    lapTwo.points.forEach((point, index) => {
      expect(point.height).toBeCloseTo(lapOne.points[index]?.height ?? Number.NaN, 6);
    });
  });
});

describe('a route with nothing to draw (#2075)', () => {
  it('is an empty strip, not a throw', () => {
    const flat = route([100, 100]);
    expect(lookAhead(flat, Number.NaN)).toEqual({
      length: 0,
      points: [],
      riderHeight: 0,
      runs: [],
      nextClimb: undefined,
    });
  });
});
