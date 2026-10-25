// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1634 through `GameView`'s own press — the carried-over finding of PR
 * #1667's review: nothing failed if the press handed `footprintPlans`
 * `NO_URBAN_CLASS`, or no class at all, because nothing read `plan.urban`.
 * An untagged footprint's storeys now do, so a ride over a synthetic city
 * centre and one over a synthetic village are mounted here, their corridors
 * handed to the game by its port, and the storeys read back off the mapped
 * buildings the scene is given. With the class dropped at the press, both read
 * today's flat 2.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import type { SceneInput } from './scene';
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

const FRAME_MS = 250;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  inputs.length = 0;
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

/** The storeys of every footprint the ride's press planned, read off the scene's input. */
async function storeysRidden(kind: UrbanStretchKind): Promise<number[]> {
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
  return (plans ?? []).map((plan) => plan.storeys);
}

const text = (): string => mounted?.container.textContent ?? '';

describe('untagged storeys by urban class, through GameView’s press (#1634)', () => {
  it('rides a synthetic city centre’s untagged footprints at 3 or 4 storeys', async () => {
    const storeys = await storeysRidden('city-commerce');
    expect(new Set(storeys)).toEqual(new Set([3, 4]));
  });

  it('rides the same untagged footprints in a village at 1 or 2 storeys', async () => {
    const storeys = await storeysRidden('village');
    expect(new Set(storeys)).toEqual(new Set([1, 2]));
  });
});
