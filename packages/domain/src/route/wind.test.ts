// SPDX-License-Identifier: Apache-2.0

/**
 * #326: the wind, and resolving it against a route's own bearings.
 *
 * The assertions that carry the most weight are the sign ones. A cosine with
 * the wrong sign — `heading - fromBearing` instead of `fromBearing - heading`
 * — is symmetric and therefore invisible to a test that only checks
 * magnitudes, and it would drive a rider into a headwind whenever they had a
 * tailwind. So every directional case here pins the sign as well as the size,
 * and the two 90° cases pin that a pure crosswind contributes nothing.
 */

import { describe, expect, it } from 'vitest';

import { UnitError } from '../unit-error';
import {
  altitudeMetres,
  degreesBearing,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
} from '../quantities';
import type { GeographicPosition } from '../quantities';

import { headingOnRoute, routeProfile, type RoutePoint } from './profile';
import {
  headwindOnRoute,
  MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
  STILL_AIR,
  tangentialWindMetresPerSecond,
  wind,
} from './wind';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

/** `north` and `east` metres from {@link ORIGIN}. */
function offset(north: number, east: number): GeographicPosition {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(ORIGIN.latitude + north / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN.longitude + east / perDegreeLongitude),
  );
}

/** A closed square, so a loop's ends meet and its four sides have four headings. */
function squareLoop(sideMetres: number, spacing: number): RoutePoint[] {
  const corners: [number, number][] = [
    [0, 0],
    [sideMetres, 0],
    [sideMetres, sideMetres],
    [0, sideMetres],
  ];
  const points: RoutePoint[] = [];
  for (const [index, from] of corners.entries()) {
    const to = corners[(index + 1) % corners.length] as [number, number];
    const steps = Math.round(sideMetres / spacing);
    for (let step = 0; step < steps; step += 1) {
      points.push({
        position: offset(
          from[0] + ((to[0] - from[0]) * step) / steps,
          from[1] + ((to[1] - from[1]) * step) / steps,
        ),
        elevation: altitudeMetres(10),
      });
    }
  }
  points.push({ position: offset(0, 0), elevation: altitudeMetres(10) });
  return points;
}

/** A flat route running due `direction`, `lengthMetres` long, sampled every 10 m. */
function straightRoute(
  direction: 'north' | 'east',
  lengthMetres: number,
  spacing = 10,
): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= lengthMetres; along += spacing) {
    points.push({
      position: direction === 'north' ? offset(along, 0) : offset(0, along),
      elevation: altitudeMetres(10),
    });
  }
  return points;
}

describe('wind', () => {
  it('normalises the bearing it is given', () => {
    expect(wind(5, -90).fromBearing).toBe(270);
    expect(wind(5, 450).fromBearing).toBe(90);
  });

  it('refuses a negative speed, because a direction is a field and not a sign', () => {
    expect(() => wind(-1, 0)).toThrow(UnitError);
  });

  it('refuses a speed past the typo guard, and names the bound and the value', () => {
    // The bound is inclusive: exactly the maximum is a wind, not a refusal.
    expect(() => wind(MAXIMUM_WIND_SPEED_METRES_PER_SECOND, 0)).not.toThrow();
    expect(() => wind(MAXIMUM_WIND_SPEED_METRES_PER_SECOND + 0.001, 0)).toThrow(UnitError);
    // Not a coordinate, so ADR 0004 decision D does not withhold the value —
    // and the value is what shows a rider the decimal point they slipped.
    expect(() => wind(500, 0)).toThrow(/at most 40, received 500/);
  });

  it('refuses a speed that is not a number at all', () => {
    expect(() => wind(Number.NaN, 0)).toThrow(UnitError);
    expect(() => wind(Number.POSITIVE_INFINITY, 0)).toThrow(UnitError);
  });

  it('refuses a bearing that is not finite, rather than normalising a NaN to zero', () => {
    expect(() => wind(5, Number.NaN)).toThrow(UnitError);
  });
});

describe('tangentialWindMetresPerSecond', () => {
  it('is the whole wind, positive, when it blows from straight ahead', () => {
    const northerly = wind(6, 0);
    expect(tangentialWindMetresPerSecond(northerly, degreesBearing(0))).toBeCloseTo(6, 9);
  });

  it('is the whole wind, NEGATIVE, when it blows from straight behind', () => {
    // The sign is the assertion. A tailwind that arrives positive is a headwind
    // in `packages/physics`, which adds this to the ground speed.
    const northerly = wind(6, 0);
    expect(tangentialWindMetresPerSecond(northerly, degreesBearing(180))).toBeCloseTo(-6, 9);
  });

  it('is nothing at all when the wind is square across the road', () => {
    const northerly = wind(6, 0);
    expect(tangentialWindMetresPerSecond(northerly, degreesBearing(90))).toBeCloseTo(0, 9);
    expect(tangentialWindMetresPerSecond(northerly, degreesBearing(270))).toBeCloseTo(0, 9);
  });

  it('resolves a quartering wind by its cosine', () => {
    // 12 m/s from the north-west, riding north-west: straight into it.
    expect(tangentialWindMetresPerSecond(wind(12, 315), degreesBearing(315))).toBeCloseTo(12, 9);
    // Riding north into that same north-westerly: cos 45°.
    expect(tangentialWindMetresPerSecond(wind(12, 315), degreesBearing(0))).toBeCloseTo(
      12 * Math.SQRT1_2,
      9,
    );
    // Riding south-east: a full tailwind.
    expect(tangentialWindMetresPerSecond(wind(12, 315), degreesBearing(135))).toBeCloseTo(-12, 9);
  });

  it('gives the same answer for a heading expressed either side of the wrap', () => {
    const westerly = wind(9, 270);
    expect(tangentialWindMetresPerSecond(westerly, degreesBearing(359))).toBeCloseTo(
      tangentialWindMetresPerSecond(westerly, degreesBearing(-1)),
      9,
    );
  });

  it('is zero in still air, whatever the heading', () => {
    for (const heading of [0, 37, 180, 359]) {
      // `toBeCloseTo` rather than `toBe`, because `0 * cos 180°` is IEEE 754's
      // negative zero. It adds to a ground speed exactly as `+0` does, so the
      // distinction is the matcher's and not the model's.
      expect(tangentialWindMetresPerSecond(STILL_AIR, degreesBearing(heading))).toBeCloseTo(0, 12);
    }
  });
});

describe('headingOnRoute', () => {
  it('reads a due-east road as ninety degrees', () => {
    const profile = routeProfile(straightRoute('east', 200));
    expect(headingOnRoute(profile, 0)).toBeCloseTo(90, 1);
    expect(headingOnRoute(profile, 105)).toBeCloseTo(90, 1);
  });

  it('reads a due-north road as zero', () => {
    const profile = routeProfile(straightRoute('north', 200));
    // Normalised into [0, 360), so due north is 0 and never 360.
    expect(headingOnRoute(profile, 50)).toBeCloseTo(0, 1);
  });

  it('turns the corner of a square loop rather than holding the first leg’s bearing', () => {
    // North up the first side, then east along the second. If this read one
    // bearing for the whole route — the mistake a "the route has a heading"
    // shortcut makes — the two would be equal.
    const side = 400;
    const points: RoutePoint[] = [];
    for (let along = 0; along <= side; along += 20) {
      points.push({ position: offset(along, 0), elevation: altitudeMetres(10) });
    }
    for (let along = 20; along <= side; along += 20) {
      points.push({ position: offset(side, along), elevation: altitudeMetres(10) });
    }
    const profile = routeProfile(points);
    expect(headingOnRoute(profile, 100)).toBeCloseTo(0, 0);
    expect(headingOnRoute(profile, side + 100)).toBeCloseTo(90, 0);
  });

  it('wraps a loop, so lap two reads the same heading as lap one', () => {
    const profile = routeProfile(squareLoop(400, 20), { loop: true });
    const oneLap = profile.totalDistance;
    for (const along of [50, 450, 850, 1250]) {
      expect(headingOnRoute(profile, along + oneLap)).toBeCloseTo(
        headingOnRoute(profile, along) ?? Number.NaN,
        6,
      );
    }
    // And the four sides really do have four different headings, so the case
    // above is not comparing one constant with itself.
    const headings = [50, 450, 850, 1250].map((along) => headingOnRoute(profile, along));
    expect(new Set(headings).size).toBe(4);
  });

  it('clamps past the end of a point-to-point route rather than falling off the grid', () => {
    const profile = routeProfile(straightRoute('east', 200));
    expect(headingOnRoute(profile, 10_000)).toBeCloseTo(90, 1);
    expect(headingOnRoute(profile, -10_000)).toBeCloseTo(90, 1);
  });

  it('has no answer where the road has no direction', () => {
    const straight = routeProfile(straightRoute('east', 200));
    const here = offset(0, 0);
    // Two coincident grid positions: the route stands still there, so there is
    // no bearing to report and `undefined` says so rather than claiming north.
    expect(headingOnRoute({ ...straight, positions: [here, here] }, 0)).toBeUndefined();
    // And a profile with a single position has no cell at all.
    expect(headingOnRoute({ ...straight, positions: [here] }, 0)).toBeUndefined();
  });
});

describe('headwindOnRoute', () => {
  it('turns a rider around a corner from a headwind into a tailwind', () => {
    // A northerly. Riding north up the first side is straight into it; turning
    // east at the corner puts it square across; the wind never changed.
    const side = 400;
    const points: RoutePoint[] = [];
    for (let along = 0; along <= side; along += 20) {
      points.push({ position: offset(along, 0), elevation: altitudeMetres(10) });
    }
    for (let along = 20; along <= side; along += 20) {
      points.push({ position: offset(side, along), elevation: altitudeMetres(10) });
    }
    const profile = routeProfile(points);
    const northerly = wind(8, 0);
    expect(headwindOnRoute(profile, 100, northerly)).toBeCloseTo(8, 1);
    expect(headwindOnRoute(profile, side + 100, northerly)).toBeCloseTo(0, 1);
  });

  it('reports a tailwind as a negative number, on the route', () => {
    const profile = routeProfile(straightRoute('east', 400));
    // From the east: a headwind riding east.
    expect(headwindOnRoute(profile, 100, wind(5, 90))).toBeCloseTo(5, 1);
    // From the west: a tailwind.
    expect(headwindOnRoute(profile, 100, wind(5, 270))).toBeCloseTo(-5, 1);
  });

  it('is still air where the route gives no heading', () => {
    const profile = {
      ...routeProfile(straightRoute('east', 200)),
      positions: [offset(0, 0), offset(0, 0)],
    };
    expect(headwindOnRoute(profile, 0, wind(20, 123))).toBe(0);
  });
});
