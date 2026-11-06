// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a game's course picker lists — #2292, the Games tab (the owner's
 * ruling of 2026-11-06). `views/GameCoursesView.tsx` draws it; a course it
 * offers opens the trainer game's setup on that route with the game switched
 * on (`shell/routes.ts` §`hrefForGamePlay`).
 *
 * ## The seam the two pickers' own issues fill in
 *
 * {@link coursesFor} is the one place the list is decided, so the issues that
 * make each list better change this function and nothing that draws it:
 *
 * - **#2293**, the lap race's built-in circuits, adds its loops to the lap
 *   race's list.
 * - **#2294**, Delivery's picker, marks a saved route that passes fewer than
 *   `FEWEST_DELIVERY_HOUSES` mapped houses as unavailable with the count, and
 *   adds the built-in town rounds.
 *
 * Until then the lap race lists every saved route, a loop as a course and any
 * other route with the reason it is not one (a race is laps of a loop, ADR
 * 0060 D-11.1), and Delivery lists every saved route: the ride decides at the
 * press whether a route's towns hold a round, as it does from the setup today
 * (`StageChooser.tsx` §`DeliveryOffer`).
 *
 * ⚠️ **Pure, and importing nothing of the game but a type**, so the Games
 * group's chunk carries no renderer, map or network (the stage chooser's own
 * rule, `stage-chooser-imports.test.ts`).
 */

import type { GameMode } from '../shell/routes';

import type { RidableRoute } from './StageChooser';

/** One entry on a course picker. */
export interface GameCourse {
  readonly route: RidableRoute;
  /**
   * Why this route cannot hold the game, in words, for a course drawn greyed
   * with no way to choose it. `undefined`: it can be chosen.
   */
  readonly unavailable?: string | undefined;
}

/** The rider-facing words of the lists' refusals: the project's own, naming no other game. */
export const COURSE_TEXT = {
  notALoop: 'Not a loop. A lap race needs a route that ends where it starts.',
} as const;

/**
 * The courses a game's picker offers, those that can be chosen first and in
 * the order they were given; those that cannot after them, each with why.
 */
export function coursesFor(mode: GameMode, saved: readonly RidableRoute[]): readonly GameCourse[] {
  if (mode === 'delivery') {
    return saved.map((route) => ({ route }));
  }
  const loops = saved.filter((route) => route.profile.loop).map((route) => ({ route }));
  const others = saved
    .filter((route) => !route.profile.loop)
    .map((route) => ({ route, unavailable: COURSE_TEXT.notALoop }));
  return [...loops, ...others];
}

/** How many of the courses can be chosen. */
export function choosableCourses(courses: readonly GameCourse[]): number {
  return courses.filter((course) => course.unavailable === undefined).length;
}
