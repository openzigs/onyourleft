// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A finger on a control, as the touch lock (#1432) tells one from a key. Test
 * support, never shipped.
 *
 * jsdom's `element.click()` is a click with `detail` 0 — what Enter, Space or
 * a screen reader gives in a browser — so every test that presses a control
 * that way presses it as a keyboard does. These dispatch what a TAP is: the
 * pointer's down and up, the compatibility mouse events, and a click whose
 * `detail` is 1.
 */

import { act } from 'react';

import { TOUCH_LOCK_HOLD_MILLISECONDS } from './touch-lock';

function pointer(type: string): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
    button: 0,
    detail: type === 'click' ? 1 : 0,
  });
}

/** A finger comes down on `element`. Answers whether anything refused the mousedown. */
export function fingerDown(element: Element): boolean {
  let refused = false;
  act(() => {
    element.dispatchEvent(pointer('pointerdown'));
    refused = !element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
  return refused;
}

/** The finger lifts off `element`, and the tap's click lands on it. */
export function fingerUp(element: Element): void {
  act(() => {
    element.dispatchEvent(pointer('pointerup'));
    element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, cancelable: true, detail: 1 }),
    );
    element.dispatchEvent(pointer('click'));
  });
}

/** A tap: down and straight up again. */
export function tap(element: Element): void {
  fingerDown(element);
  fingerUp(element);
}

/**
 * A press held for `milliseconds` before the finger lifts — under fake timers,
 * which the caller has installed.
 */
export function hold(
  element: Element,
  advance: (milliseconds: number) => void,
  milliseconds: number = TOUCH_LOCK_HOLD_MILLISECONDS,
): void {
  fingerDown(element);
  act(() => {
    advance(milliseconds);
  });
  fingerUp(element);
}
