// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The plan-view projection — #285.
 *
 * Every assertion here is about a number a rider reads as a *shape*: which way
 * is up, whether a circuit stays a circuit, where a break is, and — the one the
 * issue names as the trap — where the mark goes on lap two.
 */

import { describe, expect, it } from 'vitest';

import {
  PLAN_BREAK_FACTOR,
  PLAN_MAX_POINTS,
  PLAN_PADDING,
  PLAN_SIZE,
  describePlan,
  planLap,
  planPath,
  planPoint,
  planProgress,
  riderMark,
  routePlan,
} from './plan';
import { profileReading } from './fields';
import { atStartLine } from '../simulation';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
  metresPerSecond,
  routeProfile,
  type GeographicPosition,
  type RouteProfile,
  type RoutePoint,
} from '@onyourleft/domain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** A straight kilometre due north, which is the simplest thing with a shape. */
function northwards(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.2),
    });
  }
  return routeProfile(points);
}

/**
 * A rectangular circuit, twice as wide as it is tall, closed to within a metre.
 *
 * Twice as wide on purpose: a projection that scaled each axis independently
 * would draw this as a square, and a square is exactly what a rider would not
 * recognise. The closure is what lets `routeProfile` accept `loop: true` at all
 * — its ends must be inside `LOOP_CLOSURE_METRES`.
 */
function circuit(): RouteProfile {
  const halfHeight = 100 / METRES_PER_DEGREE_LATITUDE;
  const east = 400 / (METRES_PER_DEGREE_LATITUDE * Math.cos((51.5 * Math.PI) / 180));
  const corners: readonly (readonly [number, number])[] = [
    [51.5 - halfHeight, -0.12],
    [51.5 - halfHeight, -0.12 + east],
    [51.5 + halfHeight, -0.12 + east],
    [51.5 + halfHeight, -0.12],
    [51.5 - halfHeight, -0.12],
  ];
  const points: RoutePoint[] = [];
  for (let corner = 0; corner < corners.length - 1; corner += 1) {
    const [fromLatitude, fromLongitude] = corners[corner] as readonly [number, number];
    const [toLatitude, toLongitude] = corners[corner + 1] as readonly [number, number];
    for (let step = 0; step < 40; step += 1) {
      const fraction = step / 40;
      points.push({
        position: geographicPosition(
          degreesLatitude(fromLatitude + (toLatitude - fromLatitude) * fraction),
          degreesLongitude(fromLongitude + (toLongitude - fromLongitude) * fraction),
        ),
        elevation: altitudeMetres(10),
      });
    }
  }
  const [lastLatitude, lastLongitude] = corners[corners.length - 1] as readonly [number, number];
  points.push({
    position: geographicPosition(degreesLatitude(lastLatitude), degreesLongitude(lastLongitude)),
    elevation: altitudeMetres(10),
  });
  return routeProfile(points, { loop: true });
}

/**
 * A profile with a teleport in the middle of it.
 *
 * ⚠️ **Built as an object literal rather than through `routeProfile`, and that
 * is the point.** `routeProfile` resamples onto a fixed grid and cannot produce
 * a jump; `packages/store` §`fromPersistedRoute` assembles exactly this shape
 * out of four parallel arrays and checks their lengths and nothing about their
 * geometry. A row a different build wrote is the path that reaches the screen,
 * so it is the shape the test uses.
 */
function withATeleport(): RouteProfile {
  const positions: GeographicPosition[] = [];
  for (let index = 0; index < 20; index += 1) {
    // 10 m apart, then 2 km east of where the first half ended.
    const offset = index < 10 ? index * 10 : 2_000 + (index - 10) * 10;
    positions.push(
      geographicPosition(
        degreesLatitude(51.5 + offset / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
    );
  }
  return {
    loop: false,
    resolution: metres(10),
    totalDistance: metres(190),
    totalAscent: metres(0),
    totalDescent: metres(0),
    elevations: positions.map(() => altitudeMetres(10)),
    grades: positions.map(() => gradePercent(0)),
    positions,
  };
}

describe('north is up', () => {
  it('puts a point further north higher up the drawing', () => {
    const plan = routePlan(northwards());
    const [run] = plan.runs;
    const first = run?.points[0];
    const last = run?.points[(run.points.length ?? 1) - 1];

    expect(first).toBeDefined();
    expect(last).toBeDefined();
    // The route runs due north, so the LAST point is the northernmost and must
    // be nearer the top — a smaller y. A projection that forgot to flip the
    // latitude axis draws every ride log upside down.
    expect((last as { y: number }).y).toBeLessThan((first as { y: number }).y);
  });

  it('says so in words, because a rider cannot see which way is up', () => {
    const profile = northwards();

    expect(describePlan(profile, 0)).toContain('north up');
  });
});

describe('the shape is fitted uniformly, so a circuit stays a circuit', () => {
  it('keeps a route twice as wide as it is tall twice as wide on the panel', () => {
    const plan = routePlan(circuit());
    const points = plan.runs.flatMap((run) => run.points);
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));

    // Not 1:1. A per-axis fit would stretch the shorter side to fill the box.
    expect(width / height).toBeCloseTo(2, 1);
  });

  it('fits the whole route inside the padded viewBox', () => {
    const plan = routePlan(circuit());

    for (const run of plan.runs) {
      for (const point of run.points) {
        expect(point.x).toBeGreaterThanOrEqual(PLAN_PADDING - 0.001);
        expect(point.x).toBeLessThanOrEqual(PLAN_SIZE - PLAN_PADDING + 0.001);
        expect(point.y).toBeGreaterThanOrEqual(PLAN_PADDING - 0.001);
        expect(point.y).toBeLessThanOrEqual(PLAN_SIZE - PLAN_PADDING + 0.001);
      }
    }
  });

  it('draws a route with no extent at all as a dot in the middle', () => {
    // Only a hand-edited row produces this; `routeProfile` refuses it outright
    // with `no-distance`. Scale zero is honest and dividing by zero is not.
    const positions = [
      geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)),
      geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)),
    ];
    const profile: RouteProfile = {
      ...withATeleport(),
      positions,
      elevations: [altitudeMetres(1), altitudeMetres(1)],
      grades: [gradePercent(0), gradePercent(0)],
    };

    const plan = routePlan(profile);

    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]?.points[0]).toEqual({ x: PLAN_SIZE / 2, y: PLAN_SIZE / 2 });
  });
});

describe('a gap is a gap, not a line across it', () => {
  it('draws an ordinary route as one unbroken run', () => {
    const plan = routePlan(northwards());

    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]?.points.length).toBe(northwards().positions.length);
  });

  it('splits at a jump the profile’s own grid could not have produced', () => {
    const plan = routePlan(withATeleport());

    expect(plan.runs).toHaveLength(2);
    expect(plan.runs[0]).toEqual(expect.objectContaining({ from: 0 }));
    expect(plan.runs[0]?.points).toHaveLength(10);
    expect(plan.runs[1]).toEqual(expect.objectContaining({ from: 10 }));
    expect(plan.runs[1]?.points).toHaveLength(10);
  });

  it('never emits a path command joining the two sides of a break', () => {
    // The assertion that a single `<path>` would fail. One `d` per run means
    // the jump appears in no `L` command anywhere, which is the property — a
    // count of runs alone would pass against a second path that redrew the
    // whole route.
    const plan = routePlan(withATeleport());
    const commands = plan.runs.map((run) => planPath(run));

    expect(commands).toHaveLength(2);
    for (const command of commands) {
      expect(command.startsWith('M')).toBe(true);
      expect(command.split('M')).toHaveLength(2);
    }
  });

  it('leaves a separation just under the threshold alone', () => {
    // The threshold has to be a threshold. A route bent tightly enough that two
    // grid samples are a little further apart than the grid spacing is still one
    // road, and splitting it would put a hole in a picture of a hairpin.
    const resolution = 10;
    const step = (PLAN_BREAK_FACTOR - 0.5) * resolution;
    const positions = [0, 1, 2].map((index) =>
      geographicPosition(
        degreesLatitude(51.5 + (index * step) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
    );
    const profile: RouteProfile = {
      ...withATeleport(),
      resolution: metres(resolution),
      positions,
      elevations: positions.map(() => altitudeMetres(1)),
      grades: positions.map(() => gradePercent(0)),
    };

    expect(routePlan(profile).runs).toHaveLength(1);
  });

  it('says how many parts it drew, for a rider who cannot see them', () => {
    expect(describePlan(withATeleport(), 0)).toContain('drawn in 2 parts');
  });

  it('says nothing about parts when there is only one', () => {
    expect(describePlan(northwards(), 0)).not.toContain('parts');
  });
});

describe('the rider’s mark on a loop, on lap two', () => {
  it('is in the same place a quarter of the way round on every lap', () => {
    const profile = circuit();
    const plan = routePlan(profile);
    const total = profile.totalDistance as number;

    const lapOne = riderMark(plan, profile, total * 0.25);
    const lapThree = riderMark(plan, profile, total * 2.25);

    expect(lapThree.x).toBeCloseTo(lapOne.x, 6);
    expect(lapThree.y).toBeCloseTo(lapOne.y, 6);
  });

  it('is not pinned to the finish line once the rider passes it', () => {
    // The failure this catches: a CLAMPED fraction, which is 1 for every
    // distance past the end, so a mark placed from it sits on the start/finish
    // corner for the rest of the ride.
    //
    // ⚠️ **This assertion used to read `profilePosition` and require it to
    // DISAGREE with `planProgress` — #287 removed the disagreement rather than
    // the assertion.** The elevation strip was the clamped one, and #285 built
    // this wrapped fraction precisely because it could not read that one; the
    // strip now reads this one too, so what is pinned here is that the shared
    // function still wraps. `fields.test.ts` is the other end of the same wire.
    const profile = circuit();
    const plan = routePlan(profile);
    const total = profile.totalDistance as number;
    const state = atStartLine(profile);
    const ridden = {
      ...state,
      ride: { speed: metresPerSecond(8), distance: metres(total * 1.5) },
    };

    expect(planProgress(profile, total * 1.5)).toBeCloseTo(0.5, 6);
    // And the strip agrees with it, which is the whole of #287: one value.
    expect(profileReading(ridden, profile).position).toBeCloseTo(0.5, 6);

    const halfway = riderMark(plan, profile, total * 0.5);
    const lapTwo = riderMark(plan, profile, total * 1.5);
    const finish = riderMark(plan, profile, total);

    expect(lapTwo.x).toBeCloseTo(halfway.x, 6);
    expect(lapTwo.y).toBeCloseTo(halfway.y, 6);
    expect(Math.hypot(lapTwo.x - finish.x, lapTwo.y - finish.y)).toBeGreaterThan(1);
  });

  it('counts the lap a rider is on, and says it', () => {
    const profile = circuit();
    const total = profile.totalDistance as number;

    expect(planLap(profile, 0)).toBe(1);
    expect(planLap(profile, total * 0.99)).toBe(1);
    expect(planLap(profile, total * 1.01)).toBe(2);
    expect(describePlan(profile, total * 1.5)).toContain('on lap 2');
    expect(describePlan(profile, total * 1.5)).toContain('50 per cent of the way round');
  });
});

describe('the rider’s mark on a route that is not a loop', () => {
  it('stops at the end rather than running off the panel', () => {
    const profile = northwards();
    const plan = routePlan(profile);
    const total = profile.totalDistance as number;

    const atEnd = riderMark(plan, profile, total);
    const past = riderMark(plan, profile, total * 3);

    expect(past).toEqual(atEnd);
  });

  it('offers no lap number, because there is no second lap to be on', () => {
    const profile = northwards();

    expect(planLap(profile, profile.totalDistance * 2)).toBeUndefined();
    expect(describePlan(profile, 0)).not.toContain('lap');
    expect(describePlan(profile, 0)).toContain('of the way along the route');
  });
});

describe('the mark and the road are placed by one transform', () => {
  it('puts the rider at the start line exactly on the route’s first point', () => {
    // The defect this catches is a second projection: a mark computed from its
    // own bounds is off its own road by however much the two disagree, and the
    // disagreement is invisible on a route whose bounds happen to match.
    const profile = circuit();
    const plan = routePlan(profile);
    const first = plan.runs[0]?.points[0];

    const mark = riderMark(plan, profile, 0);

    expect(mark.x).toBeCloseTo((first as { x: number }).x, 6);
    expect(mark.y).toBeCloseTo((first as { y: number }).y, 6);
  });

  it('places a position through the same projection the runs were built with', () => {
    const profile = northwards();
    const plan = routePlan(profile);
    const last = profile.positions[profile.positions.length - 1] as GeographicPosition;

    const point = planPoint(plan.projection, last);
    const drawn = plan.runs[0]?.points[plan.runs[0].points.length - 1];

    expect(point).toEqual(drawn);
  });
});

describe('the description a reader who is not looking at it gets', () => {
  it('states where the rider is as a percentage', () => {
    const profile = northwards();

    expect(describePlan(profile, profile.totalDistance * 0.42)).toContain('42 per cent');
  });

  it('says plainly when there is nothing to draw', () => {
    const profile: RouteProfile = {
      ...withATeleport(),
      positions: [],
      elevations: [],
      grades: [],
    };

    expect(describePlan(profile, 0)).toBe('Route in plan: this route has no points to draw.');
    expect(routePlan(profile).runs).toHaveLength(0);
  });
});

describe('what bounds the points that reach the DOM', () => {
  /** A 47 km import on the profile's own 10 m grid — 4 701 samples. */
  function longImport(): RouteProfile {
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 4_700; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (index * 10) / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(-0.12 + Math.sin(index / 300) * 0.02),
        ),
        elevation: altitudeMetres(50 + Math.sin(index / 120) * 30),
      });
    }
    return routeProfile(points);
  }

  it('keeps a long route inside the declared bound', () => {
    const profile = longImport();
    expect(profile.positions.length).toBeGreaterThan(4_000);

    const drawn = routePlan(profile).runs.reduce((total, run) => total + run.points.length, 0);

    // ⚠️ Plus one per run for the kept tail — `routePlan` §`closeRun`. The
    // bound is a budget on the path a browser diffs every frame, not an exact
    // count, and the tail is what stops a long route being drawn short.
    expect(drawn).toBeLessThanOrEqual(PLAN_MAX_POINTS + routePlan(profile).runs.length);
  });

  it('still draws the route’s own last point, rather than stopping short of it', () => {
    const profile = longImport();
    const plan = routePlan(profile);
    const run = plan.runs[plan.runs.length - 1];
    const drawnEnd = run?.points[(run.points.length ?? 1) - 1];
    const trueEnd = planPoint(
      plan.projection,
      profile.positions[profile.positions.length - 1] as GeographicPosition,
    );

    expect(drawnEnd).toEqual(trueEnd);
  });

  it('still starts at the route’s own first point', () => {
    const profile = longImport();
    const plan = routePlan(profile);
    const trueStart = planPoint(plan.projection, profile.positions[0] as GeographicPosition);

    expect(plan.runs[0]?.points[0]).toEqual(trueStart);
  });

  it('keeps a break a break even after the thinning', () => {
    // The order the thinning and the splitting happen in is the whole of this:
    // a stride applied first can step straight over a jump, and the hole in the
    // picture disappears on exactly the long routes the bound exists for.
    // ⚠️ **999, which is deliberately not a multiple of the stride.** At 2 000
    // samples the stride is 5, so a run starting at a multiple of it would be
    // kept by the thinning whether or not the code keeps run starts on purpose
    // — and the assertion below would pass over a version that does not.
    const split = 999;
    const positions: GeographicPosition[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      const offset = index < split ? index * 10 : 5_000 + (index - split) * 10;
      positions.push(
        geographicPosition(
          degreesLatitude(51.5 + offset / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(-0.12),
        ),
      );
    }
    const profile: RouteProfile = {
      ...withATeleport(),
      positions,
      elevations: positions.map(() => altitudeMetres(10)),
      grades: positions.map(() => gradePercent(0)),
    };

    const plan = routePlan(profile);

    expect(plan.runs).toHaveLength(2);
    expect(plan.runs[1]?.from).toBe(split);
    // The far side of the jump is drawn from the first sample after it, not
    // from the next one the stride happens to land on — otherwise the hole is
    // up to a stride wider than the jump actually was.
    expect(plan.runs[1]?.points[0]).toEqual(
      planPoint(plan.projection, positions[split] as GeographicPosition),
    );
    // And the near side ends on the last sample before it, for the same reason.
    const near = plan.runs[0];
    expect(near?.points[(near.points.length ?? 1) - 1]).toEqual(
      planPoint(plan.projection, positions[split - 1] as GeographicPosition),
    );
  });
});
