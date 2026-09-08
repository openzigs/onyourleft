// SPDX-License-Identifier: Apache-2.0

/**
 * #89's route profile: the three windows, the loop, and every refusal.
 *
 * The two assertions that matter most are a pair, and they pull in opposite
 * directions on purpose — a single-point elevation spike must NOT reach the
 * gradient, and a real sustained 12 % wall must. A profile that passes one by
 * failing the other is exactly the failure #89 describes.
 */

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  altitudeMetres,
} from '../quantities';
import type { GeographicPosition } from '../quantities';

import { RouteError } from './errors';
import {
  DESPIKE_WINDOW_METRES,
  GRADIENT_WINDOW_METRES,
  LOOP_CLOSURE_METRES,
  PROFILE_RESOLUTION_METRES,
  distanceOnRoute,
  elevationAt,
  gradeAt,
  positionAt,
  routeProfile,
  type RoutePoint,
} from './profile';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function eastOf(from: GeographicPosition, eastMetres: number): GeographicPosition {
  const perDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(from.latitude),
    degreesLongitude(from.longitude + eastMetres / perDegreeLongitude),
  );
}

/** A straight eastward route, one point every `spacing` metres, `elevation(x)` high. */
function straightRoute(
  lengthMetres: number,
  spacing: number,
  elevation: (distance: number) => number | undefined,
): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let distance = 0; distance <= lengthMetres; distance += spacing) {
    const height = elevation(distance);
    points.push({
      position: eastOf(ORIGIN, distance),
      elevation: height === undefined ? undefined : altitudeMetres(height),
    });
  }
  return points;
}

/** A closed square, so a loop has ends in the same place and a real shape. */
function squareLoop(sideMetres: number, spacing: number): RoutePoint[] {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN.latitude * Math.PI) / 180);
  const corner = (north: number, east: number): GeographicPosition =>
    geographicPosition(
      degreesLatitude(ORIGIN.latitude + north / METRES_PER_DEGREE_LATITUDE),
      degreesLongitude(ORIGIN.longitude + east / perDegreeLongitude),
    );
  const legs: [number, number][][] = [];
  const along = (from: [number, number], to: [number, number]): [number, number][] => {
    const steps = Math.round(sideMetres / spacing);
    return Array.from({ length: steps }, (_, step) => [
      from[0] + ((to[0] - from[0]) * step) / steps,
      from[1] + ((to[1] - from[1]) * step) / steps,
    ]);
  };
  legs.push(along([0, 0], [0, sideMetres]));
  legs.push(along([0, sideMetres], [sideMetres, sideMetres]));
  legs.push(along([sideMetres, sideMetres], [sideMetres, 0]));
  legs.push(along([sideMetres, 0], [0, 0]));
  const corners = legs.flat();
  corners.push([0, 0]);
  return corners.map(([north, east], index) => ({
    position: corner(north, east),
    // A gentle hill over the first half and back down over the second, so the
    // loop's start and end elevations agree as well as its positions.
    elevation: altitudeMetres(20 + 15 * Math.sin((index / corners.length) * 2 * Math.PI)),
  }));
}

describe('the grid', () => {
  it('lands its last sample exactly on the route’s end, so a loop’s wrap is exact', () => {
    // 1 235 m is not a whole number of 10 m steps, which is the case the
    // stretched grid exists for.
    const profile = routeProfile(straightRoute(1235, 5, () => 10));
    expect(profile.totalDistance).toBeCloseTo(1235, 0);
    // The spacing is stretched, never left short: the last index times the
    // spacing IS the total. A grid that stopped at the last whole 10 m would
    // lose up to 10 m on every lap of a loop.
    expect((profile.elevations.length - 1) * profile.resolution).toBeCloseTo(
      profile.totalDistance,
      6,
    );
    expect(profile.resolution).toBeGreaterThan(PROFILE_RESOLUTION_METRES - 0.5);
    expect(profile.resolution).toBeLessThan(PROFILE_RESOLUTION_METRES + 0.5);
  });

  it('interpolates a point that carries no elevation rather than dropping it', () => {
    // Every third point has no <ele>. Dropping them would shorten the route;
    // interpolating keeps both the distance and the ramp.
    const gappy = routeProfile(
      straightRoute(600, 10, (distance) => (distance % 30 === 10 ? undefined : distance * 0.05)),
    );
    const complete = routeProfile(straightRoute(600, 10, (distance) => distance * 0.05));
    expect(gappy.totalDistance).toBeCloseTo(complete.totalDistance, 3);
    expect(gappy.totalAscent).toBeCloseTo(complete.totalAscent, 1);
  });
});

describe('the gradient', () => {
  it('reads a constant 5 % ramp as 5 %', () => {
    const profile = routeProfile(straightRoute(1000, 10, (distance) => distance * 0.05));
    expect(gradeAt(profile, 500)).toBeCloseTo(5, 3);
  });

  it('still reads a real 12 % wall as 12 % — the over-smoothing failure', () => {
    // 300 m of 12 % between two flat stretches. #89: "too much [smoothing] and a
    // real 12 % wall arrives as a gentle 6 %". The window is 100 m, so the
    // middle of a 300 m feature is measured entirely inside the wall.
    const profile = routeProfile(
      straightRoute(900, 10, (distance) =>
        distance < 300 ? 0 : distance < 600 ? (distance - 300) * 0.12 : 36,
      ),
    );
    expect(gradeAt(profile, 450)).toBeCloseTo(12, 2);
  });

  it('does not turn a single-point elevation spike into a gradient spike', () => {
    // #89's third criterion. The spike is 20 m on a flat road: a raw difference
    // over one 10 m sample is a 200 % gradient, which is what would reach the
    // trainer.
    const flat = straightRoute(1000, 10, () => 40);
    const spiked = flat.map((point, index) =>
      index === 50 ? { ...point, elevation: altitudeMetres(60) } : point,
    );
    const profile = routeProfile(spiked);
    const worst = Math.max(...profile.grades.map((grade) => Math.abs(grade)));
    // The median removes it outright, so the road stays flat to within
    // floating-point noise rather than merely "less steep".
    expect(worst).toBeLessThan(0.01);
    // And the spike is gone from the elevation the renderer draws, too.
    expect(Math.max(...profile.elevations)).toBeCloseTo(40, 6);
  });

  it('eases into a ramp at the route’s start rather than commanding it at zero', () => {
    // The window is replicated at the ends, which biases the slope towards zero
    // over the first half-window. That is the safe direction for a device that
    // applies resistance to a person who is pedalling.
    const profile = routeProfile(straightRoute(600, 10, (distance) => distance * 0.1));
    expect(gradeAt(profile, 0)).toBeLessThan(gradeAt(profile, GRADIENT_WINDOW_METRES));
    expect(gradeAt(profile, 0)).toBeGreaterThan(0);
    expect(gradeAt(profile, 300)).toBeCloseTo(10, 3);
  });

  it('is signed: a descent is negative', () => {
    const profile = routeProfile(straightRoute(600, 10, (distance) => 100 - distance * 0.04));
    expect(gradeAt(profile, 300)).toBeCloseTo(-4, 3);
  });
});

describe('ascent and descent', () => {
  it('do not count elevation noise as climbing', () => {
    // A dead-flat road with ±1 m of ALTERNATING elevation noise, which is the
    // case the median filter cannot help with — there is no isolated spike in
    // it. A step-wise sum of positive deltas reports about 50 m of climbing per
    // flat kilometre, which is the number this threshold exists to refuse.
    const noisy = routeProfile(straightRoute(1000, 10, (distance) => 40 + ((distance / 10) % 2)));
    expect(noisy.totalAscent).toBe(0);
    expect(noisy.totalDescent).toBe(0);
  });

  it('count a real climb at its full height, not at its height above the threshold', () => {
    const climb = routeProfile(straightRoute(1000, 10, (distance) => distance * 0.05));
    expect(climb.totalAscent).toBeCloseTo(50, 6);
    expect(climb.totalDescent).toBe(0);
  });

  it('close the run the route ended in, rather than dropping the final climb', () => {
    // Up 30 m, down 20 m, and then up 40 m to the finish line. The last run is
    // never followed by a reversal, so nothing but the flush at the end counts it.
    const rolling = routeProfile(
      straightRoute(900, 10, (distance) =>
        distance <= 300
          ? distance * 0.1
          : distance <= 600
            ? 30 - (distance - 300) * (20 / 300)
            : 10 + (distance - 600) * (40 / 300),
      ),
    );
    // Not exactly 70 and 20, and the shortfall is the despike stage doing its
    // job: a median clips a sharp vertex by about one sample's rise, so the
    // 30 m summit reads 29.3 and the 10 m col reads 10.7. Both runs lose two
    // thirds of a metre at each end, which is the cost of the filter that keeps
    // a bad reading off the trainer.
    expect(rolling.totalAscent).toBeGreaterThan(68);
    expect(rolling.totalAscent).toBeLessThanOrEqual(70);
    expect(rolling.totalDescent).toBeGreaterThan(18);
    expect(rolling.totalDescent).toBeLessThanOrEqual(20);
  });
});

describe('a loop', () => {
  it('wraps past the end with distance still accumulating', () => {
    const profile = routeProfile(squareLoop(500, 25), { loop: true });
    const lap = profile.totalDistance;
    // #89 criterion 5. The rider's odometer keeps counting; the position ON the
    // route wraps. A second lap is not a reset and not a stop.
    expect(distanceOnRoute(profile, lap + 120)).toBeCloseTo(120, 6);
    expect(distanceOnRoute(profile, 2 * lap + 120)).toBeCloseTo(120, 6);
    expect(elevationAt(profile, lap + 120)).toBeCloseTo(elevationAt(profile, 120), 6);
    expect(positionAt(profile, lap + 120).latitude).toBeCloseTo(
      positionAt(profile, 120).latitude,
      9,
    );
  });

  it('wraps backwards too, so a pacer behind the rider is on the far side', () => {
    const profile = routeProfile(squareLoop(500, 25), { loop: true });
    expect(distanceOnRoute(profile, -50)).toBeCloseTo(profile.totalDistance - 50, 6);
  });

  it('refuses the claim when the two ends are not the same place', () => {
    let raised: unknown;
    try {
      routeProfile(
        straightRoute(1000, 10, () => 10),
        { loop: true },
      );
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RouteError);
    expect((raised as RouteError).code).toBe('not-a-loop');
    // The message names the gap and the constraint — and ADR 0004 decision D:
    // never where either end is.
    expect((raised as RouteError).message).toContain(`${LOOP_CLOSURE_METRES} m`);
    expect((raised as RouteError).message).not.toContain('51.5');
    expect((raised as RouteError).message).not.toContain('-0.12');
  });
});

describe('a route that is not a loop', () => {
  it('clamps rather than wrapping, at both ends', () => {
    const profile = routeProfile(straightRoute(1000, 10, (distance) => distance * 0.03));
    expect(distanceOnRoute(profile, profile.totalDistance + 500)).toBeCloseTo(
      profile.totalDistance,
      6,
    );
    expect(distanceOnRoute(profile, -500)).toBe(0);
    expect(elevationAt(profile, profile.totalDistance + 500)).toBeCloseTo(
      elevationAt(profile, profile.totalDistance),
      6,
    );
  });

  it('answers a non-finite distance at the start rather than with NaN', () => {
    const profile = routeProfile(straightRoute(200, 10, () => 5));
    expect(distanceOnRoute(profile, Number.NaN)).toBe(0);
    expect(elevationAt(profile, Number.NaN)).toBeCloseTo(5, 6);
  });
});

describe('what it refuses, and what it says', () => {
  it('a route with fewer than two points', () => {
    expect(() => routeProfile([])).toThrow(RouteError);
    expect(() => routeProfile([{ position: ORIGIN, elevation: altitudeMetres(1) }])).toThrow(
      /at least two points/,
    );
  });

  it('a route whose every point is in the same place', () => {
    const stationary: RoutePoint[] = Array.from({ length: 5 }, () => ({
      position: ORIGIN,
      elevation: altitudeMetres(10),
    }));
    expect(() => routeProfile(stationary)).toThrow(/no length/);
  });

  it('a route with no elevation anywhere', () => {
    expect(() => routeProfile(straightRoute(500, 10, () => undefined))).toThrow(
      /no point in this route carries an elevation/,
    );
  });

  it('an option that is not a positive, finite number of metres', () => {
    const points = straightRoute(500, 10, () => 10);
    expect(() => routeProfile(points, { resolutionMetres: 0 })).toThrow(/resolutionMetres/);
    expect(() => routeProfile(points, { despikeWindowMetres: -1 })).toThrow(/despikeWindowMetres/);
    expect(() => routeProfile(points, { gradientWindowMetres: Number.POSITIVE_INFINITY })).toThrow(
      /gradientWindowMetres/,
    );
  });
});

describe('where the despike stage stops working, stated rather than assumed', () => {
  it('removes ONE bad sample and not two adjacent ones', () => {
    // The boundary of a three-sample median, asserted so nobody has to rediscover
    // it: the default window survives a lone bad reading and does not survive a
    // pair. Widening DESPIKE_WINDOW_METRES is the lever if a source ever needs
    // it — at the cost of removing real two-sample features with them.
    const flat = straightRoute(1000, 10, () => 40);
    const spikedTwice = flat.map((point, index) =>
      index === 50 || index === 51 ? { ...point, elevation: altitudeMetres(60) } : point,
    );
    expect(Math.max(...routeProfile(spikedTwice).grades.map(Math.abs))).toBeGreaterThan(1);
    // Five samples covers the pair, and then it is gone again.
    const wider = routeProfile(spikedTwice, { despikeWindowMetres: 5 * PROFILE_RESOLUTION_METRES });
    expect(Math.max(...wider.grades.map(Math.abs))).toBeLessThan(0.01);
    expect(DESPIKE_WINDOW_METRES).toBeGreaterThan(2 * PROFILE_RESOLUTION_METRES);
  });
});
