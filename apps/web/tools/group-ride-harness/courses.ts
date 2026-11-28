// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness: **the fixture courses**, synthetic and fixed here.
 *
 * Each is a list of straight stretches, `[metres, grade %]`, built by
 * `@onyourleft/domain` §`courseOf` on its 10 m grid with every position at
 * the same made-up point: no course here is a real road or can be placed on
 * a map, and none is taken from a ride.
 *
 * **6 km each**, about twelve minutes at the harness's 30 km/h: room for
 * three turns on the front for every member of a line of six, and short
 * enough that `marks.*.test.ts` ride every marked rider in `pnpm run test`
 * inside a case's time.
 */

import { courseOf, type Stretch } from '@onyourleft/domain/group-ride-testing';
import type { RouteProfile } from '@onyourleft/domain';

/** Level all the way. */
export const FLAT_COURSE: readonly Stretch[] = [[6_000, 0]];

/**
 * One climb of 1 km at **+8 %**, at least 5 % for 1 km as the group plan's
 * own hilly fixture has (#3298), then down at −8 %, the steepest descent.
 */
export const HILLY_COURSE: readonly Stretch[] = [
  [1_500, 0],
  [1_000, 8],
  [500, 0],
  [1_000, -8],
  [2_000, 0],
];

/**
 * Short rollers: four times 500 m at +4 % and 500 m at −4 %, between level
 * kilometres. Where the owner's note on #3309 saw the group's speed swing
 * (14 to 24 mph against 19 mph) on a rolling route.
 */
export const ROLLING_COURSE: readonly Stretch[] = [
  [1_000, 0],
  [500, 4],
  [500, -4],
  [500, 4],
  [500, -4],
  [500, 4],
  [500, -4],
  [500, 4],
  [500, -4],
  [1_000, 0],
];

/** A fixture course, by its name in the score table. */
export interface HarnessCourse {
  readonly name: 'flat' | 'hilly' | 'rolling';
  readonly profile: RouteProfile;
}

/** The courses every scripted rider rides. */
export const HARNESS_COURSES: readonly HarnessCourse[] = [
  { name: 'flat', profile: courseOf(FLAT_COURSE) },
  { name: 'hilly', profile: courseOf(HILLY_COURSE) },
  { name: 'rolling', profile: courseOf(ROLLING_COURSE) },
];
