// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A directed pacer replays from the ride it was saved with** — #2712's
 * review of ADR 0072 D-5.1: *"a directed pacer is a pure function of the
 * route, its plan and the decision log"*, and the Consequences' *"the route,
 * the W/kg, the log and the version are the whole of"* what it did.
 *
 * One ride through the shipped path: `GameView` with the real picker, a real
 * ride controller over the simulated FTMS trainer that saves into the real
 * store, the pacer at 2.9 W/kg in a wind, and the AI pacer switched on and
 * consented to through a `GamePort.aiPacer` double whose answers change from
 * ask to ask — and which, for a stretch, gives none, so a decision lapses and
 * the pacer rides #92's own rule until the next one. The ride is saved.
 *
 * Then, as a consumer would, the ride is read back from the store on its
 * rider's own read (`getActivity`), and the pacer's course re-derived from
 * nothing but `RideFacts.pacerModel` and the route its `routeId` names:
 * `advanceBot` at the simulation's fixed step, with the direction in force at
 * each step read off the stored log by `@onyourleft/domain`
 * §`pacerDirectionAt`. That course must be the live pacer's, step for step,
 * to the bit — and placed on the recording's clock by the log's `startedAt`.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_MASS_KILOGRAMS,
  botPacerPlan,
  headwindOnRoute,
  kilograms,
  MODEL_PACER_CODE_VERSION,
  pacerDirectionAt,
  seconds,
  watts,
  type PacerDirection,
  type RouteProfile,
} from '@onyourleft/domain';
import { advanceBot, BOT_AT_START_LINE, type BotCourse } from '@onyourleft/physics';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import {
  activityId,
  lapId,
  recordingSessionId,
  type ActivityRecord,
  type PacerModelFact,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';

import type { PacerPort, PacerReply, PacerStatus } from '../instance/pacer-port';
import type { RecordingCheckpointStore } from '../recording/recorder';
import { createRideController, type RideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { endRideAnswer } from './end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import { rideConditionsFor } from './rider';
import { rollingRoute } from './route-fixtures-testing';
import { SIMULATION_STEP_SECONDS, type GameState } from './simulation';
import { gameTrainerPortOver } from './trainer-port';

const seen = vi.hoisted(() => ({
  simulations: [] as Array<{ readonly state: GameState }>,
}));

vi.mock('./simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulation')>();
  class WatchedSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      seen.simulations.push(this);
    }
  }
  return { ...actual, GameSimulation: WatchedSimulation };
});

const FRAME_MS = 230;
const FRAMES = 300;
const PACER_INTENSITY = '2.9';
const WIND_SPEED = '15';
const WIND_FROM = '200';
const ROUTE_ID = 'route-rolling';
const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

/** What the double answers, ask by ask: changing directions, and none for asks 5 to 9. */
const DIRECTIONS: readonly PacerDirection[] = [
  { plan: 'climber', intent: 'lift' },
  { plan: 'even', intent: 'ease' },
  { plan: 'rolling', intent: 'lift' },
  { plan: 'climber', intent: 'hold' },
];

function replyTo(ask: number): PacerReply {
  if (ask >= 5 && ask <= 9) return { kind: 'failed' };
  if (ask === 11) return { kind: 'invalid' };
  return {
    kind: 'answer',
    direction: DIRECTIONS[ask % DIRECTIONS.length]!,
    say: 'Stay with me.',
  };
}

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
let controller: RideController | undefined;
let harness: StoreHarness | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  seen.simulations = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  controller?.dispose();
  controller = undefined;
  await harness?.destroy();
  harness = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

function tracePower(atMs: number): number {
  const t = (atMs - 1_000_000) / 1000;
  return Math.round(230 + 90 * Math.sin((2 * Math.PI * t) / 37) + 40 * Math.sin(t / 1.7));
}

function aiPacerPort(): PacerPort {
  let consented = false;
  let asks = 0;
  const status = (): PacerStatus => ({
    kind: 'offered',
    instance: 'https://ride.example',
    modelAddress: 'http://127.0.0.1:11434/v1',
    consented,
  });
  return {
    offered: () => true,
    pacerStatus: () => Promise.resolve(status()),
    consentToPacer: () => {
      consented = true;
      return Promise.resolve(status());
    },
    withdrawPacerConsent: () => {
      consented = false;
      return Promise.resolve(status());
    },
    startPacerRide: () => Promise.resolve(true),
    decidePacer: () => {
      const reply = replyTo(asks);
      asks += 1;
      return Promise.resolve(reply);
    },
    endPacerRide: () => Promise.resolve(),
  };
}

function tracedPort(route: RidableRoute, aiPacer: PacerPort): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(tracePower(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
    aiPacer,
  };
}

function blankRenderer(): GameRenderer {
  return {
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
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await settle();
}

async function press(element: HTMLElement | undefined): Promise<void> {
  if (element === undefined) throw new Error('no such control');
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await flush();
}

function buttonStarting(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith(words),
  );
}

function toggle(words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="checkbox"]').find(
    (input) => (input.closest('label')?.textContent ?? '').includes(words),
  );
}

function labelledStarting(words: string): HTMLInputElement {
  const label = queryAll<HTMLLabelElement>(mounted?.container ?? document, 'label').find(
    (candidate) => (candidate.textContent ?? '').startsWith(words),
  );
  const control = label?.control;
  if (!(control instanceof HTMLInputElement)) throw new Error(`no control labelled “${words}”`);
  return control;
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    setter?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

/** The live pacer at one frame: the seconds ridden, and its odometer. */
interface Seen {
  readonly ridden: number;
  readonly distance: number;
}

interface Ridden {
  readonly saved: ActivityRecord | undefined;
  readonly live: readonly Seen[];
  /** The recording's clock and the seconds ridden when the controller kept its first record. */
  readonly firstKept: { readonly clock: number; readonly arrivedAtS: number } | undefined;
}

async function rideAndSave(): Promise<Ridden> {
  const store = createStoreHarness();
  harness = store;
  await seedAthletes(store);
  const profile = rollingRoute();
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  let minted = 0;
  const own = createRideController({
    transport,
    store: CHECKPOINTS,
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-2712-replay'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written: [] }),
    rideSave: {
      newActivityId: () => {
        minted += 1;
        return activityId(`ride-${String(minted)}`);
      },
      newLapId: () => {
        minted += 1;
        return lapId(`lap-${String(minted)}`);
      },
      timeZone: 'Europe/London',
      store: {
        putFinishedRide: async (ride) => store.write(async (each) => each.putFinishedRide(ride)),
      },
    },
  });
  let firstKept: Ridden['firstKept'];
  const kept = own.notePacerDecision.bind(own);
  const watched: RideController = {
    ...own,
    notePacerDecision: (record, ride) => {
      const phase = own.getSnapshot().phase;
      if (firstKept === undefined && phase === 'recording' && record.arrivedAtS !== null) {
        firstKept = { clock: bench.now, arrivedAtS: record.arrivedAtS };
      }
      kept(record, ride);
    },
  };
  controller = own;
  await own.pair('trainer');
  mounted = await mount(
    <GameView
      port={tracedPort({ id: ROUTE_ID, name: 'Rolling', profile, attempts: 0 }, aiPacerPort())}
      trainer={gameTrainerPortOver(watched)}
      renderer={() => Promise.resolve(blankRenderer())}
      now={() => nowMs}
    />,
  );
  await settle();
  await press(toggle('Ride against a pacer'));
  await typeInto(labelledStarting('Pacer intensity, watts per kilogram'), PACER_INTENSITY);
  await press(toggle('Ride in a wind'));
  await typeInto(labelledStarting('Wind speed'), WIND_SPEED);
  await typeInto(labelledStarting('Wind direction'), WIND_FROM);
  await press(toggle('Let the AI on your instance steer the pacer'));
  await press(buttonStarting('Allow the AI pacer'));
  await press(buttonStarting('Ride '));

  const live: Seen[] = [];
  for (let frame = 1; frame <= FRAMES; frame += 1) {
    const next = pending.shift();
    if (next === undefined)
      throw new Error(`the ride stopped asking for frames at ${String(frame)}`);
    nowMs += FRAME_MS;
    await act(async () => {
      if (Math.floor(nowMs / 1000) > Math.floor((nowMs - FRAME_MS) / 1000)) {
        bench.advance(seconds(1));
      }
      next(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    const state = seen.simulations.at(-1)?.state;
    if (state?.bot !== undefined) {
      live.push({ ridden: state.ridden, distance: state.bot.state.distance });
    }
  }

  await press(buttonStarting('End ride'));
  await press(endRideAnswer(document, 'Save ride'));
  // The save settles in its own time under a loaded suite: wait for it, a
  // bounded number of turns, as `trainer-wiring.test.tsx` does.
  for (let index = 0; index < 100; index += 1) {
    const now = own.getSnapshot();
    if (!now.stopping && now.saveState !== 'saving' && now.saveState !== 'unavailable') break;
    await settle();
  }
  const id = own.getSnapshot().savedRide?.activityId;
  const saved =
    id === undefined ? undefined : await store.read((each) => each.getActivity(ATHLETE_A, id));
  return { saved, live, firstKept };
}

const ROUTES: ReadonlyMap<string, RouteProfile> = new Map([[ROUTE_ID, rollingRoute()]]);

/**
 * The pacer's course re-derived from a stored log alone: its odometer at each
 * of `at` seconds ridden, stepped at the simulation's fixed step by
 * `advanceBot`, the direction in force at each step read off the log by
 * `pacerDirectionAt`, in the air and position the log says.
 */
function replayed(log: PacerModelFact, at: readonly number[]): readonly Seen[] {
  const profile = ROUTES.get(log.routeId);
  if (profile === undefined) throw new Error('the log names a route this test does not have');
  // The rider's mass does not reach the pacer: only the position's drag area and the air do.
  const conditions = rideConditionsFor(kilograms(BOT_MASS_KILOGRAMS), log.position);
  const course: BotCourse = {
    profile,
    plan: botPacerPlan(log.pacerWPerKg),
    airDensityKilogramsPerCubicMetre: conditions.airDensityKilogramsPerCubicMetre,
    ...(conditions.coefficients === undefined ? {} : { coefficients: conditions.coefficients }),
  };
  const out: Seen[] = [];
  let state = BOT_AT_START_LINE;
  let step = 0;
  for (const ridden of at) {
    while (step * SIMULATION_STEP_SECONDS < ridden - SIMULATION_STEP_SECONDS / 2) {
      const direction = pacerDirectionAt(log.decisions, step * SIMULATION_STEP_SECONDS);
      const wind = log.wind;
      state = advanceBot(state, seconds(SIMULATION_STEP_SECONDS), {
        ...course,
        ...(wind === undefined
          ? {}
          : { headwindMetresPerSecond: headwindOnRoute(profile, state.distance, wind) }),
        ...(direction === undefined ? {} : { direction }),
      }).state;
      step += 1;
    }
    out.push({ ridden, distance: state.distance });
  }
  return out;
}

describe('a directed pacer replays from its saved ride — #2712’s review, ADR 0072 D-5.1', () => {
  it('re-derives the live pacer’s course, step for step, from the stored log, read back from the store', async () => {
    const { saved, live, firstKept } = await rideAndSave();
    expect(saved?.id).toBeDefined();
    const log = saved?.rideFacts?.pacerModel;
    expect(log).toBeDefined();
    if (log === undefined) return;

    // The log is the one this ride rode: a version, and what it replays with.
    expect(log.version).toBe(MODEL_PACER_CODE_VERSION);
    expect(log.pacerWPerKg).toBe(Number(PACER_INTENSITY));
    expect(log.routeId).toBe(ROUTE_ID);
    expect(log.wind?.fromBearing).toBe(Number(WIND_FROM));
    // Applied, failed for a stretch and invalid: so the replay rides a
    // change of direction, a lapse to #92's rule, and a miss.
    const outcomes = new Set(log.decisions.map((each) => each.outcome));
    expect([...outcomes].sort()).toStrictEqual(['applied', 'failed', 'invalid']);

    // The live course, to the bit, from the stored record alone.
    expect(live.length).toBeGreaterThan(200);
    expect(
      replayed(
        log,
        live.map((each) => each.ridden),
      ),
    ).toStrictEqual(live);

    // Placed on the recording's clock: the ride's start, inside the saved
    // recording, is the recording's clock less the seconds ridden when the
    // first kept decision arrived — so a decision's instant in the recording
    // is the start plus its seconds ridden.
    expect(firstKept).toBeDefined();
    expect(log.startedAt).toBe(firstKept!.clock - firstKept!.arrivedAtS);
    expect(log.startedAt).toBeGreaterThanOrEqual(saved!.startedAt - 1);
    expect(log.startedAt).toBeLessThanOrEqual(saved!.startedAt + saved!.elapsedTime);
  });
});
