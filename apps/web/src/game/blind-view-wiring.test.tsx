// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A view with no drawing context is handed no frame after the one it is
 * prepared with, and the ride is otherwise the same** — #2524.
 *
 * `port.ts` §`hasContext`: a view whose WebGL context could not be had draws
 * nothing (`three-renderer.ts` §`render` returns at once), and the ride goes on
 * as a HUD over no world. `GameView` therefore builds that view no frame once
 * it is prepared: the frame was most of a frame's work, built for nobody. The
 * trainer gates ride such a view, so this file is what says it changes nothing
 * a trainer is sent.
 *
 * The same scripted ride is ridden twice through the real `GameView`, once
 * into a view that draws and once into one that cannot, and what is read is
 * what each consumer was handed: every simulation parameter written to the
 * trainer with the frame it was written on, the odometer the simulation
 * reached, and the HUD's figures on every frame.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { northRoute } from './route-fixtures-testing';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

/** Every `GameSimulation` built, newest last, so a ride's odometer can be read. */
const built = vi.hoisted(
  () => [] as Array<{ readonly state: { readonly ride: { readonly distance: number } } }>,
);

vi.mock('./simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulation')>();
  class KeptSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      built.push(this);
    }
  }
  return { ...actual, GameSimulation: KeptSimulation };
});

const START_MS = 1_000_000;
/** Four frames a second: several simulation steps a frame. */
const FRAME_MS = 250;
/** Fifteen seconds of ride: enough grades written to compare. */
const FRAMES = 60;

/** A road that climbs and falls, so the trainer is written often. */
const ROUTE: RidableRoute = {
  id: 'north',
  name: 'North road',
  profile: northRoute(2_000, (along) => 12 * Math.sin(along / 60)),
  attempts: 0,
};

/** The scripted power: a function of the ride's clock alone, the same in both rides. */
function powerAt(nowMs: number): number {
  return 260 + 80 * Math.sin((nowMs - START_MS) / 2_000);
}

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
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

/** What one view was handed. */
interface Handed {
  prepared: number;
  rendered: SceneFrame[];
}

function renderer(hasContext: boolean, handed: Handed): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext,
      prepare: () => {
        handed.prepared += 1;
        return Promise.resolve();
      },
      render: (frame: SceneFrame) => {
        handed.rendered.push(frame);
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
  readonly handed: Handed;
  readonly written: readonly unknown[];
  readonly odometer: number;
  /** The HUD's fields as the rider reads them, frame by frame. */
  readonly hud: readonly string[];
}

async function ride(hasContext: boolean): Promise<Ridden> {
  pending = [];
  nowMs = START_MS;
  const handed: Handed = { prepared: 0, rendered: [] };
  const written: unknown[] = [];
  let frame = 0;
  built.length = 0;
  mounted = await mount(
    <GameView
      port={PORT}
      trainer={trainerPort(written, () => frame)}
      renderer={() => Promise.resolve(renderer(hasContext, handed))}
      now={() => nowMs}
    />,
  );
  await settle();
  const start = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  await act(async () => {
    start?.click();
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
  const odometer = built.at(-1)?.state.ride.distance ?? Number.NaN;
  mounted.unmount();
  mounted = undefined;
  return { handed, written, odometer, hud };
}

describe('a view with no drawing context — #2524', () => {
  it('is prepared once and handed no frame after it, where a view that draws is handed one a frame', async () => {
    const drawing = await ride(true);
    const blind = await ride(false);
    // The control: the view that draws is prepared once and handed every
    // frame after it, so the ride did ask for frames.
    expect(drawing.handed.prepared).toBe(1);
    expect(drawing.handed.rendered.length).toBeGreaterThan(FRAMES - 5);
    // The view that cannot draw is still prepared, with one frame, and handed none.
    expect(blind.handed.prepared).toBe(1);
    expect(blind.handed.rendered).toEqual([]);
    // And the ride is the same: the same trainer writes on the same frames,
    // the same odometer, the same HUD on every frame.
    expect(drawing.written.length).toBeGreaterThan(10);
    expect(blind.written).toStrictEqual(drawing.written);
    expect(drawing.odometer).toBeGreaterThan(20);
    expect(blind.odometer).toBe(drawing.odometer);
    expect(drawing.hud.every((line) => line.length > 0)).toBe(true);
    expect(blind.hud).toEqual(drawing.hud);
  });
});
