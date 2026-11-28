// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3307 — a group ride's pull-off press and sit-in choice from the HUD, with
 * the touch lock kept whole (ADR 0101 D-3.7, #1432).
 *
 * The HUD is the real `HudPanel`, and pads come through the real
 * `gamepad-port.ts` §`navigatorGamepads` on `window` (`navigator.getGamepads()`
 * and the animation frame are stubbed, as `HudPanel.items.test.tsx` does).
 * Behind its input is a ride in miniature: a count of the presses the HUD
 * handed on and the choice it was last handed, which is all the HUD's side of
 * the seam is. What a press does to a line is `group-ride/ride-group.test.ts`'s,
 * and that `GameView` hands the HUD this input on a group ride is
 * `group-ride/group-ride-wiring.test.tsx`'s. Taps are
 * `design/touch-lock-testing.ts`'s: a jsdom `click()` is a keyboard's, which
 * the lock lets through by design.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useMemo, useState, type JSX } from 'react';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { TOUCH_LOCK_EXEMPT } from '../../design/touch-lock';
import { tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { FORWARDED_BUTTON_GLOBAL, type PadSnapshot } from '../gamepad-port';
import { atStartLine } from '../simulation';
import {
  PULL_OFF_BUTTON_LABEL,
  PULL_OFF_BY_KEY_SENTENCE,
  PULL_OFF_NOT_ON_FRONT_SENTENCE,
  SIT_IN_BUTTON_LABEL,
} from './GroupRideControls';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;
/** How many pull-off presses the HUD handed the ride. */
let pulls = 0;
/** Every sit-in choice the HUD handed the ride, in order. */
let choices: boolean[] = [];
let listed: (PadSnapshot | null)[] = [];

beforeEach(() => {
  pulls = 0;
  choices = [];
  listed = [];
  Object.defineProperty(window.navigator, 'getGamepads', {
    configurable: true,
    value: () => listed,
  });
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  localStorage.clear();
  Reflect.deleteProperty(window.navigator, 'getGamepads');
  Reflect.deleteProperty(globalThis, 'Capacitor');
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index),
    });
  }
  return routeProfile(points);
}

function GroupRide(props: { readonly onFront: boolean; readonly group?: boolean }): JSX.Element {
  const profile = useMemo(route, []);
  const [sittingIn, setSittingIn] = useState(false);
  return (
    <HudPanel
      profile={profile}
      state={atStartLine(profile)}
      cadence={{ value: 88, live: true }}
      heartRate={{ value: 150, live: true }}
      announcement=""
      paused={false}
      onPause={() => undefined}
      onEnd={() => undefined}
      {...(props.group === false
        ? {}
        : {
            groupRideInput: {
              onFront: props.onFront,
              sittingIn,
              pullOff: () => {
                pulls += 1;
              },
              sitIn: (on: boolean) => {
                choices.push(on);
                setSittingIn(on);
              },
            },
          })}
    />
  );
}

async function ride(onFront = true, group = true): Promise<void> {
  mounted = await mount(<GroupRide onFront={onFront} group={group} />);
  await settle();
}

const buttons = (): HTMLButtonElement[] =>
  queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button');

function button(name: string): HTMLButtonElement {
  const found = buttons().find(
    (each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  );
  if (found === undefined) throw new Error(`no button "${name}" on the HUD`);
  return found;
}

/** A key from a keyboard or a remote, with nothing focused: it lands on the page. */
function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

function pad(down: readonly number[] = [], stick = 0): PadSnapshot {
  return {
    connected: true,
    mapping: 'standard',
    axes: [stick, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: down.includes(index) })),
  };
}

/** A pad press: the pad listed with `down` held for `frames` frames, a connect event, then let go. */
function padPress(down: readonly number[], stick = 0, frames = 3): void {
  listed = [pad(down, stick)];
  act(() => {
    window.dispatchEvent(new Event('gamepadconnected'));
    for (let frame = 0; frame < frames; frame += 1) vi.advanceTimersToNextFrame();
  });
  listed = [pad()];
  act(() => {
    for (let frame = 0; frame < 3; frame += 1) vi.advanceTimersToNextFrame();
  });
}

describe('the pull-off press on the HUD — #3307, ADR 0101 D-3.7', () => {
  it('draws neither control on a ride that hands the HUD no group, and takes no key', async () => {
    await ride(true, false);

    expect(buttons().map((each) => each.textContent)).not.toContain(PULL_OFF_BUTTON_LABEL);
    expect(buttons().map((each) => each.textContent)).not.toContain(SIT_IN_BUTTON_LABEL);
    expect(press({ key: 'a' }).defaultPrevented).toBe(false);
    padPress([0]);
    expect(pulls).toBe(0);
  });

  it('pulls off on a tap of the button while the rider is on the front', async () => {
    await ride();

    tap(button(PULL_OFF_BUTTON_LABEL));

    expect(pulls).toBe(1);
  });

  it('pulls off on the lane key toward the pull-off side, and takes the key', async () => {
    await ride();

    const key = press({ key: 'a' });

    expect(key.defaultPrevented).toBe(true);
    expect(pulls).toBe(1);
    // The physical key too, on a layout whose A types something else.
    press({ key: 'q', code: 'KeyA' });
    expect(pulls).toBe(2);
  });

  it('asks nothing on the other lane key, and leaves it for whoever else wants it', async () => {
    await ride();

    const key = press({ key: 'd' });

    expect(key.defaultPrevented).toBe(false);
    expect(pulls).toBe(0);
  });

  it('is one pull-off for a held key: its repeats ask nothing', async () => {
    await ride();

    press({ key: 'a' });
    for (let repeat = 0; repeat < 30; repeat += 1) press({ key: 'a', repeat: true });

    expect(pulls).toBe(1);
  });

  it.each([
    ['A', 0],
    ['B', 1],
    ['X', 2],
  ])(
    'pulls off on a standard pad’s %s, every button a lap race uses its item on',
    async (_n, index) => {
      await ride();

      padPress([index]);

      expect(pulls).toBe(1);
    },
  );

  it('pulls off on a pad’s lane change to the left, by the d-pad and by the stick, and not to the right', async () => {
    await ride();

    // A standard pad's d-pad left is button 14, and right is 15.
    padPress([14]);
    expect(pulls).toBe(1);
    padPress([], -1);
    expect(pulls).toBe(2);
    padPress([15]);
    padPress([], 1);
    expect(pulls).toBe(2);
  });

  it('is one pull-off for a pad button held for a second of frames', async () => {
    await ride();

    padPress([0], 0, 60);

    expect(pulls).toBe(1);
  });

  it.each([2, 3, 4])('pulls off on the shell’s forwarded button %i', async (number) => {
    Object.defineProperty(globalThis, 'Capacitor', {
      configurable: true,
      value: { isNativePlatform: () => true, getPlatform: () => 'android' },
    });
    await ride();
    listed = [{ connected: true, mapping: '', axes: [0, 0, 0, 0], buttons: [] }];
    act(() => {
      window.dispatchEvent(new Event('gamepadconnected'));
      for (let frame = 0; frame < 3; frame += 1) vi.advanceTimersToNextFrame();
      const handler = Reflect.get(window, FORWARDED_BUTTON_GLOBAL) as (
        b: number,
        p: boolean,
      ) => void;
      handler(number, true);
      for (let frame = 0; frame < 3; frame += 1) vi.advanceTimersToNextFrame();
      handler(number, false);
      for (let frame = 0; frame < 3; frame += 1) vi.advanceTimersToNextFrame();
    });

    expect(pulls).toBe(1);
  });

  it('refuses a press of the button off the front, and says why off the screen', async () => {
    await ride(false);

    const pullOff = button(PULL_OFF_BUTTON_LABEL);
    expect(pullOff.getAttribute('aria-disabled')).toBe('true');
    expect(pullOff.hasAttribute('disabled')).toBe(false);
    tap(pullOff);
    await activateWithKeyboard(pullOff);
    expect(pulls).toBe(0);
    const why = document.getElementById(pullOff.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toBe(PULL_OFF_NOT_ON_FRONT_SENTENCE);
  });

  it('is available on the front: not disabled, and described by nothing', async () => {
    await ride();

    const pullOff = button(PULL_OFF_BUTTON_LABEL);
    expect(pullOff.hasAttribute('aria-disabled')).toBe(false);
    expect(pullOff.hasAttribute('aria-describedby')).toBe(false);
    await activateWithKeyboard(pullOff);
    expect(pulls).toBe(1);
  });
});

describe('the sit-in choice on the HUD — #3307', () => {
  it('is a toggle the rider turns on and off again, saying which it is', async () => {
    await ride(false);

    expect(button(SIT_IN_BUTTON_LABEL).getAttribute('aria-pressed')).toBe('false');
    tap(button(SIT_IN_BUTTON_LABEL));
    await settle();
    expect(choices).toStrictEqual([true]);
    expect(button(SIT_IN_BUTTON_LABEL).getAttribute('aria-pressed')).toBe('true');

    await activateWithKeyboard(button(SIT_IN_BUTTON_LABEL));
    expect(choices).toStrictEqual([true, false]);
    expect(button(SIT_IN_BUTTON_LABEL).getAttribute('aria-pressed')).toBe('false');
    // A choice, never a pull-off.
    expect(pulls).toBe(0);
  });
});

describe('the touch lock kept whole in a group ride — #1432', () => {
  it('refuses a tap on either control while the lock is on, and says how to pull off instead', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));
    expect(button(TOUCH_LOCK_NAME).getAttribute('aria-pressed')).toBe('true');

    tap(button(PULL_OFF_BUTTON_LABEL));
    tap(button(SIT_IN_BUTTON_LABEL));

    expect(pulls).toBe(0);
    expect(choices).toStrictEqual([]);
    const note = document.getElementById(
      button(PULL_OFF_BUTTON_LABEL).getAttribute('aria-describedby') ?? '',
    );
    expect(note?.textContent).toBe(PULL_OFF_BY_KEY_SENTENCE);
    // Plain text, never a second live region beside the announcer's (#445).
    expect(note?.closest('[aria-live]')).toBeNull();
  });

  it('pulls off on the key and on a pad while the lock is on', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));

    press({ key: 'a' });
    padPress([0]);

    expect(pulls).toBe(2);
  });

  it('exempts neither control from the lock', async () => {
    await ride();

    for (const name of [PULL_OFF_BUTTON_LABEL, SIT_IN_BUTTON_LABEL]) {
      expect(button(name).hasAttribute(TOUCH_LOCK_EXEMPT)).toBe(false);
      expect(button(name).closest(`[${TOUCH_LOCK_EXEMPT}]`)).toBeNull();
    }
  });
});
