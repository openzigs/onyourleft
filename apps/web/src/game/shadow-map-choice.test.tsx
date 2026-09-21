// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Which way a ride grounds its riders, as `GameView` hands it to the renderer —
 * #426. `quality.ts` decides the rungs; this is the wiring: the shadow map is
 * off unless THIS device asked for it, and it goes with the first step down
 * and does not come back that ride (`quality.ts` §`keepsShadowMap`).
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
import type { GameRenderer } from './port';
import {
  FRAME_MS_REDUCE_ABOVE,
  RIDER_SHADOW_MAP_RUNG,
  RIDER_SHADOW_MAP_STORAGE_KEY,
  SUSTAINED_SAMPLES,
  qualitySettings,
  type QualitySettings,
} from './quality';

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

/** Every rung the renderer was built with or told about, in order. */
let told: QualitySettings[] = [];

const RENDERER: GameRenderer = {
  create: (_canvas, settings) => {
    told.push(settings);
    return {
      hasContext: true,
      render: () => undefined,
      setQuality: (next) => {
        told.push(next);
      },
      resize: () => undefined,
      destroy: () => undefined,
    };
  },
};

let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  told = [];
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

/** The loop's clock, which the latch test moves by hand to make frames slow or fast. */
let clock = 0;

async function ride(): Promise<void> {
  mounted = await mount(
    <GameView port={PORT} renderer={() => Promise.resolve(RENDERER)} now={() => clock} />,
  );
  await settle();
  const button = queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
  await act(async () => {
    pending.shift()?.(performance.now());
    await Promise.resolve();
  });
  await settle();
}

describe('how a ride grounds its riders — #426', () => {
  it('draws contact shadows, and no shadow map, for a device that asked for nothing', async () => {
    await ride();
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((each) => each.riderShadows === 'contact')).toBe(true);
  });

  it('draws the shadow map for a device that asked for it', async () => {
    localStorage.setItem(RIDER_SHADOW_MAP_STORAGE_KEY, 'on');
    await ride();
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((each) => each.riderShadows === 'map')).toBe(true);
  });

  it('does not come back when the ladder climbs back to level 0 — the latch, wired', async () => {
    localStorage.setItem(RIDER_SHADOW_MAP_STORAGE_KEY, 'on');
    await ride();
    /** Frames of `ms` each, enough of them to move the ladder one rung. */
    const frames = async (ms: number): Promise<void> => {
      for (let index = 0; index < SUSTAINED_SAMPLES + 2; index += 1) {
        clock += ms;
        await act(async () => {
          pending.shift()?.(clock);
          await Promise.resolve();
        });
      }
      await settle();
    };
    await frames(FRAME_MS_REDUCE_ABOVE + 10);
    await frames(5);
    await frames(FRAME_MS_REDUCE_ABOVE + 10);
    await frames(5);
    // The renderer was told: the map, then a step down, then back to level 0
    // twice — each time WITHOUT the map.
    expect(told).toEqual([
      RIDER_SHADOW_MAP_RUNG,
      qualitySettings(1),
      qualitySettings(0),
      qualitySettings(1),
      qualitySettings(0),
    ]);
  });
});
