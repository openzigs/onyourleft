// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The first-paint intro** — #2053.
 *
 * The Android splash (#2050, #2052) is the mark on the canvas. The page's
 * first frame is the same picture: `index.html` carries `#oyl-intro`, the
 * mark at the splash's size and place on the canvas (`theme.css`
 * §"THE FIRST-PAINT INTRO"), so when the splash lets go the rider sees no
 * change at all. Then, once, the mark fades and grows out and the first route
 * shows through it, over `--oyl-motion-medium`.
 *
 * It ends at the moment the splash is released (`launch.tsx`, two frames after
 * the first route commits), so in a browser, which has no splash, it is the
 * same picture until the first route has painted.
 *
 * ## When it does not animate
 *
 * The element is removed at once, with no animation, when:
 *
 * - the first route is a ride route (`route-motion.ts`): a rider who opens
 *   the app on the Ride screen is pressing its controls, not watching a logo;
 * - the reader asked for less motion, or the screen cannot repaint cheaply
 *   ({@link LESS_MOTION_QUERY}, the two blocks at the end of `theme.css`);
 * - the first render failed: there is no route to show through it.
 *
 * Once per cold start: the element is in the document only as it loaded, and
 * this removes it; a navigation never brings it back.
 *
 * ⚠️ **CSS, not Motion.** This module is in the entry chunk, and Motion may
 * not be (`tools/bundle/entry-graph.ts`). The animation is a CSS keyframe on
 * a motion token, so `theme.a11y.test.ts` holds it to the 200 ms ceiling.
 */

import { isRideRoute } from './route-motion';
import type { RouteId } from './routes';

/** The id of the intro's element in `index.html`. */
export const INTRO_ID = 'oyl-intro';

/** The attribute that starts the intro's way out (`theme.css`). */
export const INTRO_LEAVING = 'data-oyl-intro';

/**
 * A reader who asked for less motion, or a screen that cannot repaint cheaply:
 * the two media `theme.css` collapses motion under.
 */
export const LESS_MOTION_QUERY = '(prefers-reduced-motion: reduce), (update: slow)';

/** What decides whether the intro animates. */
export interface IntroStart {
  /** The route the app started on. */
  readonly firstRoute: RouteId;
  /** Whether {@link LESS_MOTION_QUERY} matches. */
  readonly lessMotion: boolean;
  /** Whether the first render failed. */
  readonly failed: boolean;
}

/** Whether the intro animates out, rather than being removed at once. */
export function introAnimates(start: IntroStart): boolean {
  return !start.failed && !start.lessMotion && !isRideRoute(start.firstRoute);
}

/**
 * End the intro: animate `intro` out and remove it once every animation on it
 * has finished, or remove it at once when {@link introAnimates} says not to.
 * Nothing happens for an element that is absent or already gone, so a second
 * call is a no-op.
 */
export function endIntro(intro: HTMLElement | null, start: IntroStart): void {
  if (intro?.isConnected !== true) return;
  if (!introAnimates(start)) {
    intro.remove();
    return;
  }
  intro.setAttribute(INTRO_LEAVING, 'leaving');
  // Reading the animations brings the style up to date, so the keyframes the
  // attribute starts are among them. None (no stylesheet, or a browser with no
  // Web Animations) means nothing will end it: remove it now.
  const animations =
    typeof intro.getAnimations === 'function' ? intro.getAnimations({ subtree: true }) : [];
  if (animations.length === 0) {
    intro.remove();
    return;
  }
  void Promise.allSettled(animations.map(async (animation) => animation.finished)).then(() => {
    intro.remove();
  });
}
