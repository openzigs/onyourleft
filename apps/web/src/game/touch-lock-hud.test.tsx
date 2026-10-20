// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1432 — the touch lock on the trainer game's HUD, through the real shell and
 * the real `GameView`: the lock's state is the game's, and what is read back
 * is what the HUD then shows a rider (Pause or Resume, the stage or the
 * chooser), not which callback was counted.
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

import { hold, tap } from '../design/touch-lock-testing';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import type { GamePort, RidableRoute } from './GameView';
import type { GameRenderer } from './port';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function ridableRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-1', name: 'Flat', profile: routeProfile(points), attempts: 0 };
}

const GAME: GamePort = {
  listRoutes: () => Promise.resolve([ridableRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  globalThis.location.hash = hrefFor(routeById('game'));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.location.hash = '';
});

function hudButton(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.oyl-hud button')].find(
    (each) => (each.textContent ?? '').trim() === name,
  );
}

function needHudButton(name: string): HTMLButtonElement {
  const found = hudButton(name);
  if (found === undefined) throw new Error(`no HUD button ${name}`);
  return found;
}

async function startRide(): Promise<void> {
  const start = [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  if (start === undefined) throw new Error('the picker offers no ride');
  await act(async () => {
    start.click();
    await Promise.resolve();
  });
  await settle();
}

async function ride(): Promise<void> {
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      game={GAME}
      gameRenderer={() => Promise.resolve(RENDERER)}
    />,
  );
  await settle();
  await startRide();
}

const lock = (): HTMLButtonElement => needHudButton('Touch lock');

describe('the touch lock on the game’s HUD — #1432', () => {
  it('is on the HUD, off, as a toggle', async () => {
    await ride();
    expect(lock().getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores a tap on Pause while it is on', async () => {
    await ride();
    tap(lock());
    await settle();
    expect(lock().getAttribute('aria-pressed')).toBe('true');

    tap(needHudButton('Pause'));
    await settle();

    expect(hudButton('Pause')).toBeDefined();
    expect(hudButton('Resume')).toBeUndefined();
  });

  it('lets the same tap pause the ride while it is off — the control for the case above', async () => {
    await ride();
    tap(needHudButton('Pause'));
    await settle();
    expect(hudButton('Resume')).toBeDefined();
  });

  it('lets a keyboard or screen reader pause the ride while it is on', async () => {
    await ride();
    tap(lock());
    await settle();
    await activateWithKeyboard(needHudButton('Pause'));
    expect(hudButton('Resume')).toBeDefined();
  });

  it('never stops End ride, and the next ride starts unlocked', async () => {
    await ride();
    tap(lock());
    await settle();

    tap(needHudButton('End ride'));
    await settle();
    expect(document.querySelector('.oyl-hud')).toBeNull();

    await startRide();
    expect(lock().getAttribute('aria-pressed')).toBe('false');
  });

  it('turns off with a press held for a second', async () => {
    await ride();
    tap(lock());
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hold(lock(), (ms) => vi.advanceTimersByTime(ms));
    vi.useRealTimers();
    await settle();

    expect(lock().getAttribute('aria-pressed')).toBe('false');
    tap(needHudButton('Pause'));
    await settle();
    expect(hudButton('Resume')).toBeDefined();
  });
});
