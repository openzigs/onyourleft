// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Which world a ride draws, as `GameView` hands it to the renderer — #475,
 * ADR 0026 D-3 and D-7. `quality.ts` decides the two ladders and
 * `world-preference.ts` keeps the choice; this is the wiring between them, and
 * the one thing `realistic-offered.test.ts` cannot see by reading source: that
 * a ride which did not choose the realistic world never loads it, that one
 * which did is drawn in it, and that a failed load or a hot device lands on the
 * stylised world's TOP and says so.
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

import { GameView, STANDING_NOTICE_SECONDS, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import {
  FRAME_MS_REDUCE_ABOVE,
  REALISTIC_LADDER,
  RIDER_SHADOW_MAP_STORAGE_KEY,
  SUSTAINED_SAMPLES,
  qualitySettings,
  type QualitySettings,
} from './quality';
import {
  REALISTIC_WORLD_LEFT_NOTICE,
  realisticWorldChosenText,
  realisticWorldNotice,
  type RealisticWorldOutcome,
} from './realistic-assets';
import { REALISTIC_WORLD_STORAGE_KEY } from './world-preference';

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
/** How many times the renderer was asked for the realistic world. */
let asked = 0;
/** Settles the load the renderer was last asked for. */
let answer: (outcome: RealisticWorldOutcome) => void = () => undefined;

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
  loadRealisticWorld: () => {
    asked += 1;
    return new Promise((resolve) => {
      answer = resolve;
    });
  },
};

let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;
/** The loop's clock, moved by hand. */
let clock = 0;

beforeEach(() => {
  pending = [];
  told = [];
  asked = 0;
  clock = 0;
  answer = () => undefined;
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

async function open(): Promise<void> {
  mounted = await mount(
    <GameView port={PORT} renderer={() => Promise.resolve(RENDERER)} now={() => clock} />,
  );
  await settle();
}

async function ride(): Promise<void> {
  await open();
  const button = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (each) => (each.textContent ?? '').startsWith('Ride '),
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
  await act(async () => {
    pending.shift()?.(clock);
    await Promise.resolve();
  });
  await settle();
}

/** `count` animation frames of `ms` each. */
async function frames(ms: number, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    clock += ms;
    await act(async () => {
      pending.shift()?.(clock);
      await Promise.resolve();
    });
  }
  await settle();
}

async function settleLoad(outcome: RealisticWorldOutcome): Promise<void> {
  await act(async () => {
    answer(outcome);
    await Promise.resolve();
  });
  await settle();
}

const OFFLINE: RealisticWorldOutcome = { loaded: false, offline: true, detail: 'Failed to fetch' };

describe('which world a ride draws — #475', () => {
  it('never loads the realistic world for a device that did not choose it', async () => {
    await open();
    expect(mounted?.container.textContent).not.toContain(realisticWorldChosenText(false));
    await ride();
    await frames(1000 / 60, 10);
    expect(asked).toBe(0);
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((each) => each.world === 'stylised')).toBe(true);
  });

  it('says on the route picker what happens offline, for a device that chose it', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    await open();
    // jsdom is a browser, not the Android shell: the offline sentence.
    expect(mounted?.container.textContent).toContain(realisticWorldChosenText(false));
    expect(realisticWorldChosenText(false)).toContain('not kept on this device for use offline');
    const link = queryAll<HTMLAnchorElement>(mounted?.container ?? document, 'a').find(
      (each) => each.textContent === 'Change this in Settings',
    );
    expect(link?.getAttribute('href')).toBe('#/settings');
  });

  it('loads it once and draws the ride in it, for a device that chose it', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    // The shadow map's rung is a stylised one, and a realistic ride does not
    // ask for it even on a device that did.
    localStorage.setItem(RIDER_SHADOW_MAP_STORAGE_KEY, 'on');
    await ride();
    expect(asked).toBe(1);
    // The view is built at once and draws the stylised world until the
    // realistic one is all here (`three-renderer.ts` §`#applyWorld`), so the
    // rung has to be handed to it AGAIN once the load settles — otherwise it
    // never switches.
    const beforeLoad = told.length;
    await settleLoad({ loaded: true });
    expect(told.length).toBe(beforeLoad + 1);
    expect(told.at(-1)).toEqual(REALISTIC_LADDER[0]);
    expect(told.every((each) => each.riderShadows !== 'map')).toBe(true);
    expect(mounted?.container.textContent).not.toContain('Standard world');
  });

  it('falls back to the stylised top and says so when the load fails — ADR 0026 D-7', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    // The plain top, not the shadow map's rung, even on a device that asked
    // for the map: a realistic ride does not ask for it (`GameView` §`start`),
    // and a failed load is the one way out of realism that skips level 1,
    // where `keepsShadowMap`'s latch would have taken it away anyway.
    localStorage.setItem(RIDER_SHADOW_MAP_STORAGE_KEY, 'on');
    await ride();
    await settleLoad(OFFLINE);
    expect(told.at(-1)).toEqual(qualitySettings(0));
    const said = realisticWorldNotice(OFFLINE, false);
    expect(said).toBeDefined();
    expect(mounted?.container.textContent).toContain(said);
    // …and gets out of the way once it has been up for a standing notice's time.
    await frames(1000, STANDING_NOTICE_SECONDS + 2);
    expect(mounted?.container.textContent).not.toContain(said);
  });

  it('leaves realism for the stylised top when the device runs hot, says so, and never returns', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    // A device that also asked for the shadow map still lands on the plain
    // stylised top: the map's rung is heavier, and a hot device is leaving.
    localStorage.setItem(RIDER_SHADOW_MAP_STORAGE_KEY, 'on');
    await ride();
    await settleLoad({ loaded: true });
    told = [];
    const hot = FRAME_MS_REDUCE_ABOVE + 10;
    await frames(hot, SUSTAINED_SAMPLES + 2);
    await frames(hot, SUSTAINED_SAMPLES + 2);
    expect(told).toEqual([REALISTIC_LADDER[1], qualitySettings(0)]);
    expect(mounted?.container.textContent).toContain(REALISTIC_WORLD_LEFT_NOTICE);
    // Cool for a long time: the stylised ladder climbs nowhere above its top,
    // and nothing hands the ride back to the realistic world.
    await frames(1000 / 60, 3 * (SUSTAINED_SAMPLES + 2));
    expect(told.every((each) => each.world === 'stylised' || each === REALISTIC_LADDER[1])).toBe(
      true,
    );
    expect(told.at(-1)).toEqual(qualitySettings(0));
  });

  it('does not hand realism back, or say a load failed, to a ride that already left it — #475’s review', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    await ride();
    // Hot while the world is still arriving: out of realism for the ride.
    const hot = FRAME_MS_REDUCE_ABOVE + 10;
    await frames(hot, SUSTAINED_SAMPLES + 2);
    await frames(hot, SUSTAINED_SAMPLES + 2);
    expect(told.at(-1)).toEqual(qualitySettings(0));
    expect(mounted?.container.textContent).toContain(REALISTIC_WORLD_LEFT_NOTICE);
    const before = told.length;
    // A load that fails now must not replace the notice the rider has with
    // one about a world the ride is no longer asking for.
    await settleLoad(OFFLINE);
    expect(told.length).toBe(before);
    expect(mounted?.container.textContent).toContain(REALISTIC_WORLD_LEFT_NOTICE);
    const said = realisticWorldNotice(OFFLINE, false);
    expect(said).toBeDefined();
    expect(mounted?.container.textContent).not.toContain(said);
  });

  it('does not touch a ride that ended before the world arrived', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    await ride();
    const end = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (each) => each.textContent === 'End ride',
    );
    await act(async () => {
      end?.click();
      await Promise.resolve();
    });
    await settle();
    const before = told.length;
    await settleLoad({ loaded: true });
    expect(told.length).toBe(before);
  });

  it('builds no view for a ride that ended before the renderer arrived', async () => {
    // The renderer module is `three`, about 600 kB, and a rider can press End
    // ride before it is here. A view built after that would be on a canvas the
    // stage no longer holds, and the next ride would draw into it.
    let arrive: (renderer: GameRenderer) => void = () => undefined;
    const late = new Promise<GameRenderer>((resolve) => {
      arrive = resolve;
    });
    mounted = await mount(<GameView port={PORT} renderer={() => late} now={() => clock} />);
    await settle();
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((each) =>
      (each.textContent ?? '').startsWith('Ride '),
    );
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await settle();
    const end = queryAll<HTMLButtonElement>(mounted.container, 'button').find(
      (each) => each.textContent === 'End ride',
    );
    await act(async () => {
      end?.click();
      await Promise.resolve();
    });
    await settle();
    await act(async () => {
      arrive(RENDERER);
      await Promise.resolve();
    });
    await settle();
    expect(end).toBeDefined();
    expect(told).toEqual([]);
  });
});
