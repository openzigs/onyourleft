// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The touch lock — #1432: rain on the screen, or a glove brushing it, must not
 * pause, lap or stop a ride.
 *
 * ## What it ignores, and what it never does
 *
 * While a region is locked, a **tap** on a control inside it does nothing. A
 * tap is a `click` whose `detail` is above 0 — the press count a pointer
 * gives, in Chromium and in jsdom alike. A click from **Enter or Space**, or
 * the one a **screen reader** sends when it activates a control, has a
 * `detail` of 0 and goes through. Rain does not press keys, and a keyboard or
 * screen-reader rider must not be locked out of the ride by a control they
 * cannot see is on (WCAG 2.2 SC 2.1.1). ⚠️ That a TalkBack double tap arrives
 * with `detail` 0 in the Android shell's WebView is from Chromium's own
 * simulated click, and has not been measured on a device.
 *
 * It also stops a pointer's `mousedown`, so a raindrop does not move focus or
 * open the keyboard over the ride; and a `touchstart` on a form field (the ERG
 * target, the HUD's volume), which is how a field is changed with no click at
 * all. A `touchstart` anywhere else is let through, so the ride screen still
 * scrolls while it is locked.
 *
 * ## What it never stops
 *
 * - **The lock's own control** (`TouchLockButton.tsx`), whose release is a
 *   long press.
 * - **A control marked {@link TOUCH_LOCK_EXEMPT}**: the ones that stop what
 *   the app asks of the trainer — *End ERG* and *End workout* on the Ride
 *   screen, each of which releases an ERG target, and *End ride* on the game's HUD, which stops the game asking the trainer
 *   for a gradient (`GameView.tsx` §`teardown`). A rider who wants what the
 *   app asks of the trainer stopped must not first have to unlock the screen.
 */

import { useEffect, type RefObject } from 'react';

/** The attribute that takes a control out of the lock. @see Button `touchLockExempt` */
export const TOUCH_LOCK_EXEMPT = 'data-touch-lock-exempt';

/** The attribute the lock's own control wears, so the lock never swallows its release. */
export const TOUCH_LOCK_CONTROL = 'data-touch-lock-control';

/**
 * How long the lock's control is held to turn it off, in milliseconds.
 *
 * A second: well past Android's own long press (about 400 ms), so a drop that
 * lands and runs off does not do it, and short enough that a rider who means
 * it is not kept waiting at the bars.
 */
export const TOUCH_LOCK_HOLD_MILLISECONDS = 1000;

const FIELD = 'input, select, textarea';

/** Whether a locked region must swallow this event. */
export function swallowedByTouchLock(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest(`[${TOUCH_LOCK_EXEMPT}], [${TOUCH_LOCK_CONTROL}]`) !== null) {
    return false;
  }
  switch (event.type) {
    case 'click':
      return (event as MouseEvent).detail > 0;
    case 'mousedown':
      return true;
    case 'touchstart':
      return target.closest(FIELD) !== null;
    default:
      return false;
  }
}

const SWALLOWED = ['click', 'mousedown', 'touchstart'] as const;

/**
 * Lock `region` against taps while `locked` is true.
 *
 * Listeners in the CAPTURE phase, on the region itself: they run before the
 * event reaches the control and before React's own listener at the root sees
 * it bubble, so a stopped tap never reaches an `onClick`.
 */
export function useTouchLock(region: RefObject<HTMLElement | null>, locked: boolean): void {
  useEffect(() => {
    const element = region.current;
    if (!locked || element === null) {
      return undefined;
    }
    const swallow = (event: Event): void => {
      if (swallowedByTouchLock(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // `passive: false`, or a `touchstart` could not be refused.
    const options = { capture: true, passive: false } as const;
    for (const type of SWALLOWED) {
      element.addEventListener(type, swallow, options);
    }
    return () => {
      for (const type of SWALLOWED) {
        element.removeEventListener(type, swallow, options);
      }
    };
  }, [region, locked]);
}
