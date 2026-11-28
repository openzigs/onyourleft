// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A group ride reaches no trainer write** — the `group-ride-cannot-reach-trainer`
 * gate of ADR 0101 D-6.6 and the owner's ruling 4 of 2026-11-26. **This is
 * its first case (#3303); #3307 adds the presses and #3308 completes it**
 * (ERG, the worst case, the release through the Ride screen) and names it in
 * `docs/agents/game.md` beside the others.
 *
 * ## The first case: simulation mode, write for write
 *
 * A draft changes WHEN a grade arrives, never WHAT is sent (ADR 0067 D-3.3):
 * a sheltered rider reaches the next rise sooner. So a ride with the group is
 * not compared with a ride alone, whose grades arrive later. It is compared
 * with **the same ride at the same draft factors without the group**:
 *
 * 1. **With the group.** The real picker, *Ride with a group* switched on,
 *    the real *Ride*, a ready trainer through the real `gameTrainerPortOver`.
 *    Every factor `GameView` hands `GameSimulation.draftWith` is kept, in
 *    order, by wrapping the real class.
 * 2. **Without it, at those factors.** The same picker with the switch left
 *    off, the same power on the same frames. `GameView` hands this ride no
 *    draft at all, so the wrapped class hands it the kept factors, one after
 *    each frame whose steps ran, which is when the first ride was handed them.
 * 3. **Alone**, with neither, to show that the factors matter: its writes
 *    differ, so the equality above is not two rides that never drafted.
 *
 * **Every write of 1 equals the write of 2 at the same place in the order**:
 * each Set Indoor Bike Simulation Parameters the gradient session sent, and
 * the release when the ride is left. The group stepped, rotated, waited and
 * was drawn through the whole of 1, and not a write moved.
 *
 * The existing gates (`draft-cannot-reach-trainer.test.tsx`,
 * `solo-draft-cannot-reach-trainer.test.tsx`,
 * `lap-race/lap-race-cannot-reach-trainer.test.ts`) are kept green unmodified.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import { ANNOUNCEMENTS_STORAGE_KEY } from '../hud/announce-preference';
import type { GameRenderer } from '../port';
import { northRoute } from '../route-fixtures-testing';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from '../trainer-port';

/** What the wrapped simulation kept and was told to replay, for one ride. */
const seen = vi.hoisted(() => ({
  /** Every factor the ride handed `draftWith`, in order. */
  given: [] as number[],
  /** Factors to hand a ride that is handed none, or `undefined` to hand nothing. */
  replay: undefined as readonly number[] | undefined,
  replayed: 0,
  /** The newest simulation's odometer, read after each frame. */
  odometer: () => Number.NaN,
}));

vi.mock('../simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../simulation')>();
  class WatchedSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      seen.odometer = () => this.state.ride.distance;
    }

    override draftWith(k: number): void {
      seen.given.push(k);
      super.draftWith(k);
    }

    override advanceTo(
      ...args: Parameters<InstanceType<typeof actual.GameSimulation>['advanceTo']>
    ) {
      const tick = super.advanceTo(...args);
      // A ride with no group is handed no draft by `GameView`: hand it the
      // kept one where the grouped ride was handed its own, after a frame
      // whose steps ran, to be ridden from the next step on.
      if (seen.replay !== undefined && tick.steps > 0) {
        const k = seen.replay[seen.replayed];
        seen.replayed += 1;
        if (k !== undefined) super.draftWith(k);
      }
      return tick;
    }
  }
  return { ...actual, GameSimulation: WatchedSimulation };
});

/** A rolling road of the rider's own: 3 m up and down every 300 m, so the grade the trainer is sent keeps changing. */
const ROUTE: RidableRoute = {
  id: 'route-rolling',
  name: 'Rolling',
  profile: northRoute(4_000, (along) => 3 * Math.sin((along / 300) * Math.PI * 2)),
  attempts: 0,
};

const port: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(150), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

/** A view with no drawing context (#2524): the frame is built once and the ride is ridden in full. */
const renderer: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => ({
    hasContext: false,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

/** One thing the trainer was sent. */
type Write =
  | { readonly kind: 'simulation'; readonly parameters: SimulationParameters }
  | { readonly kind: 'release' };

/** A ready trainer in simulation mode through the real `gameTrainerPortOver`, keeping everything it is sent. */
function writingTrainer(written: Write[]): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: (parameters) => {
      written.push({ kind: 'simulation', parameters });
      return Promise.resolve();
    },
    letGo: () => {
      written.push({ kind: 'release' });
      return Promise.resolve({ kind: 'stopped' as const });
    },
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
      workout: undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

const FRAME_MS = 250;
/** Sixty seconds: the rider crosses a rise and a fall of the road. */
const FRAMES = 240;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  seen.given = [];
  seen.replay = undefined;
  seen.replayed = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({
      enabled: false,
      powerEverySeconds: 'never',
      distanceEvery: 'never',
      intervalLeadSeconds: 'never',
      climbLeadMetres: 'never',
    }),
  );
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  expect(element).toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

interface Run {
  /** Everything the trainer was sent, in order, the release included. */
  readonly written: readonly Write[];
  /** Every factor the ride itself handed the simulation. */
  readonly given: readonly number[];
  /** Where the rider was when the ride was left, metres. */
  readonly distance: number;
}

/** Ride {@link FRAMES} frames from the real picker and leave; `replay` hands a groupless ride these factors. */
async function rideWith(group: boolean, replay?: readonly number[]): Promise<Run> {
  seen.given = [];
  seen.replay = replay;
  seen.replayed = 0;
  const written: Write[] = [];
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer)}
      trainer={writingTrainer(written)}
      now={() => nowMs}
    />,
  );
  await settle();
  if (group) {
    await clickThrough(
      queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find((input) =>
        (input.closest('label')?.textContent ?? '').includes('Ride with a group'),
      ),
    );
  }
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const next = pending.shift();
    if (next === undefined)
      throw new Error(`the ride stopped asking for frames at ${String(frame)}`);
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  await settle();
  const distance = seen.odometer();
  const given = [...seen.given];
  // Leaving the ride releases the trainer, as any game ride does.
  mounted.unmount();
  mounted = undefined;
  await settle();
  return { written: [...written], given, distance };
}

/**
 * Each ride, ridden once by the first case that asks for it and read by every
 * case after, so a case pays for one ride (#1688's ruling: a slow case is
 * made cheaper, never given a longer timeout).
 */
const runs = new Map<string, Promise<Run>>();
function ridden(name: 'grouped' | 'replayed' | 'alone'): Promise<Run> {
  let run = runs.get(name);
  if (run === undefined) {
    run =
      name === 'grouped'
        ? rideWith(true)
        : name === 'alone'
          ? rideWith(false)
          : ridden('grouped').then((grouped) => rideWith(false, grouped.given));
    runs.set(name, run);
    run.catch(() => runs.delete(name));
  }
  return run;
}

const grades = (run: Run): number[] =>
  run.written.flatMap((write) => (write.kind === 'simulation' ? [write.parameters.grade] : []));

describe('a group ride reaches no trainer write in simulation mode — #3303, ADR 0101 D-6.6', () => {
  it('rides with the group: the rider is sheltered, and the trainer is sent the road', async () => {
    const grouped = await ridden('grouped');
    // The rider WAS drafted, so nothing below can pass because the group never took effect.
    expect(grouped.given.length).toBeGreaterThan(FRAMES / 2);
    expect(Math.min(...grouped.given)).toBeLessThan(0.7);
    // And the trainer was sent a road that rises and falls, many times over.
    const sent = grades(grouped);
    expect(sent.length).toBeGreaterThan(15);
    expect(Math.max(...sent)).toBeGreaterThan(2);
    expect(Math.min(...sent)).toBeLessThan(-2);
  });

  it('rides alone: no factor is handed, the rider is slower, and the grades arrive differently', async () => {
    const grouped = await ridden('grouped');
    const alone = await ridden('alone');
    expect(alone.given).toStrictEqual([]);
    expect(grouped.distance).toBeGreaterThan(alone.distance + 10);
    expect(alone.written).not.toStrictEqual(grouped.written);
  });

  it('sends the same writes, write for write, as the same ride at the same draft factors without the group', async () => {
    const grouped = await ridden('grouped');
    const replayed = await ridden('replayed');
    // The groupless ride was handed nothing by the game, and every kept factor by this file.
    expect(replayed.given).toStrictEqual([]);
    expect(seen.replayed).toBe(grouped.given.length);
    expect(replayed.distance).toBe(grouped.distance);
    expect(replayed.written.length).toBe(grouped.written.length);
    grouped.written.forEach((write, index) => {
      expect(replayed.written[index], `write ${String(index)}`).toStrictEqual(write);
    });
    // The release too: leaving a group ride lets the trainer go exactly as leaving any ride does.
    expect(grouped.written.filter((write) => write.kind === 'release').length).toBeGreaterThan(0);
    expect(grouped.written.at(-1)).toStrictEqual({ kind: 'release' });
  });
});
