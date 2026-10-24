// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The holiday-decorations switch, from the Settings screen to what a ride
 * hands its renderer — #1622. Driven through the real consumers on both ends:
 * the switch in a mounted `SettingsView`, then a ride in a mounted `GameView`
 * over the same device storage, read off the renderer double's `setSeason`
 * calls. And the product's own renderer keeps what it is told.
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
import { SettingsView } from '../views/SettingsView';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { HOLIDAY_DECORATIONS_STORAGE_KEY } from './holiday-preference';
import type { GameRenderer } from './port';
import { qualitySettings } from './quality';
import type { CalendarDay, Season } from './season';
import { seasonOf, threeGameRenderer } from './three-renderer';

function northernRoute(): RidableRoute {
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
  return { id: 'route-north', name: 'North', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([northernRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

/** Every season a view was told, in order. */
let handed: Season[] = [];

const RENDERER: GameRenderer = {
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: (season) => {
      handed.push(season);
    },
    resize: () => undefined,
    destroy: () => undefined,
  }),
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
};

const HALLOWEEN: CalendarDay = { year: 2026, month: 10, day: 31 };

let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;
let clock = 0;

beforeEach(() => {
  pending = [];
  handed = [];
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

/** Flip the Settings screen's "Holiday decorations" switch, then leave the screen. */
async function flipTheSwitch(): Promise<void> {
  const screen = await mount(
    <SettingsView
      units="metric"
      onUnitsChange={() => undefined}
      onRiderMassChange={() => undefined}
    />,
  );
  const toggle = queryAll<HTMLInputElement>(screen.container, 'input[role="switch"]').find((each) =>
    (each.closest('label')?.textContent ?? '').includes('Holiday decorations'),
  );
  expect(toggle).toBeDefined();
  await act(async () => {
    toggle?.click();
    await Promise.resolve();
  });
  screen.unmount();
}

/** Start a ride on `day` and return the one season its view was told. */
async function rideOn(day: CalendarDay): Promise<Season | undefined> {
  handed = [];
  mounted = await mount(
    <GameView
      port={PORT}
      renderer={() => Promise.resolve(RENDERER)}
      now={() => clock}
      today={() => day}
    />,
  );
  await settle();
  const button = queryAll<HTMLButtonElement>(mounted.container, 'button').find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
  for (let index = 0; index < 3; index += 1) {
    clock += 16;
    await act(async () => {
      pending.shift()?.(clock);
      await Promise.resolve();
    });
  }
  await settle();
  mounted.unmount();
  mounted = undefined;
  expect(handed).toHaveLength(1);
  return handed[0];
}

describe('the holiday-decorations switch reaches the ride — #1622', () => {
  it('a switch turned off in Settings gives a 31 Oct ride no holiday; back on, Halloween', async () => {
    const before = await rideOn(HALLOWEEN);
    expect(before?.holiday).toBe('halloween');

    await flipTheSwitch();
    expect(localStorage.getItem(HOLIDAY_DECORATIONS_STORAGE_KEY)).toBe('off');
    const off = await rideOn(HALLOWEEN);
    expect(off?.holiday).toBeUndefined();

    await flipTheSwitch();
    const on = await rideOn(HALLOWEEN);
    expect(on?.holiday).toBe('halloween');

    // The switch governs holidays only: the route's nature is the same.
    expect(off?.nature).toEqual(on?.nature);
    expect(on?.nature.autumn).toBeGreaterThan(0);
  });
});

describe('the product’s renderer keeps the season it is told — #1622', () => {
  it('holds nothing until told, then what it was told', () => {
    const view = threeGameRenderer.create(document.createElement('canvas'), qualitySettings(0));
    try {
      expect(seasonOf(view)).toEqual({ holiday: undefined, nature: { autumn: 0, winter: 0 } });
      const season: Season = { holiday: 'winter-lights', nature: { autumn: 0.2, winter: 0.7 } };
      view.setSeason(season);
      expect(seasonOf(view)).toEqual(season);
    } finally {
      view.destroy();
    }
  });
});
