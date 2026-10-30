// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1821 — a gamepad on the HUD, through the platform's own Gamepad API path.
 *
 * The HUD is the real `HudPanel`, and the pads come through the real
 * `gamepad-port.ts` §`navigatorGamepads` on `window`: what is stubbed is
 * `navigator.getGamepads()` and the animation frame, which jsdom has no
 * pads for and no display to pace. Behind the HUD's ports is a ride in
 * miniature, as `HudPanel.steer.test.tsx`'s: a lane change is read off the
 * round's steer state, and a throw off what the throw port was handed.
 *
 * #1858 — in the Android shell (a `Capacitor` global that says it is native),
 * a generic pad's d-pad steers and the numbered buttons `MainActivity`
 * forwards throw, called on `window` as the Java calls them.
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

import { mount, type Mounted } from '../../testing/mount';
import { startSteer, steerToward, type SteerState } from '../delivery/steer';
import type { SteerInputPort } from '../delivery/steer-port';
import type { ThrowIntent } from '../delivery/throw-input';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { FORWARDED_BUTTON_GLOBAL, type PadSnapshot } from '../gamepad-port';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;
/** What `navigator.getGamepads()` lists now, and how often it was asked. */
let listed: (PadSnapshot | null)[] = [];
let asked = 0;

beforeEach(() => {
  listed = [];
  asked = 0;
  Object.defineProperty(window.navigator, 'getGamepads', {
    configurable: true,
    value: () => {
      asked += 1;
      return listed;
    },
  });
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
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

let steered: SteerState | undefined;
let thrown: ThrowIntent[] = [];

function RideWithDelivery(props: { readonly delivery: boolean }): JSX.Element {
  const profile = useMemo(route, []);
  const [steer, setSteer] = useState<SteerState>(() => startSteer(0));
  steered = steer;
  const steering = useMemo<SteerInputPort>(
    () => ({ steer: (intent) => setSteer((now) => steerToward(now, intent)) }),
    [],
  );
  const throwing = useMemo<ThrowInputPort>(
    () => ({
      throwParcel: (intent) => {
        thrown = [...thrown, intent];
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
      throwing={props.delivery ? throwing : undefined}
      steering={props.delivery ? steering : undefined}
    />
  );
}

async function ride(delivery = true): Promise<void> {
  steered = undefined;
  thrown = [];
  mounted = await mount(<RideWithDelivery delivery={delivery} />);
}

function pad(down: readonly number[] = [], stick = 0): PadSnapshot {
  return {
    connected: true,
    mapping: 'standard',
    axes: [stick, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: down.includes(index) })),
  };
}

/** Run `count` animation frames. */
function frames(count: number): void {
  act(() => {
    for (let frame = 0; frame < count; frame += 1) vi.advanceTimersToNextFrame();
  });
}

function event(type: 'gamepadconnected' | 'gamepaddisconnected'): void {
  act(() => {
    window.dispatchEvent(new Event(type));
  });
}

describe('a gamepad on a Delivery ride — #1821', () => {
  it('throws and changes lane from a pad, once a press, through the HUD’s ports', async () => {
    await ride();
    // No pad yet: one poll at mount, and none after it.
    frames(5);
    expect(asked).toBe(1);
    // A pad the page can see is polled from its connect event on.
    listed = [pad([2])];
    frames(5);
    expect(thrown).toEqual([]);
    event('gamepadconnected');
    frames(10);
    expect(thrown).toEqual(['left']);

    listed = [pad([], 0.9)];
    frames(10);
    listed = [pad([15])];
    frames(3);
    expect(steered?.lane).toBe(2);
    expect(thrown).toEqual(['left']);

    listed = [pad([0, 14])];
    frames(5);
    expect(thrown).toEqual(['left', 'next-house']);
    expect(steered?.lane).toBe(1);
  });

  it('reads a pad already listed when the round starts, with no connect event', async () => {
    listed = [pad([1])];
    await ride();
    frames(2);
    expect(thrown).toEqual(['right']);
  });

  it('stops on a disconnect mid-round, and the round goes on: its keys still steer', async () => {
    await ride();
    listed = [pad([], 0.9)];
    event('gamepadconnected');
    frames(3);
    expect(steered?.lane).toBe(2);

    listed = [null];
    event('gamepaddisconnected');
    frames(3);
    const after = asked;
    frames(20);
    // No pad, so no poll a frame.
    expect(asked).toBe(after);

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }),
      );
    });
    expect(steered?.lane).toBe(1);
    expect(thrown).toEqual([]);
  });

  it('throws once for a held button while the ride re-renders with a new inline throw port', async () => {
    const profile = route();
    const state = atStartLine(profile);
    const took: string[] = [];
    // A new port on every render, as a ride that writes it inline does; each
    // throw is tagged with the render whose port took it.
    const panel = (render: number): JSX.Element => (
      <HudPanel
        profile={profile}
        state={state}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        announcement=""
        paused={false}
        onPause={() => undefined}
        onEnd={() => undefined}
        throwing={{
          throwParcel: (intent) => {
            took.push(`${intent}@${String(render)}`);
          },
        }}
      />
    );
    listed = [pad([0])];
    mounted = await mount(panel(0));
    frames(3);
    for (let render = 1; render <= 5; render += 1) {
      await mounted.rerender(panel(render));
      frames(3);
    }
    expect(took).toEqual(['next-house@0']);
    // Let go and press again: the throw reaches the port of the latest render.
    listed = [pad()];
    frames(2);
    listed = [pad([0])];
    frames(2);
    expect(took).toEqual(['next-house@0', 'next-house@5']);
  });

  it('cancels its scheduled frame on unmount, and hands no port an intent after it', async () => {
    listed = [pad()];
    await ride();
    frames(2);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    mounted?.unmount();
    mounted = undefined;
    expect(cancel).toHaveBeenCalledTimes(1);
    const after = asked;
    listed = [pad([0], -0.9)];
    frames(10);
    event('gamepadconnected');
    frames(10);
    expect(asked).toBe(after);
    expect(thrown).toEqual([]);
    expect(steered?.lane).toBe(1);
  });

  it('polls no pad at all on a ride with no round', async () => {
    listed = [pad([0])];
    await ride(false);
    event('gamepadconnected');
    frames(5);
    expect(asked).toBe(0);
    expect(thrown).toEqual([]);
  });
});

/** A pad the browser does not map, as spike 0027's generic USB pad: its d-pad on axis 0. */
function generic(dpadX: number): PadSnapshot {
  return {
    connected: true,
    mapping: '',
    axes: [dpadX, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  };
}

/** What `MainActivity.java` calls for one numbered button. */
function forward(button: number, pressed: boolean): void {
  act(() => {
    const page = window as unknown as Record<string, unknown>;
    const handler = page[FORWARDED_BUTTON_GLOBAL];
    expect(handler).toBeTypeOf('function');
    (handler as (button: unknown, pressed: unknown) => void)(button, pressed);
  });
}

function inTheShell(): void {
  Object.defineProperty(globalThis, 'Capacitor', {
    configurable: true,
    value: { isNativePlatform: () => true },
  });
}

describe('a generic pad on a Delivery ride in the Android shell — #1858', () => {
  it('steers from its d-pad and throws from the forwarded buttons, once a press', async () => {
    inTheShell();
    await ride();
    listed = [generic(1)];
    event('gamepadconnected');
    frames(5);
    expect(steered?.lane).toBe(2);

    listed = [generic(0)];
    frames(2);
    forward(4, true);
    frames(10);
    forward(4, false);
    frames(2);
    expect(thrown).toEqual(['left']);

    // A tap shorter than a frame still throws, once.
    forward(2, true);
    forward(2, false);
    frames(5);
    forward(3, true);
    frames(5);
    expect(thrown).toEqual(['left', 'right', 'next-house']);
    expect(steered?.lane).toBe(2);
  });

  it('wakes from no polling on a forwarded press, and stops again when it is released', async () => {
    inTheShell();
    await ride();
    frames(5);
    expect(asked).toBe(1);
    forward(2, true);
    frames(5);
    expect(thrown).toEqual(['right']);
    forward(2, false);
    frames(3);
    const after = asked;
    frames(20);
    expect(asked).toBe(after);
  });

  it('stops on a disconnect mid-round: Android’s cancelled release lets go, and nothing more is thrown', async () => {
    inTheShell();
    await ride();
    forward(4, true);
    frames(3);
    listed = [null];
    forward(4, false); // the release Android sends as the device goes
    event('gamepaddisconnected');
    frames(20);
    expect(thrown).toEqual(['left']);
  });

  it('installs nothing for the shell to call outside the shell, or after the round', async () => {
    const endRide = (): void => {
      mounted?.unmount();
      mounted = undefined;
    };
    await ride();
    expect(Reflect.get(window, FORWARDED_BUTTON_GLOBAL)).toBeUndefined();
    endRide();

    inTheShell();
    await ride();
    expect(Reflect.get(window, FORWARDED_BUTTON_GLOBAL)).toBeTypeOf('function');
    endRide();
    expect(Reflect.get(window, FORWARDED_BUTTON_GLOBAL)).toBeUndefined();
  });
});
