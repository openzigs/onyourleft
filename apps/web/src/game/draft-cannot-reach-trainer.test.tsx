// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A draft changes the rider's simulated speed and nothing else** — the
 * trainer gate of epic #2421 (#2423), for ADR 0038 D-1 and D-4 and ADR 0059
 * D-2. A draft is `k` times the rider's drag area in `GameSimulation`
 * (`simulation.ts` §`#drafted`). The trainer's resistance and ERG target never
 * take a draft term. The one way a draft reaches a trainer write is that a
 * faster rider reaches the next grade sooner, exactly as riding harder does.
 *
 * ⚠️ **A new drafting source must keep this file green UNMODIFIED.** #2425 (a
 * solo draft) and #2422 (the bend easing) each cite it. A source may ADD a run
 * of its own beside the two below; it may not loosen an assertion, widen a
 * tolerance or change the trace. If one of these goes red, the draft has
 * reached the trainer, and that is a change to ADR 0038, not to this test.
 *
 * Every run is the real `GameView`, the real ride controller `main.tsx` builds,
 * its real `createTrainerControl`, and the #44 simulator's FTMS trainer, read
 * back as the OCTETS on its control point (`ride/simulated-trainer-testing.ts`).
 * Two seams are wrapped and neither changes what runs:
 *
 * - `GameSimulation` is the real class, given its draft through its own
 *   `draftWith` the moment it is built — the call a room makes every frame
 *   (`room-ride.ts` §`roomFrame`) — and kept so the test can read its
 *   odometer. Nothing else in a solo ride calls `draftWith`, so the ride is
 *   drafted from its first step to its last.
 * - `createGradientSession` is the real session. The wrapper notes, after each
 *   `sample`, whether that sample offered a grade, and the odometer the
 *   simulation stood at when it did. It reads the odometer off the simulation,
 *   never off the `distance` argument, so a caller that sampled anywhere else
 *   is caught by the grade it wrote.
 *
 * What each run holds, in every state the game leaves a trainer in:
 *
 * - **Simulation mode**: every Set Indoor Bike Simulation Parameters write is
 *   the road's grade at the rider's own odometer at the tick that offered it,
 *   to the encoding's 0.01 % quantum, and its wind speed, rolling resistance
 *   and wind resistance coefficient are the protocol client's own defaults,
 *   byte for byte, drafted or not. The tolerance is the quantum alone, not the
 *   driver's 0.1 % deadband: each write is checked against the tick that
 *   offered it, so the deadband (which decides WHETHER to write) has no part
 *   in WHAT was written.
 * - **ERG, under a workout**: every write on the wire, target powers included,
 *   is the same bytes at the same frame, drafted or not.
 * - **Release**: what reaches the wire once the ride ends is the same bytes,
 *   drafted or not.
 *
 * Each drafted run also asserts that the rider WAS drafted — they rode
 * further on the same trace — so no comparison here can pass because the
 * draft never took effect.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  distanceOnRoute,
  gradeAt,
  gradePercent,
  metres,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
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
import { gameTrainerPortOver } from './trainer-port';

/** What the wrapped seams below saw, for one run. Reset before each. */
const seen = vi.hoisted(() => ({
  /** The draft every `GameSimulation` built this run is ridden at. */
  k: 1,
  /** Every `GameSimulation` built this run, newest last. */
  simulations: [] as Array<{ readonly state: { readonly ride: { readonly distance: number } } }>,
  /** For each grade the gradient session offered: the odometer when it did. */
  offeredAt: [] as number[],
}));

vi.mock('./simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulation')>();
  class DraftedSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      this.draftWith(seen.k);
      seen.simulations.push(this);
    }
  }
  return { ...actual, GameSimulation: DraftedSimulation };
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
          // A grade was offered: the driver's deadband means two offers in a
          // row are never the same grade, so a changed `asked` is an offer.
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

/** The draft ridden in every drafted run — ADR 0038's figure for a wheel close behind. */
const DRAFTED = 0.6;

/**
 * One frame's wall clock. ⚠️ Not a multiple of the simulation's 50 ms step, so
 * the drawn rider (#323's blend of the last two steps) is a fraction of a step
 * behind the odometer on most frames: a grade sampled at the drawn place
 * rather than the odometer is then a different grade.
 */
const FRAME_MS = 230;
/** About 69 s of road: over a crest and into the next dip of `rollingRoute`. */
const FRAMES = 300;
/** The FTMS grade field's resolution, 0.01 % (FTMS Table 4.20); half of it is rounding. */
const GRADE_QUANTUM_PERCENT = 0.01;

const THRESHOLD = watts(250);
const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

/** A workout whose target changes inside the ride, so ERG writes are several. */
const intervals: WorkoutRecord = {
  id: workoutId('w2423-intervals'),
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
  seen.k = 1;
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
  vi.unstubAllGlobals();
});

/** Take one run down and start the clock and the seams afresh for the next. */
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
}

/**
 * One power trace, the same in every run: a rider surging and easing, read
 * off the frame clock the way a live power meter is read once a frame.
 */
function tracePower(atMs: number): number {
  const t = (atMs - 1_000_000) / 1000;
  return Math.round(230 + 90 * Math.sin((2 * Math.PI * t) / 37) + 40 * Math.sin(t / 1.7));
}

function tracedPort(route: RidableRoute): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(tracePower(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function blankRenderer(): GameRenderer {
  return {
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

/** Every control point write, and the frame it was on the wire by. */
interface Wire {
  readonly bytes: readonly number[];
  readonly frame: number;
}

/** What one run left on the wire, and how far the rider got. */
interface Run {
  readonly profile: RouteProfile;
  /** Every write from the first (the Request Control) to the press on *End ride*. */
  readonly riding: readonly Wire[];
  /** Every write after the ride was ended, through its release. */
  readonly release: readonly Wire[];
  /** The odometer at the end of the ride. */
  readonly distance: number;
  /** For each grade offered, the odometer when it was. */
  readonly offeredAt: readonly number[];
}

/**
 * Ride {@link FRAMES} frames of {@link tracePower} on `rollingRoute()` at
 * draft `k`, in simulation mode or under a running workout (ERG), then end
 * the ride on the HUD — and, under a workout, end the workout as the Ride
 * screen does.
 */
async function rideAt(k: number, mode: 'simulation' | 'erg'): Promise<Run> {
  seen.k = k;
  const profile = rollingRoute();
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  const written: number[][] = [];
  const frames: number[] = [];
  const own = createRideController({
    transport,
    store: CHECKPOINTS,
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-2423'),
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
      port={tracedPort({ id: 'route-rolling', name: 'Rolling', profile, attempts: 0 })}
      trainer={gameTrainerPortOver(own)}
      renderer={() => Promise.resolve(blankRenderer())}
      now={() => nowMs}
    />,
  );
  await settle();
  await press(buttonStarting('Ride '));
  stamp();

  for (frame = 1; frame <= FRAMES; frame += 1) {
    const next = pending.shift();
    if (next === undefined)
      throw new Error(`the ride stopped asking for frames at ${String(frame)}`);
    nowMs += FRAME_MS;
    await act(async () => {
      // The bench keeps whole seconds: it is moved on, and a workout ticked,
      // each time the frame clock passes one — at the same frames in every
      // run. Inside `act`, because what the machine answers reaches the screen.
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
  }
  const distance = seen.simulations.at(-1)?.state.ride.distance ?? Number.NaN;
  const endedAt = written.length;

  // The ride ends on the HUD, as a rider ends it: *End ride*, then *Discard
  // ride* and its confirmation (#2349) — the game ride records by default
  // (#2381). The game's own release, `gradient.ts` §`stop`, is the ride
  // controller's `letGo`, and so `releaseTrainer`. Under a workout the game
  // holds no control, and the Ride screen's *End workout* is the release.
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
  };
}

/** The trace ridden alone and then drafted, in one mode. */
async function ridePair(
  mode: 'simulation' | 'erg',
): Promise<{ readonly alone: Run; readonly drafted: Run }> {
  const alone = await rideAt(1, mode);
  await endRun();
  const drafted = await rideAt(DRAFTED, mode);
  return { alone, drafted };
}

/**
 * The simulation-mode pair, ridden once for the two cases that read it: the
 * first case to ask pays for both rides (see {@link RIDES}).
 */
let simulationPair: Promise<{ readonly alone: Run; readonly drafted: Run }> | undefined;
const simulationRides = (): Promise<{ readonly alone: Run; readonly drafted: Run }> =>
  (simulationPair ??= ridePair('simulation'));

/**
 * A case that rides two of the runs above, the second simulation case reading
 * the first's: about three times the slowest figure under coverage, as
 * `docs/agents/ci.md` §4c asks of a case slow under coverage. The figures,
 * 2026-11-10, the grade case then the ERG case: 4 484 ms and 3 663 ms on CI's
 * `Tests` (run 42891832209, AMD EPYC 9V45); locally 2.1 s and 2.0 s, and 3.1 s
 * and 3.0 s under coverage, so about 6.5 s under coverage on that runner. On
 * an EPYC 7763 the first run went past Vitest's default 5 s (42889357062).
 */
const RIDES = { timeout: 20_000 } as const;

const SET_SIMULATION_PARAMETERS = 0x11;
const SET_TARGET_POWER = 0x05;
const STOP = 0x08;

/** The grade an FTMS simulation write carries, in percent: sint16 at octets 3–4, 0.01 %. */
function gradeOf(bytes: readonly number[]): number {
  const raw = (bytes[3] ?? 0) | ((bytes[4] ?? 0) << 8);
  return (raw > 0x7fff ? raw - 0x1_0000 : raw) * GRADE_QUANTUM_PERCENT;
}

/**
 * Everything but the grade: wind speed (octets 1–2), rolling resistance (5)
 * and wind resistance coefficient (6). Read off the protocol client's own
 * encoder for a grade and nothing else, so "its defaults" is its word, not
 * this file's.
 */
function notTheGrade(bytes: readonly number[]): readonly number[] {
  return [bytes[1], bytes[2], bytes[5], bytes[6]].map((octet) => octet ?? -1);
}

const DEFAULTS = notTheGrade([
  ...encodeControlRequest({
    opCode: 'set-simulation-parameters',
    parameters: { grade: gradePercent(0) },
  }),
]);

describe('a draft reaches no trainer write in simulation mode — #2423, ADR 0038 D-1', () => {
  it(
    'writes the road’s grade at the rider’s own odometer, and the protocol’s defaults for everything else, drafted or not',
    RIDES,
    async () => {
      const { alone, drafted } = await simulationRides();

      // The draft took effect: the same trace rode further.
      expect(drafted.distance).toBeGreaterThan(alone.distance + 10);

      for (const [name, run] of [
        ['alone', alone],
        ['drafted', drafted],
      ] as const) {
        const grades = run.riding.filter((write) => write.bytes[0] === SET_SIMULATION_PARAMETERS);
        // Enough writes to mean something, over climbs and descents.
        expect(grades.length, name).toBeGreaterThan(15);
        expect(
          grades.some((write) => gradeOf(write.bytes) > 3),
          name,
        ).toBe(true);
        expect(
          grades.some((write) => gradeOf(write.bytes) < -3),
          name,
        ).toBe(true);
        // One wire write for every grade offered: none coalesced, none refused,
        // so the n-th write is the n-th offer.
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
    },
  );

  it('lets the trainer go with the same bytes, drafted or not', RIDES, async () => {
    const { alone, drafted } = await simulationRides();

    expect(drafted.distance).toBeGreaterThan(alone.distance + 10);
    expect(alone.release.some((write) => write.bytes[0] === STOP)).toBe(true);
    expect(drafted.release.map((write) => write.bytes)).toEqual(
      alone.release.map((write) => write.bytes),
    );
  });
});

describe('a draft reaches no trainer write under a workout (ERG) — #2423, ADR 0059 D-2', () => {
  it(
    'sends the same target powers at the same frames, and the same release, drafted or not',
    RIDES,
    async () => {
      const { alone, drafted } = await ridePair('erg');

      expect(drafted.distance).toBeGreaterThan(alone.distance + 10);
      const targets = alone.riding.filter((write) => write.bytes[0] === SET_TARGET_POWER);
      // The workout's blocks changed the target inside the ride.
      expect(new Set(targets.map((write) => write.bytes.join(','))).size).toBeGreaterThan(2);
      expect(drafted.riding).toEqual(alone.riding);
      expect(alone.release.some((write) => write.bytes[0] === STOP)).toBe(true);
      expect(drafted.release.map((write) => write.bytes)).toEqual(
        alone.release.map((write) => write.bytes),
      );
    },
  );
});
