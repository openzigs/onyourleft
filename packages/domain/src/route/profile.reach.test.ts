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
 * - **On the anchored grid** (`rolling.ts`: sample `k` at exactly `k × 10 m`,
 *   windows counted and never derived from a spacing), the grade anywhere 80 m
 *   or more short of the junction is the same whatever the road past it does,
 *   **for two tails of different lengths**. Until #2899 this half ran over
 *   `routeProfile` with two tails of the same length, which is the one case
 *   where a stretched grid does not move; ADR 0087's table asks for this one.
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
import { RollingRoute, type RollingEdge, type RollingPoint } from './rolling';

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

/** `metres` due east of the junction. */
function eastOfJunction(metres: number): GeographicPosition {
  const junction = northOf(JUNCTION_METRES);
  return geographicPosition(
    degreesLatitude(junction.latitude),
    degreesLongitude(
      junction.longitude +
        metres / (METRES_PER_DEGREE_LATITUDE * Math.cos((junction.latitude * Math.PI) / 180)),
    ),
  );
}

/**
 * The same rough prefix north to the junction as {@link road}, as a rolling
 * route with two ways on: `climb`, straight on for 600 m at +60 %, and `fall`,
 * a right turn for 655 m at −60 %. Unpressed, the route takes `climb`.
 */
function rollingRoad(): RollingRoute {
  const prefix: RollingPoint[] = road(1, 0)
    .filter((_, index, all) => index < all.length - 1)
    .map(({ position, elevation }) => ({
      position,
      elevation: elevation ?? altitudeMetres(0),
    }));
  const junctionHeight = roughHeight(JUNCTION_METRES);
  const tail = (
    length: number,
    gradePercent: number,
    place: (metres: number) => GeographicPosition,
  ): RollingPoint[] => {
    const points: RollingPoint[] = [];
    for (let metres = 0; metres < length; metres += SOURCE_SPACING_METRES) {
      points.push({
        position: place(metres),
        elevation: altitudeMetres(junctionHeight + (metres * gradePercent) / 100),
      });
    }
    points.push({
      position: place(length),
      elevation: altitudeMetres(junctionHeight + (length * gradePercent) / 100),
    });
    return points;
  };
  const edges: RollingEdge[] = [
    { id: 'prefix', from: 'start', to: 'junction', points: prefix, roadClass: 1 },
    {
      id: 'climb',
      from: 'junction',
      to: 'top',
      points: tail(600, 60, (metres) => northOf(JUNCTION_METRES + metres)),
      roadClass: 1,
    },
    {
      id: 'fall',
      from: 'junction',
      to: 'bottom',
      points: tail(655, -60, eastOfJunction),
      roadClass: 1,
    },
  ];
  return new RollingRoute(
    { edgesFrom: (node) => edges.filter((edge) => edge.from === node) },
    edges[0] as RollingEdge,
  );
}

describe('how far ahead the grade reads the road (ADR 0087 D-6.1)', () => {
  it('on the anchored grid, reads nothing more than 80 m ahead: a tail of another length and slope changes no grade short of that', () => {
    const straight = rollingRoad();
    const turned = rollingRoad();
    // 500 m on, the route reaches past the junction, so its ways are held.
    straight.advance(500);
    turned.advance(500);
    const junction = turned.junctionsAfter(500)[0]?.distance ?? Number.NaN;
    expect(Math.abs(junction - JUNCTION_METRES)).toBeLessThan(1);
    expect(turned.choose(junction, 'fall', 500)).toBe('swapped');
    const one = straight.view();
    const other = turned.view();
    let largest = 0;
    for (let distance = 0; distance <= junction - REACH_METRES; distance += 0.5) {
      largest = Math.max(
        largest,
        Math.abs((gradeAt(one, distance) as number) - (gradeAt(other, distance) as number)),
      );
    }
    expect(largest).toBe(0);
    // And past the junction the two roads are as different as they were made.
    expect(gradeAt(one, junction + 200)).toBeCloseTo(60, 0);
    expect(gradeAt(other, junction + 200)).toBeCloseTo(-60, 0);
    // The reach is real: one sample nearer the junction, the grades do differ.
    expect(
      Math.abs(
        (gradeAt(one, junction - REACH_METRES + 15) as number) -
          (gradeAt(other, junction - REACH_METRES + 15) as number),
      ),
    ).toBeGreaterThan(0);
  });

  it('on a stretched grid, a tail of a different length changes the grade more than 100 m before the junction', () => {
    expect(
      largestDifference(road(600, 0), road(655, 0), JUNCTION_METRES - LOCK_METRES),
    ).toBeGreaterThan(DEADBAND_PERCENT);
  });
});
