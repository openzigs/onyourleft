// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Which way a ride grounds its riders, as `GameView` hands it to the renderer —
 * #426, #547. `quality.ts` decides the rungs; this is the wiring: since #547
 * the shadow map is ON for a stylised ride unless THIS device turned it off,
 * it goes with the first step down and does not come back that ride
 * (`quality.ts` §`keepsShadowMap`), and no world is drawn into a view until
 * its programs are built (`port.ts` §`GameView.prepare`).
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
  SHADOW_MAP_OFF,
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

/** How many frames the renderer was asked to draw. */
let rendered = 0;
/**
 * What each view's `prepare` returns — #547. Settled at once unless a test
 * holds it open, which is how the "no world before the programs" wiring is seen.
 */
let preparing: () => Promise<void> = () => Promise.resolve();

const RENDERER: GameRenderer = {
  // #475: never asked — no ride in this file chose the realistic world.
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: (_canvas, settings) => {
    told.push(settings);
    return {
      hasContext: true,
      prepare: () => preparing(),
      render: () => {
        rendered += 1;
      },
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
  rendered = 0;
  preparing = () => Promise.resolve();
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

describe('how a ride grounds its riders — #426, #547', () => {
  it('draws the shadow map for a device that said nothing — #547', async () => {
    await ride();
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((each) => each.riderShadows === 'map')).toBe(true);
  });

  it('draws contact shadows, and no shadow map, for a device that turned it off', async () => {
    localStorage.setItem(RIDER_SHADOW_MAP_STORAGE_KEY, SHADOW_MAP_OFF);
    await ride();
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((each) => each.riderShadows === 'contact')).toBe(true);
  });

  it('does not come back when the ladder climbs back to level 0 — the latch, wired', async () => {
    await ride();
    /** `count` frames of `ms` each — by default enough to move the ladder one rung. */
    const frames = async (ms: number, count = SUSTAINED_SAMPLES + 2): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        clock += ms;
        await act(async () => {
          pending.shift()?.(clock);
          await Promise.resolve();
        });
      }
      await settle();
    };
    // ⚠️ Cool frames at a 60 Hz display's pace, and twice as many — #476.
    // Level 1 caps at 30, so every other one is drawn, and the ladder is told
    // only about the frames that follow a drawn one (`frame-pacer.ts`). The
    // 5 ms frames this used to feed were the cap being ignored.
    const cool = async (): Promise<void> => frames(1000 / 60, 2 * (SUSTAINED_SAMPLES + 2));
    await frames(FRAME_MS_REDUCE_ABOVE + 10);
    await cool();
    await frames(FRAME_MS_REDUCE_ABOVE + 10);
    await cool();
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

describe('no world is drawn before its programs are built — #547', () => {
  /** One animation frame, a sixtieth of a second on. */
  async function frame(): Promise<void> {
    clock += 1000 / 60;
    await act(async () => {
      pending.shift()?.(clock);
      await Promise.resolve();
    });
  }

  it('draws nothing while `prepare` is in flight, and draws from the frame after it settles', async () => {
    let settle: () => void = () => undefined;
    preparing = () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      });
    await ride();
    for (let index = 0; index < 5; index += 1) await frame();
    // The ride is running — the loop asked for frames — and the world is not drawn.
    expect(pending.length).toBeGreaterThan(0);
    expect(rendered).toBe(0);
    await act(async () => {
      settle();
      await Promise.resolve();
    });
    for (let index = 0; index < 3; index += 1) await frame();
    expect(rendered).toBeGreaterThan(0);
  });

  it('does not draw the NEXT ride into a view because the last ride’s view settled', async () => {
    const settles: (() => void)[] = [];
    preparing = () =>
      new Promise<void>((resolve) => {
        settles.push(resolve);
      });
    await ride();
    await frame();
    // End the ride while its view is still warming, and start another.
    const end = queryAll<HTMLButtonElement>(document.body, 'button').find(
      (each) => each.textContent === 'End ride',
    );
    expect(end).toBeDefined();
    await act(async () => {
      end?.click();
      await Promise.resolve();
    });
    await settle();
    const again = queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
      (each.textContent ?? '').startsWith('Ride '),
    );
    await act(async () => {
      again?.click();
      await Promise.resolve();
    });
    await settle();
    for (let index = 0; index < 3; index += 1) await frame();
    expect(settles.length).toBe(2);
    // The FIRST ride's warm-up settles late: the second ride's view is not it.
    await act(async () => {
      settles[0]?.();
      await Promise.resolve();
    });
    for (let index = 0; index < 3; index += 1) await frame();
    expect(rendered).toBe(0);
    await act(async () => {
      settles[1]?.();
      await Promise.resolve();
    });
    for (let index = 0; index < 3; index += 1) await frame();
    expect(rendered).toBeGreaterThan(0);
  });

  it('draws once `prepare` has settled, with no frame lost to it — the control', async () => {
    await ride();
    for (let index = 0; index < 3; index += 1) await frame();
    expect(rendered).toBeGreaterThan(0);
  });
});
