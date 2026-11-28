// SPDX-License-Identifier: Apache-2.0

/**
 * Synthetic courses for the group plan's tests — #3298.
 *
 * **None is taken from a real ride or a real place.** Each is a list of
 * straight stretches, `[metres, grade %]`, built on a 10 m grid with every
 * position at the same made-up point, so no course here can be placed on a
 * map. Imported by tests only, here and in `packages/physics`.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
} from '../../quantities';
import type { RouteProfile } from '../../route/profile';

/** One straight stretch: its length in metres and its grade in percent. */
export type Stretch = readonly [lengthMetres: number, gradePercent: number];

/** The grid the fixtures are built on, metres: a route profile's own spacing. */
export const FIXTURE_STEP_METRES = 10;

/** 10 km, level all the way. */
export const FLAT_COURSE: readonly Stretch[] = [[10_000, 0]];

/**
 * 10 km with one climb, one descent and flats: 3 km level, **1.5 km at +8 %**
 * (the climb of at least 5 % for 1 km the issue asks for), 1 km level, 1.5 km
 * at −8 % (the steepest descent), then 3 km level.
 */
export const HILLY_COURSE: readonly Stretch[] = [
  [3_000, 0],
  [1_500, 8],
  [1_000, 0],
  [1_500, -8],
  [3_000, 0],
];

/** Where each stretch of `stretches` starts and ends, metres. */
export function stretchBounds(
  stretches: readonly Stretch[],
): readonly (readonly [start: number, end: number])[] {
  let start = 0;
  return stretches.map(([length]) => {
    const bounds = [start, start + length] as const;
    start += length;
    return bounds;
  });
}

/**
 * A route profile over `stretches` on a {@link FIXTURE_STEP_METRES} grid, the
 * grade at each sample the slope to the next one, unsmoothed (as
 * `pacer/terrain-rule.test.ts` builds its own).
 */
export function courseOf(stretches: readonly Stretch[]): RouteProfile {
  const length = stretches.reduce((sum, [metresLong]) => sum + metresLong, 0);
  const count = Math.round(length / FIXTURE_STEP_METRES) + 1;
  const heightAt = (along: number): number => {
    let height = 100;
    let start = 0;
    for (const [metresLong, grade] of stretches) {
      height += (Math.min(Math.max(0, along - start), metresLong) * grade) / 100;
      start += metresLong;
    }
    return height;
  };
  const heights = Array.from({ length: count }, (_, at) => heightAt(at * FIXTURE_STEP_METRES));
  const grades = heights.map((value, at) => {
    const next = heights[at + 1];
    const prior = heights[at - 1] ?? value;
    return ((next === undefined ? value - prior : next - value) / FIXTURE_STEP_METRES) * 100;
  });
  return {
    loop: false,
    resolution: metres(FIXTURE_STEP_METRES),
    totalDistance: metres(length),
    totalAscent: metres(0),
    totalDescent: metres(0),
    elevations: heights.map((value) => altitudeMetres(value)),
    grades: grades.map((value) => gradePercent(value)),
    positions: heights.map(() => geographicPosition(degreesLatitude(0), degreesLongitude(0))),
  };
}
