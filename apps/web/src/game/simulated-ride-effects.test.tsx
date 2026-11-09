// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2379: a simulated ride, on the clock a production build gives it.
 *
 * `simulated-rider-wiring.test.tsx` injects `now` and `frameNow`, as every
 * test of `GameView` does, so none of them ever met the default
 * `useSimulatedRide` builds when neither is given — which is what the shipped
 * app gives it. That default was a new function on every render, it sits in
 * the ride effect's dependencies, and so the effect was torn down and run again
 * on every render of the screen: `load()` was called again each time (the
 * scenery models and the wordmark with it), each run cancelled before
 * `renderer.create(canvas)`, and the canvas was never drawn on.
 *
 * Nothing here injects a clock. What is read back is what the ride's loop and
 * the renderer's loader were asked to do across renders: the animation frame
 * cancelled (the effect's cleanup, the one thing it always does), the loader
 * called, and the view created.
 *
 * ⚠️ Every route here is synthetic: a straight line north from 0° 0°.
 */

import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { NO_SENSORS } from './sensors';

function straightRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 300; index += 1) {
    points.push({
      position: geographicPosition(degreesLatitude((index * 10) / 111_320), degreesLongitude(0)),
      elevation: altitudeMetres(index * 0.1),
    });
  }
  return { id: 'route-own', name: 'My imported route', profile: routeProfile(points), attempts: 0 };
}

const ROUTE = straightRoute();

/** One port for the whole test: the shell hands the screen the same one every render. */
const PORT: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => NO_SENSORS,
};

/**
 * The renderer a view is built by, counted. `load` stands for `main.tsx`'s
 * `loadGameRenderer`, which fetches every scenery model and the wordmark each
 * time it is called — so each call is one fetch of each asset.
 */
function countingRenderer(assets: readonly string[], gate?: Promise<void>) {
  const fetched = new Map<string, number>();
  const created: number[] = [];
  const frames: SceneFrame[] = [];
  const renderer: GameRenderer = {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => {
      created.push(created.length);
      return {
        hasContext: true,
        prepare: () => Promise.resolve(),
        render: (frame: SceneFrame) => {
          frames.push(frame);
        },
        setQuality: () => undefined,
        setRiderKit: () => undefined,
        setSeason: () => undefined,
        resize: () => undefined,
        destroy: () => undefined,
      };
    },
  };
  let loads = 0;
  const load = async (): Promise<GameRenderer> => {
    loads += 1;
    for (const asset of assets) fetched.set(asset, (fetched.get(asset) ?? 0) + 1);
    await gate;
    return renderer;
  };
  return {
    load,
    fetched,
    frames,
    loads: () => loads,
    created: () => created.length,
  };
}

let pending: FrameRequestCallback[] = [];
let cancelled = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  cancelled = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    cancelled += 1;
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  globalThis.location.hash = '';
});

/** Open the game ridden by a simulated rider, with NO clock given, and press Ride. */
async function startRide(load: () => Promise<GameRenderer>): Promise<() => ReactElement> {
  globalThis.location.hash = '#/game?simulate=250';
  // The same `load` and port every render, as the shell's are.
  const screen = (): ReactElement => <GameView port={PORT} renderer={load} />;
  mounted = await mount(screen());
  await settle();
  const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(ride).toBeDefined();
  await act(async () => {
    ride?.click();
    await Promise.resolve();
  });
  return screen;
}

async function rerender(screen: () => ReactElement, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await mounted?.rerender(screen());
  }
}

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    await act(async () => {
      next(performance.now());
      await Promise.resolve();
    });
  }
}

describe('a simulated ride on the default clock keeps one ride effect — #2379', () => {
  it('runs the loop, the loader and the renderer once each across many renders', async () => {
    const rig = countingRenderer(['tree.glb']);
    const screen = await startRide(rig.load);
    await settle();

    await rerender(screen, 5);
    await pump(5);
    await rerender(screen, 5);
    await pump(5);

    // The effect's cleanup cancels the animation frame, so a torn-down effect
    // shows here: on the unstable default it was torn down once per render.
    expect(cancelled).toBe(0);
    expect(rig.loads()).toBe(1);
    expect(rig.created()).toBe(1);
    // And the view it made was drawn on, which is the whole of the symptom.
    expect(rig.frames.length).toBeGreaterThan(0);
  });

  it('fetches each scenery asset once while the models are still arriving', async () => {
    let arrive: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const assets = ['tree.glb', 'building.glb', 'colormap.png', 'wordmark.png'];
    const rig = countingRenderer(assets, gate);
    const screen = await startRide(rig.load);

    // The models arrive over seconds on a tablet; the screen renders meanwhile.
    await rerender(screen, 12);
    arrive();
    await settle();
    await pump(3);

    for (const asset of assets) {
      expect(
        rig.fetched.get(asset),
        `${asset} was fetched ${String(rig.fetched.get(asset))}×`,
      ).toBe(1);
    }
    expect(rig.created()).toBe(1);
    expect(rig.frames.length).toBeGreaterThan(0);
  });
});
