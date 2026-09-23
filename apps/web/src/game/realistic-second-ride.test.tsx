// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A second realistic ride in one visit — #475's review.
 *
 * `three-renderer.ts` keeps the realistic world in MODULE state that outlives
 * a view, and `loadRealisticWorld` replaces a loaded world and releases the old
 * one. So a second ride that asked the raw loader again fetched and decoded the
 * whole set a second time, held two copies while it did, released the textures
 * a live view was already drawing — and, offline, fell back to the stylised
 * world and told the rider the realistic one was not kept, while it sat in
 * memory. `loadRealisticWorldOnce` is what a ride asks through, and this file
 * holds it to one load per visit: through the real `GameView`, riding twice in
 * one mount, and at the function itself for the in-flight and failure cases.
 *
 * ⚠️ **Every case imports a FRESH `three-renderer`** (`vi.resetModules`): the
 * state under test is module state, and a case that inherited a world loaded
 * by the case before it would pass for that reason alone.
 *
 * ⚠️ **No `three` is imported here**, for `three-seam.test.ts`: the geometry a
 * fixture needs is taken off a belt the renderer builds, the same posture
 * `realistic-renderer.test.ts` takes.
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
import { REALISTIC_LADDER, type QualitySettings } from './quality';
import { REALISTIC_SKY, realisticUrl } from './realistic-assets';
import type * as Renderer from './three-renderer';
import { REALISTIC_WORLD_STORAGE_KEY } from './world-preference';

type RendererModule = typeof Renderer;

/** A fresh copy of the renderer module, holding no realistic world. */
async function freshRenderer(): Promise<RendererModule> {
  vi.resetModules();
  return import('./three-renderer');
}

const IDENTITY = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };

/**
 * Loaders that answer from memory, count what they were asked for, and record
 * every file released. `offline` refuses everything, as a lost network does.
 */
function loadersFor(renderer: RendererModule): Renderer.RealisticLoaders & {
  asked: string[];
  released: number;
  offline: boolean;
} {
  const state = {
    asked: [] as string[],
    released: 0,
    offline: false,
  };
  const geometry = (): unknown => {
    const mesh = new renderer.ScatterBelt(new Map()).meshesOf('rock')[0];
    if (mesh === undefined) throw new Error('no rock primitive');
    const one = mesh.geometry.clone();
    const dispose = one.dispose.bind(one);
    one.dispose = () => {
      state.released += 1;
      dispose();
    };
    return one;
  };
  const texture = (): unknown => ({
    image: { width: 64, height: 64 },
    dispose: () => {
      state.released += 1;
    },
  });
  const extras = {
    oyl_scan_height: 8,
    oyl_scan_width: 4,
    oyl_impostor_scale: 8,
    oyl_impostor_frames: 8,
  };
  const scene = (): unknown => {
    const mesh = {
      isMesh: true,
      geometry: geometry(),
      material: {
        transparent: false,
        alphaTest: 0,
        alphaHash: false,
        map: { image: { width: 512, height: 512 }, dispose: () => undefined },
        normalMap: null,
        dispose: () => undefined,
      },
      matrixWorld: IDENTITY,
      userData: {},
    };
    return {
      userData: extras,
      updateWorldMatrix: () => undefined,
      traverse: (visit: (node: unknown) => void) => {
        visit({ isMesh: false, userData: extras });
        visit(mesh);
      },
    };
  };
  const sky = (): unknown => {
    const data = new Float32Array(16 * 8 * 4).fill(1);
    data[(1 * 16 + 5) * 4] = 50;
    return {
      image: { width: 16, height: 8, data },
      type: 'float',
      dispose: () => {
        state.released += 1;
      },
    };
  };
  const answer = <T,>(url: string, make: () => T): Promise<T> => {
    state.asked.push(url);
    return state.offline
      ? Promise.reject(new Error(`${url}: Failed to fetch`))
      : Promise.resolve(make());
  };
  return Object.assign(state, {
    sky: (url: string) => answer(url, sky) as never,
    texture: (url: string) => answer(url, texture) as never,
    model: (url: string) => answer(url, scene) as never,
  });
}

/** How many times the sky — one file per load — was asked for. */
function loadsOf(loaders: { readonly asked: readonly string[] }): number {
  return loaders.asked.filter((url) => url === realisticUrl(REALISTIC_SKY)).length;
}

describe('the realistic world is loaded once per visit — #475’s review', () => {
  it('answers a loaded world at once, and releases nothing of it', async () => {
    const renderer = await freshRenderer();
    const loaders = loadersFor(renderer);
    await expect(renderer.loadRealisticWorldOnce(loaders)).resolves.toEqual({ loaded: true });
    const asked = loaders.asked.length;
    await expect(renderer.loadRealisticWorldOnce(loaders)).resolves.toEqual({ loaded: true });
    expect(loaders.asked.length).toBe(asked);
    expect(loaders.released).toBe(0);
    expect(renderer.realisticWorldLoaded()).toBe(true);
  });

  it('joins a load already in flight rather than starting a second', async () => {
    const renderer = await freshRenderer();
    const loaders = loadersFor(renderer);
    const [first, second] = await Promise.all([
      renderer.loadRealisticWorldOnce(loaders),
      renderer.loadRealisticWorldOnce(loaders),
    ]);
    expect(first).toEqual({ loaded: true });
    expect(second).toEqual({ loaded: true });
    expect(loadsOf(loaders)).toBe(1);
    expect(loaders.released).toBe(0);
  });

  it('tries again after a load that failed, because a failure left nothing loaded', async () => {
    const renderer = await freshRenderer();
    const loaders = loadersFor(renderer);
    loaders.offline = true;
    await expect(renderer.loadRealisticWorldOnce(loaders)).resolves.toMatchObject({
      loaded: false,
    });
    loaders.offline = false;
    await expect(renderer.loadRealisticWorldOnce(loaders)).resolves.toEqual({ loaded: true });
    expect(loadsOf(loaders)).toBe(2);
  });

  it('is what the renderer the app ships asks through', async () => {
    const renderer = await freshRenderer();
    await renderer.loadRealisticWorldOnce(loadersFor(renderer));
    // The shipped port's own loaders would reach for the network, which this
    // environment does not have: answered without them, or not at all.
    await expect(renderer.threeGameRenderer.loadRealisticWorld()).resolves.toEqual({
      loaded: true,
    });
  }, 2_000);
});

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

describe('two realistic rides in one mount — #475’s review', () => {
  let pending: FrameRequestCallback[] = [];
  let mounted: Mounted | undefined;
  let clock = 0;

  beforeEach(() => {
    pending = [];
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

  const button = (label: (text: string) => boolean): HTMLButtonElement | undefined =>
    queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((each) =>
      label(each.textContent ?? ''),
    );

  async function press(target: HTMLButtonElement | undefined): Promise<void> {
    expect(target).toBeDefined();
    await act(async () => {
      target?.click();
      await Promise.resolve();
    });
    await settle();
  }

  /** Starts a ride from the picker and runs its first frame, which builds the view. */
  async function ride(): Promise<void> {
    await press(button((text) => text.startsWith('Ride ')));
    await act(async () => {
      pending.shift()?.(clock);
      await Promise.resolve();
    });
    await settle();
  }

  it('loads the world for the first ride, and draws the second in it with no second load — even offline', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    const three = await freshRenderer();
    const loaders = loadersFor(three);
    /** Every rung each view was built with or told about, one list per ride. */
    const told: QualitySettings[][] = [];
    const renderer: GameRenderer = {
      create: (_canvas, settings) => {
        const mine = [settings];
        told.push(mine);
        return {
          hasContext: true,
          render: () => undefined,
          setQuality: (next) => {
            mine.push(next);
          },
          resize: () => undefined,
          destroy: () => undefined,
        };
      },
      // The real once-per-visit load, over files from memory: the question is
      // what a second ride does to the module state the first one filled.
      loadRealisticWorld: () => three.loadRealisticWorldOnce(loaders),
    };
    mounted = await mount(
      <GameView port={PORT} renderer={() => Promise.resolve(renderer)} now={() => clock} />,
    );
    await settle();

    await ride();
    expect(loadsOf(loaders)).toBe(1);
    expect(told[0]?.at(-1)).toEqual(REALISTIC_LADDER[0]);
    await press(button((text) => text === 'End ride'));

    // The network is gone. The world is still in memory, and the rider was
    // told it would be used — so the second ride must not go looking for it.
    loaders.offline = true;
    await ride();
    expect(told.length).toBe(2);
    expect(loadsOf(loaders)).toBe(1);
    expect(loaders.released).toBe(0);
    expect(told[1]?.at(-1)).toEqual(REALISTIC_LADDER[0]);
    expect(mounted.container.textContent).not.toContain('not kept on this device');
  });
});
