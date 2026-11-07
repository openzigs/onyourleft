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
  MINIMUM_BAND_METRES,
  LOOK_AHEAD_RISE_METRES,
  climbAhead,
  gradeBand,
  lookAhead,
  nextClimbLabel,
  nextClimbText,
  routeBands,
  withoutSlivers,
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
    expect(nextClimbText(ahead.climb, 'metric')).toMatch(/^Climb in \d+0 m · 6 %$/);
    expect(nextClimbLabel(ahead.climb, 'metric')).toMatch(
      /^next climb in \d+0 metres, 6 per cent average, top in \d+0 metres$/,
    );
  });

  it('says it in the rider’s own unit', () => {
    const ahead = lookAhead(profile, 600);
    expect(nextClimbText(ahead.climb, 'imperial')).toMatch(/^Climb in \d+ ft · 6 %$/);
  });

  it('names no climb when none starts within the window, and says so', () => {
    // At 1.7 km the climb is behind and 1.3 km of flat is all that is left.
    const ahead = lookAhead(profile, 1700);
    expect(ahead.nextClimb).toBeUndefined();
    expect(ahead.climb).toBeUndefined();
    expect(nextClimbText(ahead.climb, 'metric')).toBeUndefined();
    expect(nextClimbLabel(ahead.climb, 'metric')).toBe('no climb in the next 2 kilometres');
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

/**
 * #2291's climb view: 2 km of road, and the top of the climb the rider is on
 * or of the next one, with its average grade — the announcer's own slopes.
 */
describe('the climb view (#2291)', () => {
  const profile = route(CLIMB);
  const climbs = slopesOf(profile).filter((slope) => slope.kind === 'climb');

  it('is 2 km of road at a tenth of that in height, so a grade keeps its angle', () => {
    expect(LOOK_AHEAD_METRES).toBe(2000);
    expect(LOOK_AHEAD_RISE_METRES).toBe(LOOK_AHEAD_METRES / 10);
    // From the start the window reaches past the climb's top at about 1.6 km.
    const ahead = lookAhead(profile, 0);
    expect(ahead.length).toBe(2000);
    expect(ahead.runs.map((run) => run.band).at(-1)).toBe('flat');
  });

  it('names the top of the next climb: where it starts and how long it is', () => {
    const ahead = lookAhead(profile, 600);
    const next = ahead.nextClimb;
    expect(ahead.climb?.where).toBe('ahead');
    expect(ahead.climb?.slope).toBe(next?.slope);
    expect(ahead.climb?.startsIn).toBe(next?.metresAhead);
    expect(ahead.climb?.topIn).toBeCloseTo((next?.metresAhead ?? 0) + (next?.slope.length ?? 0), 6);
    // The top is about 1.6 km along: a kilometre ahead of a rider at 600 m.
    expect(ahead.climb?.topIn).toBeGreaterThan(950);
    expect(ahead.climb?.topIn).toBeLessThan(1050);
  });

  it('names the climb the rider is ON, and how far it is to its top', () => {
    const ahead = lookAhead(profile, 1200);
    expect(ahead.climb?.where).toBe('on');
    expect(ahead.climb?.slope).toEqual(climbs[0]);
    expect(ahead.climb?.startsIn).toBe(0);
    // About 400 m of the 600 m climb is left.
    expect(ahead.climb?.topIn).toBeGreaterThan(350);
    expect(ahead.climb?.topIn).toBeLessThan(450);
    const nearer = lookAhead(profile, 1300).climb?.topIn ?? Number.NaN;
    expect((ahead.climb?.topIn ?? Number.NaN) - nearer).toBeCloseTo(100, 6);
    expect(nextClimbText(ahead.climb, 'metric')).toMatch(/^Top in \d+0 m · 6 %$/);
    expect(nextClimbLabel(ahead.climb, 'metric')).toMatch(
      /^on a climb, top in \d+0 metres, 6 per cent average$/,
    );
  });

  it('gives the climb’s average, as the announcer does, not the grade underfoot', () => {
    const ahead = lookAhead(profile, 1200);
    expect(ahead.climb?.slope.grade).toBe(climbs[0]?.grade);
  });

  it('names the climb on from its first metre until its top', () => {
    const climb = climbs[0];
    if (climb === undefined) throw new Error('no climb on the synthetic route');
    expect(climbAhead(profile, climb.start, undefined)?.where).toBe('on');
    expect(climbAhead(profile, climb.start - 1, undefined)).toBeUndefined();
    expect(climbAhead(profile, climb.start + climb.length - 1, undefined)?.where).toBe('on');
    expect(climbAhead(profile, climb.start + climb.length, undefined)).toBeUndefined();
  });

  it('names nothing on a route with nothing to draw', () => {
    expect(climbAhead(route([100, 100]), Number.NaN, undefined)).toBeUndefined();
  });

  /**
   * A 2 km loop whose one climb runs across the line: 200 m at 6 % to the
   * line, then 300 m more at 6 % into the next lap, 500 m flat, 500 m down at
   * −6 % and 500 m flat. `slopesOf` joins the two halves into one climb.
   */
  const ACROSS = [
    112,
    ...rise(112, 300, 6),
    ...rise(130, 500, 0),
    ...rise(130, 500, -6),
    ...rise(100, 500, 0),
    ...rise(100, 200, 6),
  ];

  it('on a loop, names a climb across the line as one, with its top in the next lap', () => {
    const loop = loopRoute(ACROSS);
    const total = loop.totalDistance as number;
    const joined = slopesOf(loop).filter((slope) => slope.kind === 'climb');
    expect(joined).toHaveLength(1);
    // 100 m before the line: about 100 m to it and 300 m past it to the top.
    const before = lookAhead(loop, total - 100).climb;
    expect(before?.where).toBe('on');
    expect(before?.topIn).toBeGreaterThan(350);
    expect(before?.topIn).toBeLessThan(450);
    // 100 m past it, on lap two: the same climb, 200 m from its top.
    const after = lookAhead(loop, total + 100).climb;
    expect(after?.where).toBe('on');
    expect(after?.slope).toBe(before?.slope);
    expect((before?.topIn ?? Number.NaN) - (after?.topIn ?? Number.NaN)).toBeCloseTo(200, 6);
  });
});

/** #2291's third part: the whole route's strip, shaded by the same bands. */
describe('the whole route in grade bands (#2291)', () => {
  const profile = route(CLIMB);

  it('covers the route from 0 to 1, each run beginning where the last ends', () => {
    const runs = routeBands(profile);
    expect(runs[0]?.from).toBe(0);
    expect(runs.at(-1)?.to).toBe(1);
    runs.slice(1).forEach((run, index) => {
      expect(run.from).toBe(runs[index]?.to);
      expect(run.band).not.toBe(runs[index]?.band);
    });
  });

  it('bands the flat as flat and the 6 % climb as steep, where it is on the route', () => {
    const runs = routeBands(profile);
    expect(runs.map((run) => run.band)).toContain('steep');
    expect(runs[0]?.band).toBe('flat');
    expect(runs.at(-1)?.band).toBe('flat');
    // The climb is 1.0 to 1.6 km of 3 km: a third to a little over a half.
    const steep = runs.find((run) => run.band === 'steep');
    expect(steep?.from).toBeGreaterThan(0.3);
    expect(steep?.from).toBeLessThan(0.37);
    expect(steep?.to).toBeGreaterThan(0.5);
    expect(steep?.to).toBeLessThan(0.56);
  });

  it('bands by the grade the trainer would be sent, as the road ahead does', () => {
    const total = profile.totalDistance as number;
    const ahead = lookAhead(profile, 0);
    const steepAhead = ahead.runs.find((run) => run.band === 'steep');
    const steepRoute = routeBands(profile).find((run) => run.band === 'steep');
    expect((steepRoute?.from ?? Number.NaN) * total).toBeCloseTo(steepAhead?.start ?? -1, -1);
  });

  it('is worked out once per route', () => {
    expect(routeBands(profile)).toBe(routeBands(profile));
  });

  it('is nothing on a route with one cell or none', () => {
    expect(routeBands(route([100, 100])).length).toBeLessThanOrEqual(1);
  });
});

/**
 * #2291, the owner's screenshots of 2026-11-06: the caption's average read
 * low (a 10 % climb "9 %", a 4.5 % one "4 %"), and a thin extra band showed
 * at the change of slope before the top marker. Synthetic climbs at 4.5, 7
 * and 10 %, through the real `routeProfile`.
 */
describe('a steady climb, as the owner’s screenshots asked — #2291', () => {
  /** 1 km flat, 600 m at `grade` %, 1.4 km flat. */
  const climbAt = (grade: number): RouteProfile =>
    route([
      100,
      ...rise(100, 1000, 0),
      ...rise(100, 600, grade),
      ...rise(100 + 6 * grade, 1400, 0),
    ]);
  const CASES = [
    [4.5, '5 %', 'climb'],
    [7, '7 %', 'steep'],
    [10, '10 %', 'wall'],
  ] as const;

  it.each(CASES)('says a %s per cent climb is "%s", before it and on it', (grade, said) => {
    const profile = climbAt(grade);
    const before = nextClimbText(lookAhead(profile, 900).climb, 'metric');
    expect(before?.startsWith('Climb in ')).toBe(true);
    expect(before?.endsWith(` · ${said}`)).toBe(true);
    const on = lookAhead(profile, 1300).climb;
    expect(nextClimbText(on, 'metric')?.endsWith(` · ${said}`)).toBe(true);
    expect(nextClimbLabel(on, 'metric')).toContain(`, ${said.replace(' %', '')} per cent average`);
  });

  it.each(CASES)(
    'draws a %s per cent climb as one band, with no sliver at its foot or its crest',
    (grade, _said, band) => {
      const profile = climbAt(grade);
      expect(lookAhead(profile, 900).runs.map((run) => run.band)).toEqual(['flat', band, 'flat']);
      for (const at of [1300, 1560]) {
        const ahead = lookAhead(profile, at);
        expect(ahead.runs.map((run) => run.band)).toEqual([band, 'flat']);
        // The band ends at the top marker, to within a sample.
        expect(
          Math.abs((ahead.runs[0]?.end ?? 0) - (ahead.climb?.topIn ?? -99)),
        ).toBeLessThanOrEqual(10);
      }
      const total = profile.totalDistance as number;
      const route = routeBands(profile);
      expect(route.map((run) => run.band)).toEqual(['flat', band, 'flat']);
      const slope = slopesOf(profile)[0];
      const top = (slope?.start ?? 0) + (slope?.length ?? 0);
      expect(Math.abs((route[1]?.to ?? 0) * total - top)).toBeLessThanOrEqual(10);
    },
  );

  it('still draws a real change of band: 300 m at 6 % then 300 m at 10 %', () => {
    const profile = route([
      100,
      ...rise(100, 1000, 0),
      ...rise(100, 300, 6),
      ...rise(118, 300, 10),
      ...rise(148, 1400, 0),
    ]);
    expect(lookAhead(profile, 900).runs.map((run) => run.band)).toEqual([
      'flat',
      'steep',
      'wall',
      'flat',
    ]);
    expect(routeBands(profile).map((run) => run.band)).toEqual(['flat', 'steep', 'wall', 'flat']);
  });
});

describe('a band too short to be road — #2291', () => {
  const span = (band: (typeof GRADE_BANDS)[number]['key'], from: number, to: number) => ({
    band,
    from,
    to,
  });

  it('merges a sliver into the neighbour further from flat, the shortest first', () => {
    expect(
      withoutSlivers(
        [
          span('flat', 0, 100),
          span('climb', 100, 130),
          span('steep', 130, 150),
          span('wall', 150, 600),
          span('steep', 600, 620),
          span('climb', 620, 640),
          span('flat', 640, 1000),
        ],
        MINIMUM_BAND_METRES,
      ),
    ).toEqual([span('flat', 0, 100), span('wall', 100, 640), span('flat', 640, 1000)]);
  });

  it('merges into the longer neighbour when both are as far from flat', () => {
    expect(
      withoutSlivers(
        [span('descent', 0, 100), span('flat', 100, 120), span('climb', 120, 400)],
        MINIMUM_BAND_METRES,
      ),
    ).toEqual([span('descent', 0, 100), span('climb', 100, 400)]);
  });

  it('keeps a band at least the minimum long, and the first and last whatever their length', () => {
    const kept = [
      span('climb', 0, 20),
      span('flat', 20, 20 + MINIMUM_BAND_METRES),
      span('wall', 20 + MINIMUM_BAND_METRES, 900),
      span('steep', 900, 910),
    ];
    expect(withoutSlivers(kept, MINIMUM_BAND_METRES)).toEqual(kept);
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
      climb: undefined,
    });
  });
});
