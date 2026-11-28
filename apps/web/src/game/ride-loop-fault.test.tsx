// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A throw inside a frame neither freezes the ride nor leaves a load on the
 * rider** — #3404. `GameView`'s loop asks for the next frame only at the end
 * of the one it is running, so before #3404 a throw anywhere in it escaped,
 * the next frame was never asked for, and the trainer was left holding the
 * last grade it was sent.
 *
 * Three rides through the real picker, the real *Ride* and a ready trainer in
 * simulation mode through the real `gameTrainerPortOver`, keeping everything
 * the trainer is sent:
 *
 * 1. **A mode's step throws** (the group ride's, which #3378's review found
 *    can): the group ride ends, the loop keeps asking for frames, the trainer
 *    keeps being sent the road, nothing is released until the ride is left,
 *    and the rider is told.
 * 2. **The core throws** (the simulation's own step): the trainer is let go at
 *    once, as *End ride* lets a game ride go, the loop stops, and the rider is
 *    told. *End ride* still ends the ride.
 * 3. **The core throws during a group ride**: a frame cannot say which threw,
 *    so the group ride ends first, and the next frame, which throws with no
 *    mode left, lets the trainer go.
 *
 * Each logs a line naming what ended and the error's class, and never the
 * error's message, which here carries a coordinate (ADR 0004 D).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY } from './hud/announce-preference';
import { PULL_OFF_BUTTON_LABEL } from './hud/GroupRideControls';
import type { LapRaceChoice } from './lap-race/choice';
import type { GameRenderer } from './port';
import { modeEndedText, RIDE_STOPPED_LABEL, rideStoppedText } from './ride-fault';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

/** A message that carries a coordinate, as a step's own `RangeError` could. */
const COORDINATE = '51.501364';
const COORDINATE_MESSAGE = `no line at ${COORDINATE}, -0.14189`;

/** Which step throws, and how often each ran. */
const faults = vi.hoisted(() => ({
  /** The group ride's step throws while this is set. */
  groupStep: false,
  /** The simulation's step throws while this is set. */
  simulationStep: false,
  /** How many times the group ride's step was called. */
  groupSteps: 0,
  /** The lap race's step throws while this is set. */
  raceStep: false,
  /** How many times the lap race's step was called. */
  raceSteps: 0,
  /** The last draft factor the ride handed the simulation. */
  lastDraft: Number.NaN,
}));

vi.mock('./lap-race/ride-race', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lap-race/ride-race')>();
  return {
    ...actual,
    stepLapRaceRide: (...args: Parameters<typeof actual.stepLapRaceRide>) => {
      faults.raceSteps += 1;
      if (faults.raceStep) throw new RangeError(COORDINATE_MESSAGE);
      return actual.stepLapRaceRide(...args);
    },
  };
});

vi.mock('./group-ride/ride-group', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./group-ride/ride-group')>();
  return {
    ...actual,
    stepGroupRideSession: (...args: Parameters<typeof actual.stepGroupRideSession>) => {
      faults.groupSteps += 1;
      if (faults.groupStep) throw new RangeError(COORDINATE_MESSAGE);
      return actual.stepGroupRideSession(...args);
    },
  };
});

vi.mock('./simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulation')>();
  class FaultySimulation extends actual.GameSimulation {
    override advanceTo(
      ...args: Parameters<InstanceType<typeof actual.GameSimulation>['advanceTo']>
    ) {
      if (faults.simulationStep) throw new TypeError(COORDINATE_MESSAGE);
      return super.advanceTo(...args);
    }

    override draftWith(k: number): void {
      faults.lastDraft = k;
      super.draftWith(k);
    }
  }
  return { ...actual, GameSimulation: FaultySimulation };
});

/** A rolling road: 3 m up and down every 300 m, so the grade the trainer is sent keeps changing. */
const ROUTE: RidableRoute = {
  id: 'route-rolling',
  name: 'Rolling',
  profile: northRoute(4_000, (along) => 3 * Math.sin((along / 300) * Math.PI * 2)),
  attempts: 0,
};

/** A loop of about 250 m that climbs and falls, for a lap race. */
const LOOP: RidableRoute = {
  id: 'lap-race',
  name: 'Race loop',
  profile: circuitRoute(40, (along) => 2.5 * Math.sin((along / (2 * Math.PI * 40)) * 2 * Math.PI)),
  attempts: 0,
};

let routeNow: RidableRoute = ROUTE;

const port: GamePort = {
  listRoutes: () => Promise.resolve([routeNow]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
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
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
let logged: MockInstance<typeof console.error>;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  faults.groupStep = false;
  faults.simulationStep = false;
  faults.groupSteps = 0;
  faults.raceStep = false;
  faults.raceSteps = 0;
  faults.lastDraft = Number.NaN;
  routeNow = ROUTE;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
  logged.mockRestore();
  vi.unstubAllGlobals();
});

const root = (): HTMLElement => mounted?.container ?? document.body;

const hudButton = (name: string): HTMLButtonElement | undefined =>
  queryAll<HTMLButtonElement>(root(), 'button').find((button) => button.textContent === name);

/** The lines this loop logged, and nothing React logged. */
const faultLines = (): string[] =>
  logged.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith('On Your Left:'));

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  expect(element).toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

/**
 * One quarter-second frame: every callback waiting, the HUD's one gamepad
 * poll included (it finds no pad and asks for no more). Whether the RIDE
 * asked for the next is {@link rideAsks}.
 */
async function oneFrame(): Promise<void> {
  const due = pending;
  pending = [];
  nowMs += FRAME_MS;
  await act(async () => {
    for (const next of due) next(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Whether a frame is waiting: the ride's loop asked for one. */
const rideAsks = (): boolean => pending.length > 0;

/** Mount the picker with the trainer keeping `written`, choose the group or not, and press *Ride*. */
async function startRide(written: Write[], group: boolean, lapRace?: LapRaceChoice): Promise<void> {
  mounted = await mount(
    <GameView
      {...(lapRace === undefined ? {} : { lapRace })}
      port={port}
      renderer={() => Promise.resolve(renderer)}
      trainer={writingTrainer(written)}
      now={() => nowMs}
    />,
  );
  await settle();
  if (group) {
    await clickThrough(
      queryAll<HTMLInputElement>(root(), 'input[type="checkbox"]').find((input) =>
        (input.closest('label')?.textContent ?? '').includes('Ride with a group'),
      ),
    );
  }
  await clickThrough(
    queryAll<HTMLButtonElement>(root(), 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
}

const releases = (written: readonly Write[]): number =>
  written.filter((write) => write.kind === 'release').length;
const grades = (written: readonly Write[]): number =>
  written.filter((write) => write.kind === 'simulation').length;

describe('a throw inside a frame of the ride — #3404', () => {
  it("ends the mode whose step threw, and the ride, the loop and the trainer's road go on", async () => {
    const written: Write[] = [];
    await startRide(written, true);
    for (let frame = 0; frame < 40; frame += 1) await oneFrame();
    // The group is riding: its step runs and its control is on the HUD.
    expect(faults.groupSteps).toBeGreaterThan(30);
    expect(hudButton(PULL_OFF_BUTTON_LABEL)).toBeDefined();
    // ...and the rider is sheltered in its line.
    expect(faults.lastDraft).toBeLessThan(1);
    const gradesBefore = grades(written);
    expect(gradesBefore).toBeGreaterThan(0);

    faults.groupStep = true;
    await oneFrame();
    const stepsAtTheThrow = faults.groupSteps;
    // Two minutes more: the loop asked for every one of them.
    for (let frame = 0; frame < 480; frame += 1) {
      expect(rideAsks(), `the ride stopped asking for frames at ${String(frame)}`).toBe(true);
      await oneFrame();
    }
    await settle();

    // The mode ended: its step is never run again and its control is gone.
    expect(faults.groupSteps).toBe(stepsAtTheThrow);
    expect(hudButton(PULL_OFF_BUTTON_LABEL)).toBeUndefined();
    // Its shelter went with it: the rider rides alone.
    expect(faults.lastDraft).toBe(1);
    // The ride went on: the road kept reaching the trainer, nothing let it
    // go, and *End ride* is still there.
    expect(grades(written)).toBeGreaterThan(gradesBefore);
    expect(releases(written)).toBe(0);
    expect(hudButton('End ride')).toBeDefined();
    expect(root().textContent).not.toContain(RIDE_STOPPED_LABEL);
    // Said, and logged once by what ended and the error's class alone.
    expect(root().textContent).toContain(modeEndedText(['group-ride']));
    expect(faultLines()).toStrictEqual([
      "On Your Left: a fault in the ride's frame (RangeError) ended the group ride; the ride goes on.",
    ]);
    expect(logged.mock.calls.flat().join(' ')).not.toContain(COORDINATE);

    // Leaving the ride lets the trainer go, once, as any game ride does.
    mounted?.unmount();
    mounted = undefined;
    await settle();
    expect(releases(written)).toBe(1);
  });

  it('ends a lap race whose step threw, and the rider rides on alone', async () => {
    const written: Write[] = [];
    routeNow = LOOP;
    await startRide(written, false, { laps: 2, bots: 3, tier: 'hard', itemsOn: false });
    // Ten seconds on the line, and ten racing.
    for (let frame = 0; frame < 80; frame += 1) await oneFrame();
    expect(faults.raceSteps).toBeGreaterThan(20);
    const standings = (): Element | null => root().querySelector('.oyl-hud__standings');
    expect(standings()).not.toBeNull();
    const gradesBefore = grades(written);

    faults.raceStep = true;
    await oneFrame();
    const stepsAtTheThrow = faults.raceSteps;
    for (let frame = 0; frame < 120; frame += 1) {
      expect(rideAsks(), `the ride stopped asking for frames at ${String(frame)}`).toBe(true);
      await oneFrame();
    }
    await settle();

    expect(faults.raceSteps).toBe(stepsAtTheThrow);
    expect(standings()).toBeNull();
    expect(grades(written)).toBeGreaterThan(gradesBefore);
    expect(releases(written)).toBe(0);
    expect(root().textContent).toContain(modeEndedText(['lap-race']));
    expect(faultLines()).toStrictEqual([
      "On Your Left: a fault in the ride's frame (RangeError) ended the lap race; the ride goes on.",
    ]);
  });

  it('lets the trainer go and stops the loop when the core of the ride throws', async () => {
    const written: Write[] = [];
    await startRide(written, false);
    for (let frame = 0; frame < 40; frame += 1) await oneFrame();
    expect(grades(written)).toBeGreaterThan(0);
    expect(releases(written)).toBe(0);

    faults.simulationStep = true;
    await oneFrame();
    await settle();

    // Released at once, while the ride is still on the stage, and the loop
    // asked for no frame after the one that threw.
    expect(releases(written)).toBe(1);
    expect(written.at(-1)?.kind).toBe('release');
    expect(rideAsks()).toBe(false);
    // Told, and logged without the coordinate the message carried.
    expect(root().textContent).toContain(RIDE_STOPPED_LABEL);
    expect(root().textContent).toContain(rideStoppedText(true));
    expect(faultLines()).toStrictEqual([
      "On Your Left: a fault in the ride's frame (TypeError) stopped the ride.",
    ]);
    expect(logged.mock.calls.flat().join(' ')).not.toContain(COORDINATE);

    // *End ride* still ends it, and sends no second release.
    await clickThrough(hudButton('End ride'));
    await clickThrough(
      queryAll<HTMLButtonElement>(root(), 'button').find(
        (button) => button.textContent === 'End ride',
      ),
    );
    // Back on the picker, with nothing of the fault standing.
    expect(hudButton('End ride')).toBeUndefined();
    expect(
      queryAll<HTMLButtonElement>(root(), 'button').some((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      ),
    ).toBe(true);
    expect(root().textContent).not.toContain(RIDE_STOPPED_LABEL);
    expect(releases(written)).toBe(1);
  });

  it('ends a running mode first, and lets the trainer go when the next frame throws with none', async () => {
    const written: Write[] = [];
    await startRide(written, true);
    for (let frame = 0; frame < 40; frame += 1) await oneFrame();
    expect(hudButton(PULL_OFF_BUTTON_LABEL)).toBeDefined();

    faults.simulationStep = true;
    await oneFrame();
    // The frame could not say which threw: the group ended, and the loop went on.
    expect(hudButton(PULL_OFF_BUTTON_LABEL)).toBeUndefined();
    expect(releases(written)).toBe(0);
    expect(rideAsks()).toBe(true);

    await oneFrame();
    await settle();
    expect(releases(written)).toBe(1);
    expect(rideAsks()).toBe(false);
    expect(root().textContent).toContain(rideStoppedText(true));
    expect(faultLines()).toStrictEqual([
      "On Your Left: a fault in the ride's frame (TypeError) ended the group ride; the ride goes on.",
      "On Your Left: a fault in the ride's frame (TypeError) stopped the ride.",
    ]);
  });
});
