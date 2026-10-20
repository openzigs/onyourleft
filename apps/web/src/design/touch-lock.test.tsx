// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The touch lock's two halves — #1432: the filter a locked region runs
 * (`touch-lock.ts`) and the control whose release is a held press
 * (`TouchLockButton.tsx`). The screens that use them are held by
 * `views/RideView.touch-lock.test.tsx` and `game/touch-lock-hud.test.tsx`.
 */

import { act, useRef, useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateWithKeyboard, mount, type Mounted } from '../testing/mount';
import { Button } from './Button';
import { TOUCH_LOCK_HOLD_MILLISECONDS, useTouchLock } from './touch-lock';
import { fingerDown, fingerUp, hold, tap } from './touch-lock-testing';
import { TouchLockButton } from './TouchLockButton';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
});

interface Pressed {
  pause: number;
  release: number;
  locks: number;
  unlocks: number;
}

/** A screen with a lockable region: a control, a released one, a field, and the lock. */
function Screen({ pressed, startLocked }: { pressed: Pressed; startLocked: boolean }): JSX.Element {
  const region = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(startLocked);
  useTouchLock(region, locked);
  return (
    <div ref={region}>
      <Button
        onClick={() => {
          pressed.pause += 1;
        }}
      >
        Pause
      </Button>
      <Button
        touchLockExempt
        onClick={() => {
          pressed.release += 1;
        }}
      >
        End ERG
      </Button>
      <input aria-label="Target" />
      <TouchLockButton
        locked={locked}
        onLock={() => {
          pressed.locks += 1;
          setLocked(true);
        }}
        onUnlock={() => {
          pressed.unlocks += 1;
          setLocked(false);
        }}
      />
    </div>
  );
}

async function show(startLocked: boolean): Promise<Pressed> {
  const pressed: Pressed = { pause: 0, release: 0, locks: 0, unlocks: 0 };
  mounted = await mount(<Screen pressed={pressed} startLocked={startLocked} />);
  return pressed;
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((each) => each.textContent === name);
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}

const lock = (): HTMLButtonElement => button('Touch lock');
const field = (): HTMLInputElement => {
  const found = document.querySelector('input');
  if (found === null) throw new Error('no field');
  return found;
};

function touchStartRefused(element: Element): boolean {
  let refused = false;
  act(() => {
    refused = !element.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
  });
  return refused;
}

describe('a locked region — #1432', () => {
  it('ignores a tap on a control', async () => {
    const pressed = await show(true);
    tap(button('Pause'));
    expect(pressed.pause).toBe(0);
  });

  it('lets the same tap through while unlocked — the control for the case above', async () => {
    const pressed = await show(false);
    tap(button('Pause'));
    expect(pressed.pause).toBe(1);
  });

  it('lets a keyboard or screen-reader activation through', async () => {
    const pressed = await show(true);
    await activateWithKeyboard(button('Pause'));
    expect(pressed.pause).toBe(1);
  });

  it('never stops a control marked as the trainer’s release', async () => {
    const pressed = await show(true);
    tap(button('End ERG'));
    expect(pressed.release).toBe(1);
  });

  it('refuses the mousedown, so a drop moves no focus, but not on the released control', async () => {
    await show(true);
    expect(fingerDown(button('Pause'))).toBe(true);
    expect(fingerDown(button('End ERG'))).toBe(false);
  });

  it('refuses a touch on a field and nowhere else, so the screen still scrolls', async () => {
    await show(true);
    expect(touchStartRefused(field())).toBe(true);
    expect(touchStartRefused(button('Pause'))).toBe(false);
  });

  it('refuses nothing once it is unlocked again', async () => {
    const pressed = await show(true);
    await activateWithKeyboard(lock());
    expect(pressed.unlocks).toBe(1);
    expect(touchStartRefused(field())).toBe(false);
    expect(fingerDown(button('Pause'))).toBe(false);
    tap(button('Pause'));
    expect(pressed.pause).toBe(1);
  });
});

describe('the touch lock’s control — #1432', () => {
  it('is a toggle that says which way it stands', async () => {
    await show(false);
    expect(lock().getAttribute('aria-pressed')).toBe('false');
    tap(lock());
    expect(lock().getAttribute('aria-pressed')).toBe('true');
  });

  it('turns on with one tap', async () => {
    const pressed = await show(false);
    tap(lock());
    expect(pressed.locks).toBe(1);
  });

  it('does not turn off with a tap', async () => {
    const pressed = await show(true);
    tap(lock());
    tap(lock());
    expect(pressed.unlocks).toBe(0);
    expect(lock().getAttribute('aria-pressed')).toBe('true');
  });

  it('turns off with a press held for the hold time, and the lifted finger does not lock it again', async () => {
    const pressed = await show(true);
    vi.useFakeTimers();
    hold(lock(), (ms) => vi.advanceTimersByTime(ms));
    expect(pressed.unlocks).toBe(1);
    expect(pressed.locks).toBe(0);
    expect(lock().getAttribute('aria-pressed')).toBe('false');
  });

  it('stays on when the press is lifted before the hold time', async () => {
    const pressed = await show(true);
    vi.useFakeTimers();
    hold(lock(), (ms) => vi.advanceTimersByTime(ms), TOUCH_LOCK_HOLD_MILLISECONDS - 100);
    act(() => {
      vi.advanceTimersByTime(TOUCH_LOCK_HOLD_MILLISECONDS);
    });
    expect(pressed.unlocks).toBe(0);
  });

  it.each(['pointercancel', 'pointerleave'])(
    'stays on when the hold ends in a %s, as a drop running off the control does',
    async (ending) => {
      const pressed = await show(true);
      vi.useFakeTimers();
      fingerDown(lock());
      act(() => {
        vi.advanceTimersByTime(TOUCH_LOCK_HOLD_MILLISECONDS / 2);
        // React hears a leave from `pointerout` with somewhere else to go.
        lock().dispatchEvent(
          ending === 'pointercancel'
            ? new PointerEvent('pointercancel', { bubbles: true })
            : new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
        );
        vi.advanceTimersByTime(TOUCH_LOCK_HOLD_MILLISECONDS);
      });
      expect(pressed.unlocks).toBe(0);
    },
  );

  it('turns off at once from the keyboard or a screen reader', async () => {
    const pressed = await show(true);
    await activateWithKeyboard(lock());
    expect(pressed.unlocks).toBe(1);
    expect(lock().getAttribute('aria-pressed')).toBe('false');
  });

  it('does not start a hold while it is off', async () => {
    const pressed = await show(false);
    vi.useFakeTimers();
    fingerDown(lock());
    act(() => {
      vi.advanceTimersByTime(TOUCH_LOCK_HOLD_MILLISECONDS * 2);
    });
    expect(pressed.unlocks).toBe(0);
    fingerUp(lock());
    expect(pressed.locks).toBe(1);
  });

  it('refuses the long press’s context menu while it is on', async () => {
    await show(true);
    let refused = false;
    act(() => {
      refused = !lock().dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
    });
    expect(refused).toBe(true);
  });
});
