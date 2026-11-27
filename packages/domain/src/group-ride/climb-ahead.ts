// SPDX-License-Identifier: Apache-2.0

/**
 * **The climb the line's front is told of, held to its crest** — #3348, epic
 * #3296, ADR 0101.
 *
 * The rotation holds a pull change "from 300 m before a climb to its crest"
 * (`rotation.ts`), and the cue selector reads the same number (`cues.ts`).
 * Both take it as `RotationView.climbAheadM`: metres to the next climb's
 * start, 0 on one. {@link lineClimbAheadM} is where that number comes from.
 *
 * ## Why not `courseHillsAhead` alone
 *
 * `courseHillsAhead` (`route/course-ahead.ts`) summarises **only the road
 * ahead**, for a model that plans: a climb is 200 m or more *from where it is
 * read*, so in a climb's last 200 m it reports none, or the next one. That is
 * right for the AI bots and the AI pacer, who have no climb left to plan for,
 * and it is unchanged. Read for the hold, it lifted the hold about 200 m
 * before the top, where the line is still climbing.
 *
 * So the front is on a climb here while the **whole** stretch it stands on,
 * behind it and ahead, is a climb by `courseHillsAhead`'s own thresholds
 * ({@link COURSE_HILL_GRADE_PERCENT} for {@link COURSE_HILL_LEAST_METRES}),
 * read from the course profile at its own spacing. Off one, the answer is
 * `courseHillsAhead`'s.
 *
 * Only `+ − × ÷` and comparisons; no clock, no draw, no coordinate.
 */

import {
  COURSE_HILL_GRADE_PERCENT,
  COURSE_HILL_LEAST_METRES,
  courseHillsAhead,
} from '../route/course-ahead';
import { distanceOnRoute, gradeAt, type RouteProfile } from '../route/profile';

/**
 * Whether `from` is on a climb: the unbroken stretch at
 * {@link COURSE_HILL_GRADE_PERCENT} or steeper through it, counted behind and
 * ahead at the profile's spacing, is {@link COURSE_HILL_LEAST_METRES} or more.
 * A route that is not a loop has no road before its start or past its end.
 */
function onClimb(profile: RouteProfile, from: number): boolean {
  const steep = (at: number): boolean =>
    (gradeAt(profile, at) as number) >= COURSE_HILL_GRADE_PERCENT;
  if (!steep(from)) return false;
  const step = profile.resolution as number;
  const on = distanceOnRoute(profile, from);
  const road = (at: number): boolean => profile.loop || (at >= 0 && at <= profile.totalDistance);
  let length = step;
  for (const way of [-1, 1]) {
    for (let along = step; length < COURSE_HILL_LEAST_METRES; along += step) {
      const at = on + way * along;
      if (!(road(at) && steep(at))) break;
      length += step;
    }
  }
  return length >= COURSE_HILL_LEAST_METRES;
}

/**
 * Metres from `from` (the front's odometer on `profile`, wrapped on a loop) to
 * the next climb's start: **0 from a climb's start to its crest**, and `null`
 * with none in `courseHillsAhead`'s reach. What `RotationView.climbAheadM` is
 * given.
 */
export function lineClimbAheadM(profile: RouteProfile, from: number): number | null {
  if (onClimb(profile, from)) return 0;
  return courseHillsAhead(profile, from).climb?.inM ?? null;
}
