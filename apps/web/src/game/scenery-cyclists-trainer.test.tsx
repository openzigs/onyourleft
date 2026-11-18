// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The trainer is written the same with the scenery cyclists on and off** —
 * #2722, the owner's ruling "scenery only". The same scripted ride is ridden
 * twice through the real `GameView`, in the realistic world on its top rung,
 * where the cyclists are drawn: once as the ride asks for them, and once with
 * `sceneFrame` told not to place them. What is read is what each consumer was
 * handed: every simulation parameter written to the trainer with the frame
 * it was written on, the odometer the simulation reached, and the HUD.
 *
 * The control, so the comparison cannot pass by drawing nobody: the first
 * ride's frames carry cyclists and the second's carry none. The route is the
 * one fixture length whose seed puts a cyclist in view from the start line
 * (`scenery-cyclists.ts` places them from the route's seed).
 *
 * The same posture as `blind-view-wiring.test.tsx`, whose drawing ride is
 * stylised and so carries no cyclist: this file is the realistic world's
 * half of "drawing writes what not drawing writes" for them.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { REALISTIC_WORLD_STORAGE_KEY } from './world-preference';
import { northRoute } from './route-fixtures-testing';
import type { GameState } from './simulation';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

/** Every `GameSimulation` built, newest last, so a ride's odometer can be read. */
const built = vi.hoisted(() => ({
  simulations: [] as { readonly state: Pick<GameState, 'ride'> }[],
  cyclistsOff: false,
}));

vi.mock('./simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulation')>();
  class KeptSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      built.simulations.push(this);
    }
  }
  return { ...actual, GameSimulation: KeptSimulation };
});

// The one seam this file wraps: the second ride's frames are built as asked,
// with the cyclists switched off. Every other input passes through.
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (input: Parameters<typeof actual.sceneFrame>[0]) =>
      actual.sceneFrame(built.cyclistsOff ? { ...input, sceneryCyclists: false } : input),
  };
});

const START_MS = 1_000_000;
/** Four frames a second: several simulation steps a frame. */
const FRAME_MS = 250;
/** Fifteen seconds of ride: enough grades written to compare. */
const FRAMES = 60;

/** A road that climbs and falls, so the trainer is written often, with a cyclist in view from its start. */
const ROUTE: RidableRoute = {
  id: 'north',
  name: 'North road',
  profile: northRoute(2_750, (along) => 12 * Math.sin(along / 60)),
  attempts: 0,
};

/** The scripted power: a function of the ride's clock alone, the same in both rides. */
function powerAt(nowMs: number): number {
  return 260 + 80 * Math.sin((nowMs - START_MS) / 2_000);
}

/** The device's time of day, frozen, for `blind-view-wiring.test.tsx`'s reason (#2573). */
const TIME_OF_DAY = new Date(2026, 10, 12, 4, 43, 59, 900);

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TIME_OF_DAY);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  built.cyclistsOff = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(powerAt(nowMs)), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 142, live: true, paired: true },
  }),
};

/** A trainer that keeps every simulation parameter it is sent, with the frame it came on. */
function trainerPort(written: unknown[], frame: () => number): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      written.push({ parameters, frame: frame() });
      return Promise.resolve();
    },
    letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
      workout: undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: async () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

/** A view that draws, in the realistic world, which loads at once. */
function renderer(rendered: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.resolve({ loaded: true }),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        rendered.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** Everything one ride left. */
interface Ridden {
  readonly rendered: readonly SceneFrame[];
  readonly written: readonly unknown[];
  readonly odometer: number;
  readonly hud: readonly string[];
}

async function ride(cyclistsOff: boolean): Promise<Ridden> {
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
  localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
  built.simulations.length = 0;
  built.cyclistsOff = cyclistsOff;
  const rendered: SceneFrame[] = [];
  const written: unknown[] = [];
  let frame = 0;
  mounted = await mount(
    <GameView
      port={PORT}
      trainer={trainerPort(written, () => frame)}
      renderer={() => Promise.resolve(renderer(rendered))}
      now={() => nowMs}
    />,
  );
  await settle();
  const start = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  if (start === undefined) throw new Error('no Ride button');
  await act(async () => {
    start.click();
    await Promise.resolve();
  });
  await settle();
  const hud: string[] = [];
  for (frame = 1; frame <= FRAMES; frame += 1) {
    const due = pending;
    if (due.length === 0) throw new Error(`the ride asked for no frame at ${String(frame)}`);
    pending = [];
    nowMs += FRAME_MS;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
    hud.push(
      queryAll(mounted.container, '.oyl-hud__field')
        .map((field) => field.textContent ?? '')
        .join(' | '),
    );
  }
  await settle();
  const odometer = built.simulations.at(-1)?.state.ride.distance ?? Number.NaN;
  mounted.unmount();
  mounted = undefined;
  return { rendered, written, odometer, hud };
}

describe('the scenery cyclists never reach the trainer — #2722', () => {
  it('writes the same simulation parameters on the same frames with them on and off', async () => {
    const on = await ride(false);
    const off = await ride(true);
    // The control: the realistic world drew them in the first ride and none in the second.
    const carried = (ridden: Ridden): number =>
      ridden.rendered.filter((frame) => (frame.cyclists?.length ?? 0) > 0).length;
    expect(carried(on)).toBeGreaterThan(FRAMES / 2);
    expect(carried(off)).toBe(0);
    expect(on.rendered.some((frame) => (frame.people?.near.length ?? -1) >= 0)).toBe(true);
    // And the ride is the same: the same trainer writes on the same frames,
    // the same odometer, the same HUD on every frame.
    expect(on.written.length).toBeGreaterThan(10);
    expect(off.written).toStrictEqual(on.written);
    expect(on.odometer).toBeGreaterThan(20);
    expect(off.odometer).toBe(on.odometer);
    expect(off.hud).toEqual(on.hud);
  });
});
