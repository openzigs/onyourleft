// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A solo draft changes the rider's simulated speed and nothing else** —
 * #2425's runs of #2423's trainer gate, for ADR 0066 D-1 and D-4 (and ADR 0038
 * D-1 and D-4, ADR 0059 D-2, which it inherits).
 *
 * `draft-cannot-reach-trainer.test.tsx` is the gate, and it is kept green
 * UNMODIFIED. Its drafted runs pin `draftWith(0.6)` once, as a room would.
 * The solo draft does not work that way: `GameSimulation` sets its own `k`
 * on every fixed step from the odometers of the rider, the bot pacer and the
 * rider's own ghost (`simulation.ts` §`soloDraftFactor`). So the runs here go
 * through that production path and no other. They use the real picker, with
 * the pacer ticked or *Race your own* ticked. The solo-draft switch is the
 * real device preference (`solo-draft-preference.ts`), on for the drafted
 * run and off for the run it is compared with. `GameSimulation` is not
 * given a draft by this file; it is only kept so its odometer can be read.
 *
 * Each pair is the same picker choice, the same power trace and the same
 * road (`rollingRoute()`), with the switch the only difference. Each pair
 * asserts what the gate asserts:
 *
 * - **Simulation mode**: every Set Indoor Bike Simulation Parameters write is
 *   the road's grade at the rider's own odometer at the tick that offered it,
 *   to the encoding's 0.01 % quantum. Its wind speed, rolling resistance and
 *   wind resistance coefficient are the protocol client's own defaults, byte
 *   for byte. Every other write during the ride is the same bytes in the same
 *   order, drafted or not.
 * - **ERG, under a workout** (the pacer pair): every write on the wire is the
 *   same bytes at the same frame, drafted or not.
 * - **Release**: the same bytes, drafted or not.
 *
 * Each drafted run also asserts that the rider WAS drafted: the simulation's
 * own in-draft metres are more than nought, and the same trace rode further.
 * So no comparison here can pass because the draft never took effect.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildGhostTrack,
  distanceOnRoute,
  gradeAt,
  gradePercent,
  metres,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type GhostTrack,
  type RouteProfile,
} from '@onyourleft/domain';
import { encodeControlRequest } from '@onyourleft/sensors/protocol';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { recordingSessionId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { ATHLETE_A } from '@onyourleft/store/testing';

import type { RecordingCheckpointStore } from '../recording/recorder';
import { createRideController, type RideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { endRideAnswer } from './end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import { rollingRoute } from './route-fixtures-testing';
import type { GameState } from './simulation';
import { SOLO_DRAFT_STORAGE_KEY } from './solo-draft-preference';
import type { SoloDraftState } from './solo-draft';
import { gameTrainerPortOver } from './trainer-port';

/** What the wrapped seams below saw, for one run. Reset before each. */
const seen = vi.hoisted(() => ({
  /** Every `GameSimulation` built this run, newest last. */
  simulations: [] as Array<{ readonly state: Pick<GameState, 'elapsed' | 'ride' | 'soloDraft'> }>,
  /** For each grade the gradient session offered: the odometer when it did. */
  offeredAt: [] as number[],
}));

// The real class, untouched: kept only so the odometer can be read. Unlike
// the gate, nothing here calls `draftWith`; the draft is the solo path's own.
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

vi.mock('./gradient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gradient')>();
  return {
    ...actual,
    createGradientSession: (options: Parameters<typeof actual.createGradientSession>[0]) => {
      const session = actual.createGradientSession(options);
      return {
        ...session,
        sample: (...args: Parameters<typeof session.sample>) => {
          const before = session.state().asked;
          session.sample(...args);
          const after = session.state().asked;
          // As in the gate: a changed `asked` is an offer, and the odometer
          // is read off the simulation, never off the `distance` argument.
          if (after !== undefined && after !== before) {
            const simulation = seen.simulations.at(-1);
            if (simulation === undefined) throw new Error('a gradient with no simulation');
            seen.offeredAt.push(simulation.state.ride.distance);
          }
        },
      };
    },
  };
});

/** The gate's frame clock, frame count and grade quantum, for the same reasons. */
const FRAME_MS = 230;
const FRAMES = 300;
const GRADE_QUANTUM_PERCENT = 0.01;

/**
 * The pacer's W/kg: a touch stronger than the trace, so the drafted rider
 * sits behind it for most of the ride. Measured 2026-11-10: at 2.9 the
 * drafted run rode 366 m of 455 m in the draft and 12.6 m further than the
 * same pacer with the switch off. At 2.7 the pacer rides off and the gain is
 * 2 m; at 3.2 the rider is dropped within 45 m.
 */
const PACER_INTENSITY = '2.9';
/**
 * The rider's own earlier attempt is this trace ridden alone, {@link GHOST_LEAD_METRES}
 * up the road and {@link GHOST_PACE} as fast: a slightly stronger day, so the
 * drafted rider stays on its wheel and does not ride through it. Measured
 * 2026-11-10: the whole drafted ride was in the draft, 20 m further.
 */
const GHOST_LEAD_METRES = 2;
const GHOST_PACE = 1.06;

const THRESHOLD = watts(250);
const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

/** The gate's workout: its target changes inside the ride, so ERG writes are several. */
const intervals: WorkoutRecord = {
  id: workoutId('w2425-intervals'),
  createdBy: ATHLETE_A,
  name: 'Intervals',
  workout: {
    name: 'Intervals',
    blocks: [
      { kind: 'steady', seconds: seconds(15), target: thresholdShare(0.6) },
      { kind: 'steady', seconds: seconds(15), target: thresholdShare(1.05) },
      { kind: 'steady', seconds: seconds(15), target: thresholdShare(0.75) },
      { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.9) },
    ],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
let controller: RideController | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  seen.simulations = [];
  seen.offeredAt = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  controller?.dispose();
  controller = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function endRun(): Promise<void> {
  mounted?.unmount();
  mounted = undefined;
  controller?.dispose();
  controller = undefined;
  await flush();
  pending = [];
  nowMs = 1_000_000;
  seen.simulations = [];
  seen.offeredAt = [];
  localStorage.clear();
}

/** The gate's power trace, to the watt. */
function tracePower(atMs: number): number {
  const t = (atMs - 1_000_000) / 1000;
  return Math.round(230 + 90 * Math.sin((2 * Math.PI * t) / 37) + 40 * Math.sin(t / 1.7));
}

function tracedPort(route: RidableRoute, ghost: GhostTrack | undefined): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(ghost),
    readSensors: () => ({
      rider: { power: watts(tracePower(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

/**
 * A renderer that draws nothing, and says so: `hasContext: false`, the view a
 * device with no WebGL gets (`port.ts` §`hasContext`). `GameView` then
 * prepares it with one frame and builds it no other (#2524): the frame is
 * built after the tick's grade is sampled and is read by nothing but the view,
 * so the wire is the same with or without it (`blind-view-wiring.test.tsx`).
 */
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

/** The control a `<label>` with exactly this text names, as a screen reader finds it. */
function labelled(words: string): HTMLInputElement {
  const label = queryAll<HTMLLabelElement>(mounted?.container ?? document, 'label').find(
    (candidate) => candidate.textContent === words,
  );
  const control = label?.control;
  if (!(control instanceof HTMLInputElement)) throw new Error(`no control labelled “${words}”`);
  return control;
}

interface Wire {
  readonly bytes: readonly number[];
  readonly frame: number;
}

interface Run {
  readonly profile: RouteProfile;
  readonly riding: readonly Wire[];
  readonly release: readonly Wire[];
  readonly distance: number;
  readonly offeredAt: readonly number[];
  /** The simulation's own solo draft state at the end of the ride. */
  readonly soloDraft: SoloDraftState | undefined;
  /** The odometer at each frame, against the ride's elapsed seconds. */
  readonly track: { readonly elapsed: number[]; readonly distance: number[] };
}

/** Who rides with the rider: the bot pacer, their own ghost, or nobody. */
type Company = 'pacer' | { readonly ghost: GhostTrack } | 'alone';

/**
 * The gate's `rideAt`, with the draft chosen as a rider chooses it: the
 * pacer or *Race your own* ticked on the picker, and the solo-draft switch
 * on or off on this device.
 */
async function rideWith(
  company: Company,
  soloDraft: boolean,
  mode: 'simulation' | 'erg',
): Promise<Run> {
  localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, soloDraft ? 'on' : 'off');
  const profile = rollingRoute();
  const ghost = typeof company === 'object' ? company.ghost : undefined;
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  const written: number[][] = [];
  const frames: number[] = [];
  const own = createRideController({
    transport,
    store: CHECKPOINTS,
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-2425'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written }),
  });
  controller = own;
  await own.pair('trainer');
  let frame = 0;
  const stamp = (): void => {
    while (frames.length < written.length) frames.push(frame);
  };
  if (mode === 'erg') {
    await own.requestTrainerControl();
    await own.start();
    expect(own.startWorkout(intervals, THRESHOLD)).toBe(true);
  }
  mounted = await mount(
    <GameView
      port={tracedPort(
        { id: 'route-rolling', name: 'Rolling', profile, attempts: ghost === undefined ? 0 : 1 },
        ghost,
      )}
      trainer={gameTrainerPortOver(own)}
      renderer={() => Promise.resolve(blankRenderer())}
      now={() => nowMs}
    />,
  );
  await settle();
  if (company === 'pacer') {
    await press(toggle('pacer'));
    const intensity = labelled('Pacer intensity, watts per kilogram');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      setter?.set?.call(intensity, PACER_INTENSITY);
      intensity.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  }
  if (ghost !== undefined) await press(toggle('Race your own'));
  await press(buttonStarting('Ride '));
  stamp();

  const track = { elapsed: [0], distance: [0] };
  for (frame = 1; frame <= FRAMES; frame += 1) {
    const next = pending.shift();
    if (next === undefined)
      throw new Error(`the ride stopped asking for frames at ${String(frame)}`);
    nowMs += FRAME_MS;
    await act(async () => {
      if (Math.floor(nowMs / 1000) > Math.floor((nowMs - FRAME_MS) / 1000)) {
        bench.advance(seconds(1));
        if (mode === 'erg') await own.tick(bench.now);
      }
      next(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    stamp();
    const state = seen.simulations.at(-1)?.state;
    if (state !== undefined && state.elapsed > (track.elapsed.at(-1) ?? 0)) {
      track.elapsed.push(state.elapsed);
      track.distance.push(state.ride.distance);
    }
  }
  const simulation = seen.simulations.at(-1);
  const distance = simulation?.state.ride.distance ?? Number.NaN;
  const endedState = simulation?.state.soloDraft;
  const endedAt = written.length;

  await press(buttonStarting('End ride'));
  await press(endRideAnswer(document, 'Discard ride'));
  await press(endRideAnswer(document, 'Discard ride'));
  if (mode === 'erg') own.endWorkout();
  await flush();
  stamp();

  const wire = written.map((bytes, index) => ({ bytes, frame: frames[index] ?? Number.NaN }));
  return {
    profile,
    riding: wire.slice(0, endedAt),
    release: wire.slice(endedAt),
    distance,
    offeredAt: [...seen.offeredAt],
    soloDraft: endedState,
    track,
  };
}

/**
 * Each run, ridden once by the first case that asks for it and read by every
 * case after, so a case pays for one ride (#2524, #1688's ruling: a slow case
 * is made cheaper, never given a longer timeout). A case run alone with `-t`
 * rides whatever it reads that no earlier case has, and the ghost case
 * (three rides) can then outrun the 5 s default; whole-file runs do not.
 */
const runs = new Map<string, Promise<Run>>();
function ridden(
  name: string,
  company: () => Promise<Company>,
  soloDraft: boolean,
  mode: 'simulation' | 'erg',
): Promise<Run> {
  const key = `${name} ${soloDraft ? 'on' : 'off'} ${mode}`;
  let run = runs.get(key);
  if (run === undefined) {
    run = company().then(async (with_) => {
      const done = await rideWith(with_, soloDraft, mode);
      await endRun();
      return done;
    });
    runs.set(key, run);
    // A ride that fails is not kept: the next case rides afresh and reports its
    // own failure, not this ride's "stopped asking for frames" after afterEach
    // cut it off.
    run.catch(() => runs.delete(key));
  }
  return run;
}

/**
 * The rider's own earlier attempt: this trace ridden with nobody and the
 * switch off, scaled by {@link GHOST_PACE} and {@link GHOST_LEAD_METRES} up
 * the road. Handed in through `GamePort.loadGhost`, as a saved attempt is.
 */
async function ownGhost(): Promise<Company> {
  const unpaced = await ridden('nobody', () => Promise.resolve('alone'), false, 'simulation');
  return {
    ghost: buildGhostTrack({
      elapsedSeconds: unpaced.track.elapsed,
      distanceMetres: unpaced.track.distance.map((at) => at * GHOST_PACE + GHOST_LEAD_METRES),
    }),
  };
}

const pacer = (): Promise<Company> => Promise.resolve('pacer');

const SET_SIMULATION_PARAMETERS = 0x11;
const SET_TARGET_POWER = 0x05;
const STOP = 0x08;

function gradeOf(bytes: readonly number[]): number {
  const raw = (bytes[3] ?? 0) | ((bytes[4] ?? 0) << 8);
  return (raw > 0x7fff ? raw - 0x1_0000 : raw) * GRADE_QUANTUM_PERCENT;
}

function notTheGrade(bytes: readonly number[]): readonly number[] {
  return [bytes[1], bytes[2], bytes[5], bytes[6]].map((octet) => octet ?? -1);
}

const DEFAULTS = notTheGrade([
  ...encodeControlRequest({
    opCode: 'set-simulation-parameters',
    parameters: { grade: gradePercent(0) },
  }),
]);

/** The rider was drafted: the simulation says so, and the same trace rode further. */
function expectDrafted(alone: Run, drafted: Run): void {
  expect(alone.soloDraft).toBeUndefined();
  expect(drafted.soloDraft?.inDraftMetres ?? 0).toBeGreaterThan(50);
  expect(drafted.distance).toBeGreaterThan(alone.distance + 10);
}

/** The gate's simulation-mode and release assertions, for one pair. */
function expectGradesOnly(alone: Run, drafted: Run): void {
  const notGrades = (run: Run): readonly (readonly number[])[] =>
    run.riding
      .filter((write) => write.bytes[0] !== SET_SIMULATION_PARAMETERS)
      .map((write) => write.bytes);
  expect(notGrades(drafted)).toEqual(notGrades(alone));

  for (const [name, run] of [
    ['alone', alone],
    ['drafted', drafted],
  ] as const) {
    const grades = run.riding.filter((write) => write.bytes[0] === SET_SIMULATION_PARAMETERS);
    expect(grades.length, name).toBeGreaterThan(15);
    expect(
      grades.some((write) => gradeOf(write.bytes) > 3),
      name,
    ).toBe(true);
    expect(
      grades.some((write) => gradeOf(write.bytes) < -3),
      name,
    ).toBe(true);
    expect(grades.length, name).toBe(run.offeredAt.length);
    grades.forEach((write, index) => {
      const odometer = run.offeredAt[index] ?? Number.NaN;
      const road = gradeAt(run.profile, distanceOnRoute(run.profile, metres(odometer)));
      expect(write.bytes, `${name} write ${String(index)}`).toHaveLength(7);
      expect(
        Math.abs(gradeOf(write.bytes) - road),
        `${name} write ${String(index)} at ${odometer.toFixed(2)} m`,
      ).toBeLessThanOrEqual(GRADE_QUANTUM_PERCENT / 2 + 1e-9);
      expect(notTheGrade(write.bytes), `${name} write ${String(index)}`).toEqual(DEFAULTS);
    });
  }

  expect(alone.release.some((write) => write.bytes[0] === STOP)).toBe(true);
  expect(drafted.release.map((write) => write.bytes)).toEqual(
    alone.release.map((write) => write.bytes),
  );
}

// #2524: each pair was one case, the ghost's three rides one case. Locally on
// an Apple M4 Pro at a load average of 13 to 23: the pacer's simulation pair
// 3.7 s, and 5.5 s under --coverage; the ghost's three 4.0 s and 6.2 s; the
// ERG pair 2.8 s and 8.2 s. Each ride is now its own case: after, at a load
// average of 10 to 15, 1.0 to 2.2 s each, and 2.1 to 3.0 s under --coverage.
// On the nightly's EPYC 7763 that was 3.5 to 4.5 s a case under --coverage
// (run 43233467339). Since the renderer says it draws nothing, no frame is
// built after the first: 1.3 to 1.8 s on an EPYC 9V74 (runs 43293464256,
// 43303890753) and 1.6 to 2.3 s on a Xeon 8370C (run 43298427279).
describe('a solo draft reaches no trainer write in simulation mode — #2425, ADR 0066 D-4', () => {
  it('behind the pacer, the switch off: no draft taken', async () => {
    const alone = await ridden('pacer', pacer, false, 'simulation');
    expect(alone.soloDraft).toBeUndefined();
  });

  it('behind the pacer: the road’s grade at the rider’s own odometer, the protocol’s defaults for everything else, and the same release', async () => {
    const alone = await ridden('pacer', pacer, false, 'simulation');
    const drafted = await ridden('pacer', pacer, true, 'simulation');
    expectDrafted(alone, drafted);
    expectGradesOnly(alone, drafted);
  });

  it('rides the rider’s own earlier attempt, with nobody, for the ghost below', async () => {
    const unpaced = await ridden('nobody', () => Promise.resolve('alone'), false, 'simulation');
    expect(unpaced.soloDraft).toBeUndefined();
    expect(unpaced.track.distance.length).toBeGreaterThan(0);
  });

  it('behind the rider’s own ghost, the switch off: no draft taken', async () => {
    const alone = await ridden('ghost', ownGhost, false, 'simulation');
    expect(alone.soloDraft).toBeUndefined();
  });

  it('behind the rider’s own ghost: the same, from the ghost’s replayed distance', async () => {
    const alone = await ridden('ghost', ownGhost, false, 'simulation');
    const drafted = await ridden('ghost', ownGhost, true, 'simulation');
    expectDrafted(alone, drafted);
    expectGradesOnly(alone, drafted);
  });
});

describe('a solo draft reaches no trainer write under a workout (ERG) — #2425, ADR 0059 D-2', () => {
  it('behind the pacer, the switch off: the workout’s target powers', async () => {
    const alone = await ridden('pacer', pacer, false, 'erg');
    expect(alone.soloDraft).toBeUndefined();
    const targets = alone.riding.filter((write) => write.bytes[0] === SET_TARGET_POWER);
    expect(new Set(targets.map((write) => write.bytes.join(','))).size).toBeGreaterThan(2);
  });

  it('behind the pacer: the same target powers at the same frames, and the same release', async () => {
    const alone = await ridden('pacer', pacer, false, 'erg');
    const drafted = await ridden('pacer', pacer, true, 'erg');
    expectDrafted(alone, drafted);
    const targets = alone.riding.filter((write) => write.bytes[0] === SET_TARGET_POWER);
    expect(new Set(targets.map((write) => write.bytes.join(','))).size).toBeGreaterThan(2);
    expect(drafted.riding).toEqual(alone.riding);
    expect(alone.release.some((write) => write.bytes[0] === STOP)).toBe(true);
    expect(drafted.release.map((write) => write.bytes)).toEqual(
      alone.release.map((write) => write.bytes),
    );
  });
});
