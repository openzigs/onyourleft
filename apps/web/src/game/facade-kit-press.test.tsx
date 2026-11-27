// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3334 through `GameView`'s own press — PR #3343's review: planning a town's
 * wraps of the downtown kit's pieces is most of what planning its footprints
 * costs, and only the realistic world draws them. So the press plans them for
 * a ride that asked for the realistic world and for no other. The options the
 * press hands `footprintPlans` are read here, and the plans the scene is given.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import type { FootprintPlanOptions } from './footprint-buildings';
import type { SceneInput } from './scene';
import { REALISTIC_WORLD_STORAGE_KEY } from './world-preference';
import { untaggedCorridor, urbanFixture, type UrbanStretchKind } from './testing/urban-fixtures';

const inputs: SceneInput[] = [];

vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

/** The options every `footprintPlans` call was handed, in order — #3334. */
const planned: (FootprintPlanOptions | undefined)[] = [];
vi.mock('./footprint-buildings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./footprint-buildings')>();
  return {
    ...actual,
    footprintPlans: (...args: Parameters<typeof actual.footprintPlans>) => {
      planned.push(args[6]);
      return actual.footprintPlans(...args);
    },
  };
});

const FRAME_MS = 250;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  inputs.length = 0;
  planned.length = 0;
  window.localStorage.clear();
  pending = [];
  nowMs = 0;
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
});

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

const renderer: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

/** How many of the footprints the ride's press planned are wrapped, read off the scene's input. */
async function wrapsRidden(kind: UrbanStretchKind): Promise<number> {
  const built = urbanFixture([{ kind, from: 100, to: 500 }], { length: 1_000 });
  const corridor = untaggedCorridor(built.corridor);
  const route: RidableRoute = {
    id: corridor.routeId,
    name: 'Synthetic stretch',
    profile: built.profile,
    attempts: 0,
  };
  const port: GamePort = {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    loadWorldCorridor: () => Promise.resolve({ kind: 'ready', corridor }),
  };
  mounted = await mount(
    <GameView port={port} renderer={() => Promise.resolve(renderer)} now={() => nowMs} />,
  );
  for (let i = 0; i < 200 && !text().includes('Towns from map data: ready'); i++) await settle();
  expect(text()).toContain('Towns from map data: ready');
  const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(ride).toBeDefined();
  await act(async () => {
    ride?.click();
    await Promise.resolve();
  });
  await settle();
  await pump(4);
  const plans = inputs.find((input) => input.mappedBuildings !== undefined)?.mappedBuildings?.plans;
  expect(plans?.length).toBeGreaterThan(50);
  return (plans ?? []).filter((plan) => plan.kit !== undefined).length;
}

const text = (): string => mounted?.container.textContent ?? '';

describe('the downtown kit’s wraps, planned at GameView’s press only for the realistic world (#3334)', () => {
  it('plans no wrap for a ride that did not ask for the realistic world', async () => {
    expect(await wrapsRidden('city-commerce')).toBe(0);
    expect(planned.map((options) => options?.facadeKit)).toEqual([false]);
  });

  it('plans a city centre’s wraps for a ride that asked for it', async () => {
    window.localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    expect(await wrapsRidden('city-commerce')).toBeGreaterThan(10);
    expect(planned.map((options) => options?.facadeKit)).toEqual([true]);
  });
});
