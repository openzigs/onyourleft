// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Android's back inside the shell — #1512.
 *
 * The decision is pure and is tested branch by branch; then the REAL
 * `AppShell` is mounted and pressed the way `MainActivity.java` presses it, by
 * calling the global it installs, and the answer is read back from the address
 * the router reads. `apps/mobile/src/android/back-source.test.ts` holds the
 * Java to the global's name. Whether a device's back behaves is a check on the
 * owner's list (#733).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import type { GamePort, RidableRoute } from '../game/GameView';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import type { RideSnapshot } from '../ride/controller';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { ANDROID_BACK_GLOBAL, answerBack, pressBack, type BackWindow } from './android-back';
import { AppShell } from './AppShell';
import { hrefFor, routeById } from './routes';

describe('answerBack (#1512)', () => {
  it('stays put while a ride is on, on every screen and whatever the history', () => {
    for (const routeId of ['ride', 'game', 'home', 'routes', 'activity-detail'] as const) {
      for (const canGoBack of [true, false]) {
        expect(answerBack({ routeId, rideOn: true, canGoBack })).toBe('stay');
      }
    }
  });

  it('leaves from Home, the top level, whatever the history', () => {
    expect(answerBack({ routeId: 'home', rideOn: false, canGoBack: true })).toBe('leave');
    expect(answerBack({ routeId: 'home', rideOn: false, canGoBack: false })).toBe('leave');
  });

  it('goes back anywhere else with history, and Home with none', () => {
    expect(answerBack({ routeId: 'activity-detail', rideOn: false, canGoBack: true })).toBe('back');
    expect(answerBack({ routeId: 'ride', rideOn: false, canGoBack: true })).toBe('back');
    expect(answerBack({ routeId: 'routes', rideOn: false, canGoBack: false })).toBe('home');
  });
});

describe('pressBack (#1512)', () => {
  function scripted(): BackWindow & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      history: { back: () => calls.push('back') },
      location: { replace: (url: string | URL) => calls.push(`replace ${String(url)}`) },
    };
  }

  it('acts on each answer and reports false only for leave', () => {
    const target = scripted();
    expect(pressBack({ routeId: 'routes', rideOn: true, canGoBack: true }, target)).toBe(true);
    expect(pressBack({ routeId: 'routes', rideOn: false, canGoBack: true }, target)).toBe(true);
    expect(pressBack({ routeId: 'routes', rideOn: false, canGoBack: false }, target)).toBe(true);
    expect(pressBack({ routeId: 'home', rideOn: false, canGoBack: true }, target)).toBe(false);
    expect(target.calls).toEqual(['back', `replace ${hrefFor(routeById('home'))}`]);
  });
});

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

type Press = (canGoBack: unknown) => boolean;

function installed(): Press | undefined {
  return (globalThis as unknown as Record<string, Press | undefined>)[ANDROID_BACK_GLOBAL];
}

function press(canGoBack: unknown): boolean {
  const handler = installed();
  if (handler === undefined) {
    throw new Error(`the shell installed no ${ANDROID_BACK_GLOBAL}`);
  }
  return handler(canGoBack);
}

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.location.hash = '';
});

async function openShell(
  at: string,
  snapshot: RideSnapshot = idleSnapshot(),
  nativeShell = true,
): Promise<void> {
  globalThis.location.hash = at;
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      nativeShell={nativeShell}
      rideController={stubRideController(snapshot).controller}
    />,
  );
  await settle();
}

describe('the shell answers MainActivity’s back press (#1512)', () => {
  it('installs nothing in a browser, which has its own back button', async () => {
    await openShell(hrefFor(routeById('routes')), idleSnapshot(), false);
    expect(installed()).toBeUndefined();
  });

  it('goes back through the history on a screen below Home', async () => {
    await openShell(hrefFor(routeById('routes')));
    const back = vi.spyOn(globalThis.history, 'back').mockImplementation(() => undefined);
    expect(press(true)).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('goes Home, replacing the entry, when the WebView has no history', async () => {
    await openShell(hrefFor(routeById('routes')));
    expect(press(false)).toBe(true);
    await settle();
    expect(globalThis.location.hash).toBe(hrefFor(routeById('home')));
    expect(document.querySelector('h1')?.textContent).toBe(routeById('home').title);
  });

  it('reads anything but a literal true as no history', async () => {
    await openShell(hrefFor(routeById('routes')));
    const back = vi.spyOn(globalThis.history, 'back').mockImplementation(() => undefined);
    expect(press('true')).toBe(true);
    expect(back).not.toHaveBeenCalled();
    await settle();
    expect(globalThis.location.hash).toBe(hrefFor(routeById('home')));
  });

  it('leaves from Home', async () => {
    await openShell(hrefFor(routeById('home')));
    expect(press(true)).toBe(false);
  });

  for (const [name, snapshot] of [
    ['recording', ridingSnapshot()],
    ['paused', { ...ridingSnapshot(), phase: 'paused' as const }],
  ] as const) {
    it(`does nothing at all while a ride is ${name}, even from Home`, async () => {
      for (const at of [hrefFor(routeById('ride')), hrefFor(routeById('home'))]) {
        mounted?.unmount();
        await openShell(at, snapshot);
        const back = vi.spyOn(globalThis.history, 'back').mockImplementation(() => undefined);
        expect(press(true)).toBe(true);
        expect(press(false)).toBe(true);
        expect(back).not.toHaveBeenCalled();
        await settle();
        expect(globalThis.location.hash).toBe(at);
        back.mockRestore();
      }
      mounted?.unmount();
      mounted = undefined;
    });
  }

  it('takes the global back when the shell unmounts', async () => {
    await openShell(hrefFor(routeById('routes')));
    expect(installed()).toBeTypeOf('function');
    mounted?.unmount();
    mounted = undefined;
    expect(installed()).toBeUndefined();
  });
});

function ridableRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return { id: 'route-1', name: 'Test climb', profile: routeProfile(points), attempts: 0 };
}

const GAME: GamePort = {
  listRoutes: () => Promise.resolve([ridableRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(240), live: true, paired: true },
    cadence: { value: 85, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

describe('the trainer game’s stage has the screen (#1512)', () => {
  // The game keeps its own phase and never goes through the ride controller,
  // so the controller here is idle: `immersive` is the only thing that says a
  // ride is on, and the only thing between a press and Home.
  it('consumes the press and stays on the game once the ride has started', async () => {
    globalThis.location.hash = hrefFor(routeById('game'));
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        nativeShell
        game={GAME}
        rideController={stubRideController(idleSnapshot()).controller}
      />,
    );
    await settle();

    // Choosing a route is not a ride: back still works there (the control).
    const choosing = vi.spyOn(globalThis.history, 'back').mockImplementation(() => undefined);
    expect(press(true)).toBe(true);
    expect(choosing).toHaveBeenCalledTimes(1);
    choosing.mockRestore();

    const start = [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
      (each.textContent ?? '').startsWith('Ride '),
    );
    if (start === undefined) {
      throw new Error('the game offers no Ride control');
    }
    await act(async () => {
      start.click();
      await Promise.resolve();
    });
    await settle();
    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();

    const back = vi.spyOn(globalThis.history, 'back').mockImplementation(() => undefined);
    expect(press(true)).toBe(true);
    expect(press(false)).toBe(true);
    expect(back).not.toHaveBeenCalled();
    await settle();
    expect(globalThis.location.hash).toBe(hrefFor(routeById('game')));
  });
});
