// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * An ordinary ride's light and weather, from the setup to the frames its
 * view is handed — #3281. Driven through the real consumers on both ends: the
 * choice in a mounted `GameView`'s chooser, kept on the device and read back
 * by a second mount (a restart), then a ride whose frames are read off the
 * renderer double. What the view draws from a frame's `weather` is the
 * browser gate's (`delivery.browser.spec.ts` §"#3281").
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

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import {
  readRideSkyChoice,
  RIDE_SKY_STORAGE_KEY,
  writeRideSkyChoice,
  type RideSkyChoice,
} from './ride-sky';

function flatRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-flat', name: 'Flat', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([flatRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

/** Every frame a view was handed, in order. */
let rendered: SceneFrame[] = [];

const RENDERER: GameRenderer = {
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: (frame) => {
      rendered.push(frame);
    },
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
};

let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;
let clock = 0;

beforeEach(() => {
  pending = [];
  rendered = [];
  clock = 0;
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function openSetup(): Promise<Mounted> {
  // A fresh start: the last mount's frames and clock are not this one's.
  pending = [];
  clock = 0;
  mounted = await mount(
    <GameView port={PORT} renderer={() => Promise.resolve(RENDERER)} now={() => clock} />,
  );
  await settle();
  return mounted;
}

function closeSetup(): void {
  mounted?.unmount();
  mounted = undefined;
}

/** The setup's radio for `choice`, as a rider reaches it. */
function radioFor(choice: RideSkyChoice): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[name="oyl-ride-sky"]').find(
    (radio) => radio.value === choice,
  );
}

/** Which radio the setup shows chosen. */
function shownChoice(): string | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[name="oyl-ride-sky"]').find(
    (radio) => radio.checked,
  )?.value;
}

async function click(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

/** Press *Ride* on the open setup and return the frames of its first few draws. */
async function ride(): Promise<SceneFrame[]> {
  rendered = [];
  const button = queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  await click(button);
  for (let index = 0; index < 4; index += 1) {
    clock += 16;
    await act(async () => {
      pending.shift()?.(clock);
      await Promise.resolve();
    });
  }
  await settle();
  return rendered;
}

describe('#3281 — the light and weather choice survives a restart', () => {
  it('written through the public writer, it is what the setup shows when it opens', async () => {
    expect(writeRideSkyChoice(localStorage, 'dusk')).toBe(true);
    await openSetup();
    expect(shownChoice()).toBe('dusk');
  });

  it('chosen in the setup, it is kept on the device and shown again after a restart', async () => {
    await openSetup();
    // A device that never chose shows clear daylight.
    expect(shownChoice()).toBe('clear');
    await click(radioFor('overcast'));
    expect(shownChoice()).toBe('overcast');
    expect(localStorage.getItem(RIDE_SKY_STORAGE_KEY)).toBe('overcast');
    expect(readRideSkyChoice(localStorage)).toBe('overcast');
    closeSetup();
    await openSetup();
    expect(shownChoice()).toBe('overcast');
  });
});

describe('#3281 — a route ride hands its view the look it was started in', () => {
  it('started at dusk, every frame carries a dusk', async () => {
    await openSetup();
    await click(radioFor('dusk'));
    const frames = await ride();
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.weather).toEqual({ rain: false, dusk: true });
      expect(frame.delivery).toBeUndefined();
    }
  });

  it('started with no choice, no frame carries a weather at all — today’s frame', async () => {
    await openSetup();
    const frames = await ride();
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect('weather' in frame).toBe(false);
  });

  it('started in rain, the road ahead reaches as far, under the same haze, as a clear ride’s', async () => {
    await openSetup();
    const clear = await ride();
    closeSetup();
    await openSetup();
    await click(radioFor('rain'));
    const rain = await ride();
    expect(rain.length).toBeGreaterThan(0);
    expect(rain.length).toBe(clear.length);
    for (const [at, frame] of rain.entries()) {
      const day = clear[at] as SceneFrame;
      expect(frame.weather).toEqual({ rain: true, dusk: false });
      // How far ahead the road is drawn: the corridor's last point, and its points.
      expect(frame.corridor.centre.at(-1)?.along).toBe(day.corridor.centre.at(-1)?.along);
      expect(frame.corridor.centre.length).toBe(day.corridor.centre.length);
      // The haze it is seen through is the route's own: the view draws the
      // ride's rain without thickening it (`weather-look.test.ts` §"#3281").
      expect(frame.world.fogDensity).toBe(day.world.fogDensity);
    }
  });
});
