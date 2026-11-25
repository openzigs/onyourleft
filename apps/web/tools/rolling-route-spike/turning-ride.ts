// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: the scripted ride — a 90° turn every 300 to 500 m, left or
 * right from a seeded generator, at a steady speed. Throwaway (see
 * `rolling-profile.ts`).
 *
 * The legs are compass-aligned (north, east, south, west), so started on a
 * crossroads of a north–south grid town the ride turns where the real
 * streets do, about. It does not follow the street graph: that is #2881's.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';

/** The shortest and longest straight between two turns: the issue's 300 to 500 m. */
export const LEG_MIN_METRES = 300;
export const LEG_MAX_METRES = 500;

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** A place in plain degrees: a `GeographicPosition` is one. */
export interface Degrees {
  readonly latitude: number;
  readonly longitude: number;
}

/** One straight of the ride: which way, and how long. */
export interface Leg {
  /** Compass degrees: 0 north, 90 east, 180 south, 270 west. */
  readonly heading: 0 | 90 | 180 | 270;
  readonly metres: number;
}

/** A deterministic generator: mulberry32, so a seed names one ride. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** `count` legs from `heading`, each turned 90° left or right from the last. */
export function turningLegs(seed: number, count: number, heading: Leg['heading'] = 0): Leg[] {
  const random = seeded(seed);
  const legs: Leg[] = [];
  let facing: number = heading;
  for (let index = 0; index < count; index += 1) {
    const metres = Math.round(LEG_MIN_METRES + (LEG_MAX_METRES - LEG_MIN_METRES) * random());
    legs.push({ heading: facing as Leg['heading'], metres });
    facing = (facing + (random() < 0.5 ? 90 : 270)) % 360;
  }
  return legs;
}

/** Where `metres` along `heading` from `from` is, on a local flat earth. */
export function moved(from: Degrees, heading: number, metres: number): GeographicPosition {
  const radians = (heading * Math.PI) / 180;
  const north = Math.cos(radians) * metres;
  const east = Math.sin(radians) * metres;
  const perLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(from.latitude + north / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(from.longitude + east / perLongitude),
  );
}

/** The rider's position every `stepSeconds` at `metresPerSecond` along `legs` from `start`. */
export function ridden(
  start: Degrees,
  legs: readonly Leg[],
  metresPerSecond: number,
  stepSeconds: number,
): GeographicPosition[] {
  const path: GeographicPosition[] = [moved(start, 0, 0)];
  const step = metresPerSecond * stepSeconds;
  let corner: Degrees = start;
  let into = step;
  for (const leg of legs) {
    while (into <= leg.metres) {
      path.push(moved(corner, leg.heading, into));
      into += step;
    }
    into -= leg.metres;
    corner = moved(corner, leg.heading, leg.metres);
  }
  return path;
}

/** Each leg's end, from `start`: the junctions, then the ride's end. */
export function legEnds(start: Degrees, legs: readonly Leg[]): GeographicPosition[] {
  const ends: GeographicPosition[] = [];
  let at: Degrees = start;
  for (const leg of legs) {
    const next = moved(at, leg.heading, leg.metres);
    ends.push(next);
    at = next;
  }
  return ends;
}
