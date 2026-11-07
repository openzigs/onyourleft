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
 * - **#2293**, the lap race's built-in circuits (ADR 0064): handed in as
 *   `circuits`, from `GamePort.listCircuits`, and listed after the rider's
 *   own loops and before the routes that are not one. Never Delivery's: a
 *   circuit is a solo lap race and nothing else (D-8.1).
 * - **#2294**, Delivery's counts (merged): each saved route's houses for a
 *   round, counted on the device by `delivery/courses.ts` §`countCourses`
 *   and handed in as {@link DeliveryCounts}. A route that cannot hold one is
 *   unavailable with the reason in words, and one that can says "up to N
 *   houses", both in the ride setup's own words (`StageChooser.tsx`
 *   §`deliveryCourseLine`). The built-in town rounds are still to come.
 *
 * The lap race lists every saved route, a loop as a course and any other
 * route with the reason it is not one (a race is laps of a loop, ADR 0060
 * D-11.1), and the built-in circuits between them. Delivery with no counts
 * (no corridor port) lists every saved route, and the ride decides at the
 * press, as from the setup.
 *
 * ⚠️ **Pure, and importing nothing but the stage chooser's words**, which
 * import no planner (`stage-chooser-imports.test.ts`), so the Games group's
 * chunk carries no renderer, map or network. The count itself is loaded by
 * the picker with `import()`, only when Delivery's courses are counted.
 */

import type { GameMode } from '../shell/routes';

import type { WeekProgress } from './delivery/round';
import { deliveryCourseLine, type DeliveryCourse, type RidableRoute } from './StageChooser';

/** One entry on a course picker. */
export interface GameCourse {
  readonly route: RidableRoute;
  /**
   * Why this route cannot hold the game, in words, for a course drawn greyed
   * with no way to choose it. `undefined`: it can be chosen.
   */
  readonly unavailable?: string | undefined;
  /**
   * What the course holds for the game, for one that can be chosen — #2294's
   * "Delivery: up to N houses on the round", or that it is still counted.
   */
  readonly line?: string | undefined;
}

/** Delivery's counts, as the picker has them so far — #2294. */
export interface DeliveryCounts {
  /** Each route's count by id; a route not in it is still being counted. */
  readonly courses: ReadonlyMap<string, DeliveryCourse>;
  /** Today's round, which a route must hold (`deliveryCourseLine`). */
  readonly week: Pick<WeekProgress, 'houses'>;
}

/** The rider-facing words of the lists' refusals: the project's own, naming no other game. */
export const COURSE_TEXT = {
  notALoop: 'Not a loop. A lap race needs a route that ends where it starts.',
} as const;

/**
 * The courses a game's picker offers. The lap race's: the rider's loops
 * first and in the order they were given, then the built-in `circuits`
 * (#2293), then the routes that cannot be chosen, each with why. Delivery's:
 * in the order given, each with what it holds or why it holds no round, and
 * no circuit. ⚠️ Not re-sorted, because its counts arrive one route at a time
 * and a sort would move a card under the rider's finger (#2294's own reason
 * in the setup).
 */
export function coursesFor(
  mode: GameMode,
  saved: readonly RidableRoute[],
  delivery?: DeliveryCounts,
  circuits: readonly RidableRoute[] = [],
): readonly GameCourse[] {
  if (mode === 'delivery') {
    if (delivery === undefined) return saved.map((route) => ({ route }));
    return saved.map((route) => {
      const line = deliveryCourseLine(delivery.courses.get(route.id), delivery.week);
      return line.holds === false ? { route, unavailable: line.text } : { route, line: line.text };
    });
  }
  const loops = saved.filter((route) => route.profile.loop).map((route) => ({ route }));
  const others = saved
    .filter((route) => !route.profile.loop)
    .map((route) => ({ route, unavailable: COURSE_TEXT.notALoop }));
  const builtIn = circuits.map((route) => ({ route }));
  return [...loops, ...builtIn, ...others];
}

/** How many of the courses can be chosen. */
export function choosableCourses(courses: readonly GameCourse[]): number {
  return courses.filter((course) => course.unavailable === undefined).length;
}
