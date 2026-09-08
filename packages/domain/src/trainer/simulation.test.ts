// SPDX-License-Identifier: Apache-2.0

/**
 * #90's setpoint driver: the +6 % section, the 1 Hz limit, and the deadband.
 *
 * The headline assertion is #90's third acceptance criterion in one line — *at
 * a +6 % section of a route profile, the grade written is within tolerance of
 * the profile at the rider's current position* — and it is checked against
 * `gradeAt` rather than against the literal 6, because the profile is what the
 * trainer is being asked to reproduce and the 100 m slope window is entitled to
 * disagree with the source data near a transition. The literal is asserted too,
 * in the middle of the section, where the window is entirely inside the ramp.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
  type GeographicPosition,
} from '../quantities';
import { gradeAt, routeProfile, type RoutePoint } from '../route/profile';

import {
  createSimulationDriver,
  MAX_SIMULATED_GRADE_PERCENT,
  SIMULATION_GRADE_DEADBAND_PERCENT,
  SIMULATION_SETPOINT_INTERVAL_SECONDS,
} from './simulation';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function eastOf(from: GeographicPosition, eastMetres: number): GeographicPosition {
  const perDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(from.latitude),
    degreesLongitude(from.longitude + eastMetres / perDegreeLongitude),
  );
}

function straightRoute(
  lengthMetres: number,
  spacing: number,
  elevation: (distance: number) => number,
): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let distance = 0; distance <= lengthMetres; distance += spacing) {
    points.push({
      position: eastOf(ORIGIN, distance),
      elevation: altitudeMetres(elevation(distance)),
    });
  }
  return points;
}

/** A closed square, so a loop's ends are in the same place with the same height. */
function squareLoop(sideMetres: number, spacing: number): RoutePoint[] {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN.latitude * Math.PI) / 180);
  const corner = (north: number, east: number): GeographicPosition =>
    geographicPosition(
      degreesLatitude(ORIGIN.latitude + north / METRES_PER_DEGREE_LATITUDE),
      degreesLongitude(ORIGIN.longitude + east / perDegreeLongitude),
    );
  const along = (from: [number, number], to: [number, number]): [number, number][] => {
    const steps = Math.round(sideMetres / spacing);
    return Array.from({ length: steps }, (_, step) => [
      from[0] + ((to[0] - from[0]) * step) / steps,
      from[1] + ((to[1] - from[1]) * step) / steps,
    ]);
  };
  const corners: [number, number][] = [
    ...along([0, 0], [0, sideMetres]),
    ...along([0, sideMetres], [sideMetres, sideMetres]),
    ...along([sideMetres, sideMetres], [sideMetres, 0]),
    ...along([sideMetres, 0], [0, 0]),
    [0, 0],
  ];
  return corners.map(([north, east], index) => ({
    position: corner(north, east),
    elevation: altitudeMetres(20 + 15 * Math.sin((index / corners.length) * 2 * Math.PI)),
  }));
}

/** Flat to 500 m, then 1 000 m at +6 %, then flat to 2 000 m. */
const RAMP_START = 500;
const RAMP_END = 1500;
function sixPercentSection(distance: number): number {
  if (distance <= RAMP_START) return 100;
  if (distance >= RAMP_END) return 100 + (RAMP_END - RAMP_START) * 0.06;
  return 100 + (distance - RAMP_START) * 0.06;
}

const ramped = routeProfile(straightRoute(2000, 10, sixPercentSection));

/** A driver that writes on every offered second, so a test can watch the value. */
const trackingDriver = (profile = ramped) =>
  createSimulationDriver({ profile, gradeDeadbandPercent: 0 });

describe('the gradient at the rider’s position', () => {
  it('writes the profile’s own grade at a +6 % section, within tolerance', () => {
    const driver = trackingDriver();

    // Ride the whole route at 10 m/s, one sample a second.
    const written = new Map<number, number>();
    for (let second = 0; second <= 200; second += 1) {
      const setpoint = driver.sample({
        at: unixSeconds(1_800_000_000 + second),
        distance: metres(second * 10),
      });
      if (setpoint !== undefined) {
        written.set(setpoint.distanceOnRoute, setpoint.grade);
      }
    }

    // Every write agrees with the profile it came from, everywhere.
    for (const [distance, grade] of written) {
      expect(grade).toBeCloseTo(gradeAt(ramped, distance), 6);
    }

    // And in the middle of the section — where the 100 m slope window sits
    // entirely inside the ramp — that number is 6.
    const midRamp = written.get((RAMP_START + RAMP_END) / 2);
    expect(midRamp).toBeDefined();
    expect(midRamp as number).toBeCloseTo(6, 1);
  });

  it('reports a descent as a negative grade, so a descent stays a descent', () => {
    const descent = routeProfile(straightRoute(1000, 10, (distance) => 200 - distance * 0.06));
    const driver = trackingDriver(descent);
    driver.sample({ at: unixSeconds(1_800_000_000), distance: metres(0) });
    const setpoint = driver.sample({ at: unixSeconds(1_800_000_050), distance: metres(500) });
    expect(setpoint?.grade).toBeCloseTo(-6, 1);
  });

  it('wraps a loop, so a second lap re-rides the same hill', () => {
    const driver = trackingDriver();
    const first = driver.sample({ at: unixSeconds(1_800_000_000), distance: metres(1000) });
    driver.restart();
    // 2 000 m is the whole route; a point-to-point clamps to its end.
    const second = driver.sample({ at: unixSeconds(1_800_000_100), distance: metres(3000) });
    expect(first?.distanceOnRoute).toBe(1000);
    expect(second?.distanceOnRoute).toBe(ramped.totalDistance);

    const loop = routeProfile(squareLoop(500, 25), { loop: true });
    const looping = trackingDriver(loop);
    looping.sample({ at: unixSeconds(1_800_000_000), distance: metres(0) });
    // A lap and a half of a 2 000 m loop is 1 000 m along it, not off its end.
    const lapped = looping.sample({ at: unixSeconds(1_800_000_100), distance: metres(3000) });
    expect(loop.totalDistance).toBeCloseTo(2000, 0);
    expect(lapped?.distanceOnRoute).toBeCloseTo(3000 - loop.totalDistance, 6);
  });
});

describe('how often it writes', () => {
  it('writes at most once per second', () => {
    const driver = trackingDriver();
    const at = (offset: number) => unixSeconds(1_800_000_000 + offset);

    expect(driver.sample({ at: at(0), distance: metres(600) })).toBeDefined();
    // Ten offers inside the same second: nine of them are 100 ms apart.
    let written = 0;
    for (let tenth = 1; tenth <= 9; tenth += 1) {
      if (driver.sample({ at: at(tenth / 10), distance: metres(600 + tenth) }) !== undefined) {
        written += 1;
      }
    }
    expect(written).toBe(0);
    expect(SIMULATION_SETPOINT_INTERVAL_SECONDS).toBe(1);
    expect(driver.sample({ at: at(1), distance: metres(610) })).toBeDefined();
  });

  it('holds its peace on a flat road, and writes the moment the hill starts', () => {
    // The deadband, at its default. Flat for 500 m: one write, then nothing.
    const driver = createSimulationDriver({ profile: ramped });
    const setpoints = [];
    for (let second = 0; second <= 100; second += 1) {
      const setpoint = driver.sample({
        at: unixSeconds(1_800_000_000 + second),
        distance: metres(second * 5),
      });
      if (setpoint !== undefined) setpoints.push(setpoint);
    }
    // 100 s at 5 m/s is 500 m, which is exactly the flat. One write for the
    // flat itself, and the rest only once the slope window starts to see the
    // ramp — far fewer than the 101 an unconditional 1 Hz driver would send.
    expect(setpoints.length).toBeGreaterThan(0);
    expect(setpoints.length).toBeLessThan(60);
    expect(SIMULATION_GRADE_DEADBAND_PERCENT).toBe(0.1);

    // Every gap between consecutive writes is a real change of gradient.
    for (let index = 1; index < setpoints.length; index += 1) {
      const previous = setpoints[index - 1] as (typeof setpoints)[number];
      const current = setpoints[index] as (typeof setpoints)[number];
      expect(Math.abs(current.grade - previous.grade)).toBeGreaterThanOrEqual(
        SIMULATION_GRADE_DEADBAND_PERCENT,
      );
    }
  });

  it('writes the first sample whatever the gradient, because the trainer has none', () => {
    const flat = routeProfile(straightRoute(1000, 10, () => 100));
    const driver = createSimulationDriver({ profile: flat });
    const first = driver.sample({ at: unixSeconds(1_800_000_000), distance: metres(0) });
    expect(first?.grade).toBeCloseTo(0, 6);
    // ...and then nothing, because nothing changed.
    expect(driver.sample({ at: unixSeconds(1_800_000_005), distance: metres(50) })).toBeUndefined();
  });

  it('writes again after a restart, because the machine’s parameters are a guess', () => {
    const flat = routeProfile(straightRoute(1000, 10, () => 100));
    const driver = createSimulationDriver({ profile: flat });
    driver.sample({ at: unixSeconds(1_800_000_000), distance: metres(0) });
    expect(driver.sample({ at: unixSeconds(1_800_000_005), distance: metres(50) })).toBeUndefined();
    driver.restart();
    expect(driver.last()).toBeUndefined();
    expect(driver.sample({ at: unixSeconds(1_800_000_006), distance: metres(60) })).toBeDefined();
  });
});

describe('what it refuses to be confused by', () => {
  it('writes nothing for a clock that goes backwards', () => {
    // ⚠️ `minimumIntervalSeconds: 0` deliberately. At the default 1 Hz limit a
    // backwards instant is refused by the RATE LIMIT — the difference is
    // negative, which is under any positive interval — so a test at the
    // default proves nothing about the ordering guard at all. Mutation-tested:
    // deleting the guard leaves such a test green. This is the configuration a
    // caller wanting every sample would use, and where the guard is the only
    // thing between a rewound clock and a gradient from the past being held as
    // the newest thing known.
    const driver = createSimulationDriver({
      profile: ramped,
      minimumIntervalSeconds: 0,
      gradeDeadbandPercent: 0,
    });
    driver.sample({ at: unixSeconds(1_800_000_100), distance: metres(600) });
    expect(
      driver.sample({ at: unixSeconds(1_800_000_090), distance: metres(1000) }),
    ).toBeUndefined();
    // The same instant twice is not "later" either.
    expect(
      driver.sample({ at: unixSeconds(1_800_000_100), distance: metres(1000) }),
    ).toBeUndefined();
    // The driver still holds what it wrote, for the position it wrote it for.
    expect(driver.last()?.at).toBe(1_800_000_100);
    expect(driver.last()?.distanceOnRoute).toBe(600);
    // Forward again works, so this is an ordering guard and not a stall.
    expect(driver.sample({ at: unixSeconds(1_800_000_101), distance: metres(1000) })).toBeDefined();
  });

  it('writes nothing for an instant that is not a number', () => {
    const driver = trackingDriver();
    expect(
      driver.sample({ at: Number.NaN as ReturnType<typeof unixSeconds>, distance: metres(600) }),
    ).toBeUndefined();
    expect(driver.last()).toBeUndefined();
  });

  it('saturates a gradient beyond the ceiling rather than refusing the sample', () => {
    // A cliff no despiking survives: 60 % for 300 m.
    const cliff = routeProfile(straightRoute(1000, 10, (distance) => distance * 0.6));
    const driver = createSimulationDriver({ profile: cliff, gradeDeadbandPercent: 0 });
    const setpoint = driver.sample({ at: unixSeconds(1_800_000_000), distance: metres(500) });
    expect(setpoint).toBeDefined();
    expect(setpoint?.grade).toBe(MAX_SIMULATED_GRADE_PERCENT);

    const descent = routeProfile(straightRoute(1000, 10, (distance) => 1000 - distance * 0.6));
    const falling = createSimulationDriver({ profile: descent, gradeDeadbandPercent: 0 });
    expect(falling.sample({ at: unixSeconds(1_800_000_000), distance: metres(500) })?.grade).toBe(
      -MAX_SIMULATED_GRADE_PERCENT,
    );
  });

  it('treats a non-finite distance as the start of the route rather than throwing', () => {
    const driver = trackingDriver();
    const setpoint = driver.sample({
      at: unixSeconds(1_800_000_000),
      distance: Number.NaN as ReturnType<typeof metres>,
    });
    expect(setpoint?.distanceOnRoute).toBe(0);
  });
});
