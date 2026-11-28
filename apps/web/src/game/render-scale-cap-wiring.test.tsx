// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3358: **a render-scale ceiling this device stored reaches the realistic
 * world the moment it arrives.** The issue's ride is a realistic lap race on a
 * high-pixel-ratio iPad at about 29 fps, and the measurement it asks for is the
 * same ride at 0.83 and 0.67. A realistic ride starts on the stylised world and
 * swaps when the set arrives (#475), and that swap hands the view its rung on a
 * path of its own (`GameView.tsx`, the arrival's `setQuality`), so a ceiling
 * that reached the first rung and not this one would measure the stylised
 * world at 0.83 and the realistic one at 1.
 *
 * The real `GameView`, the real lap race and the real ladder. The doubles are
 * the store behind `GamePort`, the clock and the renderer, whose view writes
 * down every rung it is handed.
 *
 * ⚠️ What this cannot say: what a frame at 0.83 costs on the iPad. That is the
 * measurement the ceiling exists for, and only the device can take it.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { LapRaceChoice } from './lap-race/choice';
import type { GameRenderer } from './port';
import { REALISTIC_LADDER, RENDER_SCALE_STORAGE_KEY, type QualitySettings } from './quality';
import type { RealisticWorldOutcome } from './realistic-assets';
import { circuitRoute } from './route-fixtures-testing';
import { writeRealisticWorldChoice } from './world-preference';

const CIRCUIT = circuitRoute(40, () => 0);
const ROUTE: RidableRoute = { id: 'lap-race', name: 'Race loop', profile: CIRCUIT, attempts: 0 };
const RACE: LapRaceChoice = { laps: 2, bots: 7, tier: 'hard', itemsOn: true };

let nowMs = 1_000_000;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

const port: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 142, live: true, paired: true },
  }),
};

/** A renderer whose realistic set arrives when the test says, and whose view keeps every rung. */
function recordingRenderer(rungs: QualitySettings[]): {
  readonly renderer: GameRenderer;
  readonly arrive: () => Promise<void>;
} {
  let resolveLoad: ((outcome: RealisticWorldOutcome) => void) | undefined;
  return {
    renderer: {
      loadRealisticWorld: () =>
        new Promise<RealisticWorldOutcome>((resolve) => {
          resolveLoad = resolve;
        }),
      create: (_canvas, settings) => {
        rungs.push(settings);
        return {
          hasContext: true,
          prepare: () => Promise.resolve(),
          render: () => undefined,
          setQuality: (next: QualitySettings) => {
            rungs.push(next);
          },
          setRiderKit: () => undefined,
          setSeason: () => undefined,
          resize: () => undefined,
          destroy: () => undefined,
        };
      },
    },
    arrive: async () => {
      if (resolveLoad === undefined)
        throw new Error('the ride never asked for the realistic world');
      await act(async () => {
        resolveLoad?.({ loaded: true });
        await Promise.resolve();
      });
      await settle();
    },
  };
}

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  localStorage.clear();
  writeRealisticWorldChoice(localStorage, true);
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

async function pump(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    const due = pending;
    if (due.length === 0) throw new Error('the ride asked for no frame');
    pending = [];
    nowMs += 1000 / 60;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

/** Mounts a game ride with a lap race on the realistic world, and presses *Ride*. */
async function rideARace(renderer: GameRenderer): Promise<void> {
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer)}
      now={() => nowMs}
      riderMass={kilograms(72)}
      lapRace={RACE}
    />,
  );
  await settle();
  const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  await act(async () => {
    ride?.click();
    await Promise.resolve();
  });
  await settle();
}

/**
 * The rungs the view was handed by the arrival itself — everything after the
 * `count` it already held — which must be exactly one, so a ceiling the view
 * was BUILT with cannot stand in for one the swap failed to hand over.
 */
function handedOnArrival(rungs: readonly QualitySettings[], count: number): QualitySettings {
  const handed = rungs.slice(count);
  expect(handed).toHaveLength(1);
  return handed[0] as QualitySettings;
}

describe('a render-scale ceiling reaches the realistic world when it arrives — #3358', () => {
  it('hands the arriving realistic world the stored ceiling, and every other figure as the ladder has it', async () => {
    localStorage.setItem(RENDER_SCALE_STORAGE_KEY, '0.83');
    const rungs: QualitySettings[] = [];
    const { renderer, arrive } = recordingRenderer(rungs);
    await rideARace(renderer);
    await pump(3);
    const before = rungs.length;
    await arrive();

    const realistic = handedOnArrival(rungs, before);
    expect(realistic.renderScale).toBe(0.83);
    expect({ ...realistic, renderScale: 1 }).toEqual(REALISTIC_LADDER[0]);
    // And the view was BUILT under it too, before the set arrived.
    expect(rungs[0]?.renderScale).toBe(0.83);
  });

  it('hands it the ladder’s own rung when the device stored nothing', async () => {
    const rungs: QualitySettings[] = [];
    const { renderer, arrive } = recordingRenderer(rungs);
    await rideARace(renderer);
    await pump(3);
    const before = rungs.length;
    await arrive();

    expect(handedOnArrival(rungs, before)).toEqual(REALISTIC_LADDER[0]);
  });
});
