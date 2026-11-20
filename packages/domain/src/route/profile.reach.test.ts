// SPDX-License-Identifier: Apache-2.0

/**
 * How far ahead of the rider {@link gradeAt} reads the road — ADR 0087 D-6.1.
 *
 * The open-world ride swaps the tail of its rolling route past a junction and
 * extends it as the rider goes. ADR 0087 locks a junction choice 100 m before
 * the junction on the claim that the grade sent at `s` reads the road only up
 * to `s + 80 m`. That claim has a precondition, and these two tests are a pair
 * that state it:
 *
 * - **On one grid** (two roads of the same length, so the same spacing and the
 *   same window counts), the grade anywhere 80 m or more short of the junction
 *   is the same whatever the road past it does.
 * - **On a stretched grid** — {@link routeProfile} spreads its samples over the
 *   road's whole length — a tail of a different length moves every sample, and
 *   the grade changes far more than 100 m before the junction, by more than the
 *   trainer's 0.1 % deadband. That is why ADR 0087 D-4.1 samples the open-world
 *   road on a ride-anchored, unstretched grid rather than through
 *   `routeProfile`'s resampling as it is.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
} from '../quantities';
import type { GeographicPosition } from '../quantities';

import { gradeAt, routeProfile, type RoutePoint } from './profile';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(40), degreesLongitude(-105));

/** The junction, 2 km along an identical prefix. */
const JUNCTION_METRES = 2_000;
/** ADR 0087 D-6.1's reach: 10 m to the next sample, 50 m of slope, 20 m of median. */
const REACH_METRES = 80;
/** ADR 0087 D-6.2's lock. */
const LOCK_METRES = 100;
/** `simulation.ts`'s deadband: a change smaller than this is never written. */
const DEADBAND_PERCENT = 0.1;
const SOURCE_SPACING_METRES = 7;

function northOf(metres: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(ORIGIN.latitude + metres / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN.longitude),
  );
}

/** Rough but deterministic ground: rolling hills plus a few metres of noise. */
function roughHeight(distance: number): number {
  const noise = Math.sin(distance * 12.9898) * 43_758.5453;
  return 1_600 + 25 * Math.sin(distance / 180) + 3 * (noise - Math.floor(noise));
}

/**
 * The shared prefix up to the junction, which is a point of every road, then a
 * tail of `tailMetres` that leaves the junction at `tailGradePercent`.
 */
function road(tailMetres: number, tailGradePercent: number): RoutePoint[] {
  const point = (distance: number, height: number): RoutePoint => ({
    position: northOf(distance),
    elevation: altitudeMetres(height),
  });
  const points: RoutePoint[] = [];
  for (let distance = 0; distance < JUNCTION_METRES; distance += SOURCE_SPACING_METRES) {
    points.push(point(distance, roughHeight(distance)));
  }
  const junctionHeight = roughHeight(JUNCTION_METRES);
  points.push(point(JUNCTION_METRES, junctionHeight));
  const tail = (distance: number): RoutePoint =>
    point(distance, junctionHeight + ((distance - JUNCTION_METRES) * tailGradePercent) / 100);
  const end = JUNCTION_METRES + tailMetres;
  for (
    let distance = JUNCTION_METRES + SOURCE_SPACING_METRES;
    distance < end;
    distance += SOURCE_SPACING_METRES
  ) {
    points.push(tail(distance));
  }
  points.push(tail(end));
  return points;
}

/** The largest grade difference between two roads at every half metre up to `until`. */
function largestDifference(first: RoutePoint[], second: RoutePoint[], until: number): number {
  const one = routeProfile(first);
  const other = routeProfile(second);
  let largest = 0;
  for (let distance = 0; distance <= until; distance += 0.5) {
    largest = Math.max(
      largest,
      Math.abs((gradeAt(one, distance) as number) - (gradeAt(other, distance) as number)),
    );
  }
  return largest;
}

describe('how far ahead the grade reads the road (ADR 0087 D-6.1)', () => {
  it('on one grid, reads nothing more than 80 m ahead: a different tail of the same length changes no grade short of that', () => {
    expect(largestDifference(road(600, 60), road(600, -60), JUNCTION_METRES - REACH_METRES)).toBe(
      0,
    );
  });

  it('on a stretched grid, a tail of a different length changes the grade more than 100 m before the junction', () => {
    expect(
      largestDifference(road(600, 0), road(655, 0), JUNCTION_METRES - LOCK_METRES),
    ).toBeGreaterThan(DEADBAND_PERCENT);
  });
});
