// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The touch lock's one control — #1432. `touch-lock.ts` is what the lock does.
 *
 * A toggle (`aria-pressed`) with one constant name, *Touch lock*, on #437's
 * precedent: a screen reader says what the control is and which way it stands,
 * and the state is announced as the press changes it. Drawn as the design
 * system's toggle at the ride-time size (#669), so a sighted rider sees which
 * way it stands too.
 *
 * - **On** with one press of any kind. Locking is harmless, so it asks for
 *   nothing more.
 * - **Off** with a press held for {@link TOUCH_LOCK_HOLD_MILLISECONDS} — the
 *   deliberate gesture a drop running down the screen does not make. A shorter
 *   tap does nothing; lifting, sliding off or a cancelled pointer stops the
 *   hold. **Enter, Space or a screen reader's activation turns it off at once**
 *   (a click with `detail` 0): rain presses no keys, and a hold is not a
 *   gesture every keyboard or switch user can make (WCAG 2.2 SC 2.5.1).
 */

import { useEffect, useRef, type JSX } from 'react';

import { RIDE_SIZE_CLASS } from './Button';
import { TOUCH_LOCK_CONTROL, TOUCH_LOCK_HOLD_MILLISECONDS } from './touch-lock';

/** The control's accessible name, which is also every word it shows. */
export const TOUCH_LOCK_NAME = 'Touch lock';

export interface TouchLockButtonProps {
  readonly locked: boolean;
  readonly onLock: () => void;
  readonly onUnlock: () => void;
  /** Layout only, as `Button`'s `className` is. */
  readonly className?: string;
  /** The id of the sentence that says how to turn it off, where there is room for one. */
  readonly describedBy?: string;
}

export function TouchLockButton({
  locked,
  onLock,
  onUnlock,
  className,
  describedBy,
}: TouchLockButtonProps): JSX.Element {
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The click that follows the pointer lifted after a hold that unlocked. It
  // lands on the control the hold just turned off, and must not lock it again.
  const releasedByHold = useRef(false);
  const cancelHold = (): void => {
    if (hold.current !== undefined) {
      clearTimeout(hold.current);
      hold.current = undefined;
    }
  };
  useEffect(() => cancelHold, []);
  useEffect(() => {
    if (!locked) {
      cancelHold();
    }
  }, [locked]);

  const classes = `oyl-button oyl-button--toggle ${RIDE_SIZE_CLASS} oyl-touch-lock`;
  return (
    <button
      type="button"
      className={className === undefined ? classes : `${classes} ${className}`}
      aria-pressed={locked}
      aria-describedby={describedBy}
      {...{ [TOUCH_LOCK_CONTROL]: '' }}
      onPointerDown={(event) => {
        releasedByHold.current = false;
        if (!locked || (event.pointerType === 'mouse' && event.button !== 0)) {
          return;
        }
        cancelHold();
        hold.current = setTimeout(() => {
          hold.current = undefined;
          releasedByHold.current = true;
          onUnlock();
        }, TOUCH_LOCK_HOLD_MILLISECONDS);
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => {
        // A long press on Android opens the context menu, which would
        // cancel the hold it is part of.
        if (locked || releasedByHold.current) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        const pointer = event.detail > 0;
        if (pointer && releasedByHold.current) {
          releasedByHold.current = false;
          return;
        }
        releasedByHold.current = false;
        if (!locked) {
          onLock();
        } else if (!pointer) {
          onUnlock();
        }
      }}
    >
      {TOUCH_LOCK_NAME}
    </button>
  );
}
