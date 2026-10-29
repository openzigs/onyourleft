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
import type { PadSnapshot } from '../gamepad-port';
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
