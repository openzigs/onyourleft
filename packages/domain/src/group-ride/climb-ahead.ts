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
 * So the front is on a climb here while the stretch it stands on is part of
 * one, behind it and ahead, by `courseHillsAhead`'s own thresholds
 * ({@link COURSE_HILL_GRADE_PERCENT} for {@link COURSE_HILL_LEAST_METRES}).
 * Off one, the answer is `courseHillsAhead`'s.
 *
 * ## Read on the profile's own samples (#3362)
 *
 * The front is read at the profile sample nearest it, and a stretch is
 * counted in whole samples: a sample at {@link COURSE_HILL_GRADE_PERCENT} or
 * steeper is one `resolution` of climb, as `courseHillsAhead` counts one.
 * Read on a lattice anchored at the front instead, a climb within about 10 m
 * of the least length was one or not with where the front stood between two
 * samples, and the hold went on and off from one window to the next.
 *
 * ## A climb goes on over a short easing (#3362)
 *
 * A climb starts with one stretch of {@link COURSE_HILL_LEAST_METRES} or more
 * unbroken, and goes on over any easing (road under the grade) shorter than
 * {@link LINE_CLIMB_EASING_METRES} into the steep road after it. So the hold
 * lasts to the top of a stepped climb whose last ramp is under 200 m, and
 * through each easing on the way. A road of short ramps with no 200 m stretch
 * is still no climb, as it is for `courseHillsAhead`.
 *
 * The easings a climb goes on over add up, and **under
 * {@link LINE_CLIMB_EASED_METRES} of them in all**, counted from the last 200 m
 * stretch, the climb goes on; the easing that takes the sum to it ends the
 * climb (owner ruling, 2026-11-27). So a long rolling road of short ramps and
 * short easings after one 200 m stretch is not one endless climb: the hold
 * ends at the next flat, and the rotation's pull change, deferred over a
 * climb, is not dropped. A second 200 m stretch starts the sum again.
 *
 * ## The ends of the road
 *
 * A route that is not a loop has no road before its start or past its end. At
 * or past its end the climb is over, `null`, so a summit finish does not hold
 * a line that rides on past it. A loop's last sample is its first.
 *
 * Only `+ − × ÷` and comparisons; no clock, no draw, no coordinate.
 */

import {
  COURSE_HILL_GRADE_PERCENT,
  COURSE_HILL_LEAST_METRES,
  courseHillsAhead,
} from '../route/course-ahead';
import { distanceOnRoute, type RouteProfile } from '../route/profile';
import { GroupRideError } from './errors';

/**
 * The easing a climb goes on over is shorter than this, metres: **100**, half
 * a climb's least length. A hairpin or a short flat between two ramps is the
 * same climb; road under {@link COURSE_HILL_GRADE_PERCENT} for 100 m or more
 * ends it, and a ramp after that is a ramp.
 */
export const LINE_CLIMB_EASING_METRES = COURSE_HILL_LEAST_METRES / 2;

/**
 * The easings a climb goes on over add up to less than this, metres: **200**,
 * a climb's least length, counted back from the front (the whole of an easing
 * it stands on included) to the last 200 m stretch. Two easings of 90 m are
 * the same climb; the third ends it. See the file comment.
 */
export const LINE_CLIMB_EASED_METRES = COURSE_HILL_LEAST_METRES;

/**
 * The finest profile spacing read, metres: **1**. `routeProfile` samples about
 * every 10 m, and on a route of a climb's least length or more never finer
 * than 9.5 m. Each walk here is counted in metres, so its steps, and
 * `courseHillsAhead`'s, grow as the spacing shrinks.
 */
const LEAST_SPACING_METRES = 1;

/**
 * Whether the sample `nearest` is on a climb: on a stretch of
 * {@link COURSE_HILL_LEAST_METRES} or more at {@link COURSE_HILL_GRADE_PERCENT}
 * or steeper, or on steep road or an easing joined back to one by easings each
 * shorter than {@link LINE_CLIMB_EASING_METRES} and together shorter than
 * {@link LINE_CLIMB_EASED_METRES}. See the file comment.
 */
function onClimb(profile: RouteProfile, nearest: number, step: number): boolean {
  const last = profile.grades.length - 1;
  const index = (sample: number): number | undefined => {
    if (profile.loop) return ((sample % last) + last) % last;
    return sample >= 0 && sample <= last ? sample : undefined;
  };
  const steep = (sample: number): boolean => {
    const at = index(sample);
    return at !== undefined && (profile.grades[at] as number) >= COURSE_HILL_GRADE_PERCENT;
  };
  /**
   * The samples of easing from `sample`, it included, one `way` to steep road:
   * `undefined` when the road ends first or the easing is too long to bridge.
   */
  const easing = (sample: number, way: 1 | -1): number | undefined => {
    let count = 0;
    while (!steep(sample + way * count)) {
      count += 1;
      if (index(sample + way * count) === undefined || count * step >= LINE_CLIMB_EASING_METRES) {
        return undefined;
      }
    }
    return count;
  };

  let at = nearest;
  /** The samples of easing bridged so far, back from the front. */
  let eased = 0;
  if (!steep(at)) {
    // On an easing: on the climb only when steep road resumes before it is too long.
    const behind = easing(at, -1);
    const ahead = easing(at, 1);
    if (behind === undefined || ahead === undefined) return false;
    eased = behind + ahead - 1;
    if (eased * step >= LINE_CLIMB_EASING_METRES) return false;
    at -= behind;
  }
  // The steep stretch through `at`, ahead and behind; then back over each easing to the one before.
  const enough = (samples: number): boolean => samples * step >= COURSE_HILL_LEAST_METRES;
  let forward = 0;
  while (!enough(forward + 1) && steep(at + forward + 1)) forward += 1;
  for (let walked = 0; walked <= last;) {
    let first = at;
    while (!enough(at - first + 1 + forward) && steep(first - 1)) first -= 1;
    if (enough(at - first + 1 + forward)) return true;
    const gap = easing(first - 1, -1);
    if (gap === undefined) return false;
    eased += gap;
    if (eased * step >= LINE_CLIMB_EASED_METRES) return false;
    walked += at - first + 1 + gap;
    at = first - 1 - gap;
    forward = 0;
  }
  return false;
}

/**
 * Metres from `from` (the front's odometer on `profile`, wrapped on a loop) to
 * the next climb's start: **0 from a climb's start to its crest**, and `null`
 * with none in `courseHillsAhead`'s reach or, on a route that is not a loop,
 * at or past its end. What `RotationView.climbAheadM` is given.
 *
 * A route shorter than {@link COURSE_HILL_LEAST_METRES} has no room for a
 * climb, so it reads `null` before its spacing is looked at: `routeProfile`
 * gives a route under a metre long a spacing under a metre, and a group ride
 * on one must not stop on its first tick.
 *
 * @throws {GroupRideError} `view-out-of-range` for a profile of a climb's
 *   least length or more whose `resolution` is not a finite number of metres,
 *   one metre or more: only a hand-built or stored profile, never one
 *   `routeProfile` built. On a spacing of 0 neither this nor
 *   `courseHillsAhead` would leave its loop, and each walk here is counted in
 *   metres, so its steps grow as the spacing shrinks: millions of them at a
 *   ten-thousandth of a metre.
 */
export function lineClimbAheadM(profile: RouteProfile, from: number): number | null {
  if ((profile.totalDistance as number) < COURSE_HILL_LEAST_METRES) return null;
  const step = profile.resolution as number;
  if (!Number.isFinite(step) || !(step >= LEAST_SPACING_METRES)) {
    throw new GroupRideError(
      'view-out-of-range',
      "a course profile's spacing must be a finite number of metres, a metre or more",
    );
  }
  if (!profile.loop && from >= (profile.totalDistance as number)) return null;
  const nearest = Math.round(distanceOnRoute(profile, from) / step);
  if (onClimb(profile, nearest, step)) return 0;
  return courseHillsAhead(profile, from).climb?.inM ?? null;
}
