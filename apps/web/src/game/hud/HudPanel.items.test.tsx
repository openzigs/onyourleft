// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1901 — a lap race's lanes and item use from the HUD, with the touch lock
 * kept whole (ADR 0060 D-13, #1432).
 *
 * The HUD is the real `HudPanel`, and pads come through the real
 * `gamepad-port.ts` §`navigatorGamepads` on `window` (`navigator.getGamepads()`
 * and the animation frame are stubbed, as `HudPanel.gamepad.test.tsx` does).
 * Behind its two ports is a lap race in miniature, the shape #1906 gives
 * `GameView`: each lane change and each use goes through `race-input.ts` into
 * the rider's race inputs, and "the rider used the item" is read off the
 * race — the held item `@onyourleft/domain` §`stepRace` leaves after the
 * next tick — never off a counter of calls. Taps are
 * `design/touch-lock-testing.ts`'s: a jsdom `click()` is a keyboard's, which
 * the lock lets through by design.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useMemo, type JSX } from 'react';

import {
  altitudeMetres,
  createItemRace,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  raceCourse,
  routeProfile,
  stepRace,
  type ItemKind,
  type RoutePoint,
} from '@onyourleft/domain';

import { TOUCH_LOCK_EXEMPT } from '../../design/touch-lock';
import { tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../../testing/mount';
import type { PadSnapshot } from '../gamepad-port';
import type { ItemInputPort } from '../lap-race/item-input-port';
import {
  askLane,
  askToUseItem,
  riderTick,
  startRiderInput,
  type RiderRaceInput,
} from '../lap-race/race-input';
import { atStartLine } from '../simulation';
import type { SteerInputPort } from '../steer-port';
import { HudPanel } from './HudPanel';
import { ITEM_BUTTON_LABEL, ITEM_BY_KEY_SENTENCE } from './ItemControl';

const RIDER = 'rider';

let mounted: Mounted | undefined;
/** The rider's race inputs, as the race's ports last left them. */
let inputs: RiderRaceInput = startRiderInput(0);
let listed: (PadSnapshot | null)[] = [];

beforeEach(() => {
  inputs = startRiderInput(0);
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
  Reflect.deleteProperty(window.navigator, 'getGamepads');
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

function RideWithRace(): JSX.Element {
  const profile = useMemo(route, []);
  const steering = useMemo<SteerInputPort>(
    () => ({
      steer: (intent) => {
        inputs = askLane(inputs, intent);
      },
    }),
    [],
  );
  const items = useMemo<ItemInputPort>(
    () => ({
      useItem: () => {
        inputs = askToUseItem(inputs);
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
      onPause={() => undefined}
      onEnd={() => undefined}
      steering={steering}
      items={items}
    />
  );
}

async function ride(): Promise<void> {
  mounted = await mount(<RideWithRace />);
  await settle();
}

/**
 * The race's next tick, with the rider holding a tailwind: what they hold
 * after it, read off the race, and the lane the race put them in. The tick
 * takes the inputs' use, as a race's does.
 */
function nextTick(): { readonly held: ItemKind | null; readonly lane: number } {
  const started = createItemRace({
    course: raceCourse(1_000, 3),
    seed: 1,
    itemsOn: true,
    racerIds: [RIDER],
    startMs: 0,
  });
  const holding = {
    ...started,
    racers: started.racers.map((each) => ({ ...each, held: 'tailwind' as const })),
  };
  const tick = riderTick(inputs, RIDER);
  inputs = tick.next;
  const after = stepRace(holding, {
    atMs: 100,
    effortDistances: { [RIDER]: 1 },
    lanes: tick.lanes,
    uses: tick.uses,
  });
  const entry = after.racers[0];
  return { held: entry?.held ?? null, lane: entry?.lane ?? -1 };
}

function button(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  );
  if (found === undefined) throw new Error(`no button "${name}" on the HUD`);
  return found;
}

/** A key from a keyboard or a remote, with nothing focused: it lands on the page. */
function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
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

/** A pad press: the pad listed with `down` held, a connect event, and a few frames. */
function padPress(down: readonly number[], stick = 0): void {
  listed = [pad(down, stick)];
  act(() => {
    window.dispatchEvent(new Event('gamepadconnected'));
    for (let frame = 0; frame < 3; frame += 1) vi.advanceTimersToNextFrame();
  });
  listed = [pad()];
  act(() => {
    for (let frame = 0; frame < 3; frame += 1) vi.advanceTimersToNextFrame();
  });
}

describe('the touch lock kept whole in a lap race — ADR 0060 D-13, #1432', () => {
  it('uses the item on a tap while the lock is off — the control for the case below', async () => {
    await ride();

    tap(button(ITEM_BUTTON_LABEL));

    expect(nextTick().held).toBeNull();
  });

  it('refuses a tap on the item control while the lock is on, and says how items come instead', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));
    expect(button(TOUCH_LOCK_NAME).getAttribute('aria-pressed')).toBe('true');

    tap(button(ITEM_BUTTON_LABEL));

    expect(nextTick().held).toBe('tailwind');
    expect(mounted?.container.textContent).toContain(ITEM_BY_KEY_SENTENCE);
    const note = document.getElementById(
      button(ITEM_BUTTON_LABEL).getAttribute('aria-describedby') ?? '',
    );
    expect(note?.textContent).toBe(ITEM_BY_KEY_SENTENCE);
    // Plain text, never a second live region beside the announcer's (#445).
    expect(note?.closest('[aria-live]')).toBeNull();
  });

  it('uses the item on its key while the lock is on, and takes the key', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));

    const key = press('w');

    expect(key.defaultPrevented).toBe(true);
    expect(nextTick().held).toBeNull();
  });

  it('uses the item on a gamepad’s button while the lock is on', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));

    // A standard pad's A, the button that throws toward the next house on a round.
    padPress([0]);

    expect(nextTick().held).toBeNull();
  });

  it('uses the item from the keyboard on the focused button, lock on or off (SC 2.1.1)', async () => {
    await ride();
    await activateWithKeyboard(button(ITEM_BUTTON_LABEL));
    expect(nextTick().held).toBeNull();

    tap(button(TOUCH_LOCK_NAME));
    await activateWithKeyboard(button(ITEM_BUTTON_LABEL));
    expect(nextTick().held).toBeNull();
  });

  it('exempts no item or lane control from the lock: End ride is the only exempt control', async () => {
    await ride();
    const item = button(ITEM_BUTTON_LABEL);
    expect(item.hasAttribute(TOUCH_LOCK_EXEMPT)).toBe(false);
    expect(item.closest(`[${TOUCH_LOCK_EXEMPT}]`)).toBeNull();
    expect(item.hasAttribute('disabled')).toBe(false);
    const exempt = queryAll<HTMLElement>(mounted?.container ?? document, `[${TOUCH_LOCK_EXEMPT}]`);
    expect(exempt.map((each) => each.textContent)).toEqual(['End ride']);
    // Inside the region the lock covers.
    expect(item.closest('section.oyl-hud')).not.toBeNull();
  });
});

describe('lanes in a lap race, from the keys and a pad Delivery steers with — #1901', () => {
  it('changes lane on D and A, read off the race, while the lock is on', async () => {
    await ride();
    tap(button(TOUCH_LOCK_NAME));

    press('d');
    expect(nextTick().lane).toBe(2);
    press('a');
    press('a');
    expect(nextTick().lane).toBe(0);
  });

  it('changes lane on a pad’s d-pad and stick, and a lane press never uses the item', async () => {
    await ride();

    padPress([15]);
    expect(nextTick()).toEqual({ held: 'tailwind', lane: 2 });
    padPress([], -0.9);
    expect(nextTick()).toEqual({ held: 'tailwind', lane: 1 });
  });

  it('never uses the item on a lane key, nor changes lane on the item key', async () => {
    await ride();

    press('d');
    expect(nextTick()).toEqual({ held: 'tailwind', lane: 2 });
    press('w');
    expect(nextTick()).toEqual({ held: null, lane: 2 });
  });
});
