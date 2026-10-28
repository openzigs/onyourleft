// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1810 — throwing a parcel from the HUD, with the #1432 touch lock kept
 * whole (ADR 0059 D-5).
 *
 * The HUD is the real `HudPanel`, with its own touch lock. Behind its port
 * is a ride in miniature, the shape #1816 gives `GameView`: each intent is
 * resolved by `throw.ts` §`throwSideFor` and stepped through the real
 * `throw.ts` §`stepThrows`, and the HUD is rendered from the round that step
 * returns. So "a parcel was thrown" is read where the round reads it — a
 * parcel in flight on the throw state — never off a counter the test keeps.
 * Taps are `design/touch-lock-testing.ts`'s; a jsdom `click()` is a key's.
 */

import { afterEach, describe, expect, it } from 'vitest';
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
import { activateWithKeyboard, mount, queryAll, type Mounted } from '../../testing/mount';
import { startRound, type Round } from '../delivery/round';
import {
  NO_PARCELS,
  stepThrows,
  THROW_COOLDOWN_TICKS,
  type ParcelInFlight,
  type ThrowState,
  throwSideFor,
  type ThrowTarget,
} from '../delivery/throw';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';
import { THROW_BY_KEY_SENTENCE, THROW_CONTROL_NAME } from './ThrowControl';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
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

/** The next house is on the RIGHT, so a throw toward it is told from a left one. */
const TARGETS: readonly ThrowTarget[] = [
  { position: 0, along: 40, side: 'right', clear: 2 },
  { position: 1, along: 90, side: 'left', clear: 2 },
];

interface Ride {
  readonly throws: ThrowState;
  readonly round: Round;
  /** Every parcel the round has taken, in the order it took them. */
  readonly taken: readonly ParcelInFlight[];
}

/** What the ride last rendered the HUD from. */
let seen: Ride | undefined;
let pauses = 0;

function RideWithDelivery(props: { readonly delivery?: boolean }): JSX.Element {
  const profile = useMemo(route, []);
  const [ride, setRide] = useState<Ride>({ throws: NO_PARCELS, round: startRound(2), taken: [] });
  seen = ride;
  const port = useMemo<ThrowInputPort>(
    () => ({
      throwParcel: (intent) => {
        setRide((now) => {
          const side = throwSideFor(intent, { targets: TARGETS, round: now.round, along: 10 });
          const step = stepThrows(now.throws, {
            rider: { along: 10, speed: 8 },
            targets: TARGETS,
            round: now.round,
            ...(side === undefined ? {} : { throwTo: side }),
            // The cool-down's ticks, so the next press in a test is not refused by it.
            ticks: THROW_COOLDOWN_TICKS,
          });
          const launched = step.thrown ? step.state.inFlight.slice(-1) : [];
          return { throws: step.state, round: step.round, taken: [...now.taken, ...launched] };
        });
      },
    }),
    [],
  );
  return (
    <HudPanel
      profile={profile}
      state={atStartLine(profile)}
      cadence={{ value: 88, live: true }}
      heartRate={{ value: 150, live: true }}
      announcement=""
      paused={false}
      onPause={() => {
        pauses += 1;
      }}
      onEnd={() => undefined}
      throwing={props.delivery === false ? undefined : port}
    />
  );
}

async function ride(delivery = true): Promise<void> {
  seen = undefined;
  pauses = 0;
  mounted = await mount(<RideWithDelivery delivery={delivery} />);
}

/** The sides of every parcel thrown, read off the throw state the HUD is rendered from. */
const thrown = (): string[] => (seen?.taken ?? []).map((parcel) => parcel.side);

function button(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  );
  if (found === undefined) {
    throw new Error(`no button "${name}" on the HUD`);
  }
  return found;
}

const throwButtons = (): HTMLButtonElement[] =>
  queryAll<HTMLButtonElement>(
    mounted?.container ?? document,
    `[role="group"][aria-label="${THROW_CONTROL_NAME}"] button`,
  );

/**
 * A key on a focused control, as a browser handles it: Enter or Space presses
 * a focused button (a click with `detail` 0) unless a handler took the key.
 * jsdom does neither the press nor the focus a tap leaves behind in Chromium
 * (the Android WebView included), so both are done here.
 */
function keyOn(control: HTMLElement, key: string): KeyboardEvent {
  control.focus();
  const event = press(key, control);
  if (!event.defaultPrevented && (key === 'Enter' || key === ' ')) {
    act(() => {
      control.click();
    });
  }
  return event;
}

/** A key from a keyboard or a remote, with nothing focused: it lands on the page. */
function press(key: string, on: Element = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    on.dispatchEvent(event);
  });
  return event;
}

describe('throwing from the HUD with the touch lock off — #1810', () => {
  it('throws with a tap on each throw button: left, toward the next house, and right', async () => {
    await ride();

    tap(button('Left'));
    tap(button('Next house'));
    tap(button('Right'));

    expect(thrown()).toEqual(['left', 'right', 'right']);
  });

  it('throws with a key, and takes the key from the page so it does not scroll it', async () => {
    await ride();

    const left = press('ArrowLeft');
    press('ArrowUp');
    press('PageDown');

    expect(thrown()).toEqual(['left', 'right', 'right']);
    expect(left.defaultPrevented).toBe(true);
    // A key no throw is bound to is left to the page.
    expect(press('Escape').defaultPrevented).toBe(false);
  });

  it('says nothing about keys while the lock is off', async () => {
    await ride();
    expect(document.body.textContent).not.toContain(THROW_BY_KEY_SENTENCE);
  });
});

describe('throwing from the HUD with the touch lock on — #1810, ADR 0059 D-5', () => {
  it('refuses a tap on every throw button: no parcel is thrown', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));
    expect(button(TOUCH_LOCK_NAME).getAttribute('aria-pressed')).toBe('true');

    for (const each of throwButtons()) {
      tap(each);
    }

    expect(throwButtons()).toHaveLength(3);
    expect(thrown()).toEqual([]);
    expect(seen?.throws.inFlight).toEqual([]);
  });

  it('throws by key: the same HUD, locked, takes the throw key', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));
    tap(button('Left'));

    press('ArrowLeft');
    press('ArrowUp');

    expect(thrown()).toEqual(['left', 'right']);
  });

  it('says in words, beside the buttons, that throws come by key or remote', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));

    const note = [...document.querySelectorAll('p')].find(
      (each) => each.textContent === THROW_BY_KEY_SENTENCE,
    );
    expect(note).toBeDefined();
    expect(note?.closest('.oyl-hud__throws')).not.toBeNull();
    // Plain text: the HUD's one live region is the announcer's (#445).
    expect(note?.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    for (const each of throwButtons()) {
      expect(each.getAttribute('aria-describedby')).toBe(note?.id);
    }
  });

  it('lets a key press a focused throw button, which throws its own way', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));

    await activateWithKeyboard(button('Left'));

    // The button's own throw, and not also Enter's toward the next house.
    expect(thrown()).toEqual(['left']);
  });
});

describe('the throw control is not exempt from the lock — ADR 0059 D-5', () => {
  it('carries no TOUCH_LOCK_EXEMPT mark, on any button or anything around it', async () => {
    await ride();
    const group = document.querySelector(`[aria-label="${THROW_CONTROL_NAME}"]`);
    expect(group?.closest('.oyl-hud')).not.toBeNull();
    expect(group?.closest(`[${TOUCH_LOCK_EXEMPT}]`)).toBeNull();
    for (const each of throwButtons()) {
      expect(each.hasAttribute(TOUCH_LOCK_EXEMPT)).toBe(false);
      expect(each.querySelector(`[${TOUCH_LOCK_EXEMPT}]`)).toBeNull();
    }
  });
});

describe('a focused control keeps its key — #1810', () => {
  it('Enter on a focused Pause pauses and throws nothing', async () => {
    await ride();

    await activateWithKeyboard(button('Pause'));

    expect(pauses).toBe(1);
    expect(thrown()).toEqual([]);
  });

  it('Space on a focused Pause throws nothing either, locked or not', async () => {
    await ride();
    const pause = button('Pause');
    pause.focus();

    const space = press(' ', pause);
    tap(button(TOUCH_LOCK_NAME));
    pause.focus();
    press(' ', pause);

    expect(thrown()).toEqual([]);
    expect(space.defaultPrevented).toBe(false);
  });
});

describe('a remote after a tap left a HUD button focused — owner ruling 2026-10-28', () => {
  const locked = (): string | null => button(TOUCH_LOCK_NAME).getAttribute('aria-pressed');

  it('Enter or Space on a focused Lock throws nothing, and does what it always does', async () => {
    for (const key of ['Enter', ' ']) {
      await ride();
      tap(button(TOUCH_LOCK_NAME));
      expect(locked()).toBe('true');

      // Enter or Space turns the lock off at once (`TouchLockButton`): Delivery changes nothing.
      const event = keyOn(button(TOUCH_LOCK_NAME), key);

      expect(event.defaultPrevented, JSON.stringify(key)).toBe(false);
      expect(locked(), JSON.stringify(key)).toBe('false');
      expect(thrown(), JSON.stringify(key)).toEqual([]);
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('Enter or Space on a focused Pause throws nothing, and pauses as it always does', async () => {
    await ride();
    tap(button('Pause'));
    expect(pauses).toBe(1);

    keyOn(button('Pause'), 'Enter');
    keyOn(button('Pause'), ' ');

    expect(pauses).toBe(3);
    expect(thrown()).toEqual([]);
  });

  it('ArrowUp on a focused Lock throws toward the next house and leaves the lock on', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));

    const event = keyOn(button(TOUCH_LOCK_NAME), 'ArrowUp');

    expect(thrown()).toEqual(['right']);
    expect(event.defaultPrevented).toBe(true);
    expect(locked()).toBe('true');
  });

  it('ArrowUp on a focused Pause throws and does not pause', async () => {
    await ride();
    tap(button('Pause'));

    keyOn(button('Pause'), 'ArrowUp');

    expect(thrown()).toEqual(['right']);
    expect(pauses).toBe(1);
  });
});

describe('a ride with no Delivery round — #1810', () => {
  it('has no throw control, and a throw key does nothing', async () => {
    await ride(false);

    expect(throwButtons()).toEqual([]);
    expect(press('ArrowLeft').defaultPrevented).toBe(false);
    expect(thrown()).toEqual([]);
  });

  it('stops listening for keys when the HUD is gone', async () => {
    await ride();
    mounted?.unmount();
    mounted = undefined;

    expect(press('ArrowLeft').defaultPrevented).toBe(false);
    expect(thrown()).toEqual([]);
  });
});
