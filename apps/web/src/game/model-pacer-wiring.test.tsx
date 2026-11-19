// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The AI pacer, through the shipped path, and the trainer it cannot reach**
 * — #2712, ADR 0072 D-6: *"No model output reaches the trainer. The pacer
 * gives a draft only as riding harder does."*
 *
 * Each run mounts `GameView` with the real picker, a real ride controller
 * over the simulated FTMS trainer, the pacer ticked at one W/kg, and — for the
 * directed run — the AI pacer switched on and consented to, through a
 * `GamePort.aiPacer` double that answers every ask at once with a line.
 * Since #2835 (ADR 0083) the pacer's direction is the device's own decision,
 * from the rider's gap and the road, and the double can answer nothing that
 * moves it. The solo draft is on, so the rider is sheltered by a pacer those
 * decisions moved: the one way a pacer decision could reach the rider, and
 * it is the draft.
 *
 * Each pair is the same picker choice, the same power trace and the same
 * road, with the AI pacer the only difference, and asserts what #2423's gate
 * asserts (`draft-cannot-reach-trainer.test.tsx`, kept green unmodified):
 *
 * - **Simulation mode**: every Set Indoor Bike Simulation Parameters write is
 *   the road's grade at the rider's own odometer at the tick that offered it,
 *   with the protocol's defaults for everything else; every other write is the
 *   same bytes in the same order.
 * - **ERG, under a workout**: every write on the wire is the same bytes at the
 *   same frame.
 * - **Release**: the same bytes.
 *
 * Each directed run also asserts the pacer's decisions WERE ridden: the
 * double was asked, the ride controller was handed applied records, the line
 * was on the HUD, and the pacer rode a different distance from the same
 * pacer undirected. So no comparison here passes because the AI pacer never
 * took effect.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beatsPerMinute,
  distanceOnRoute,
  gradeAt,
  gradePercent,
  metres,
  PACER_GAP_TRENDS,
  PACER_REASONS,
  readModelPacerInput,
  RIDER_PLACES,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type RouteProfile,
} from '@onyourleft/domain';
import { encodeControlRequest } from '@onyourleft/sensors/protocol';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { recordingSessionId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { ATHLETE_A } from '@onyourleft/store/testing';

import type { PacerPort, PacerStatus } from '../instance/pacer-port';
import type { RecordingCheckpointStore } from '../recording/recorder';
import { createRideController, type RideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { endRideAnswer } from './end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import type { LapRaceChoice } from './lap-race/choice';
import { circuitRoute, rollingRoute } from './route-fixtures-testing';
import type { GameState } from './simulation';
import { SOLO_DRAFT_STORAGE_KEY } from './solo-draft-preference';
import { gameTrainerPortOver } from './trainer-port';

const seen = vi.hoisted(() => ({
  simulations: [] as Array<{ readonly state: Pick<GameState, 'elapsed' | 'ride' | 'bot'> }>,
  offeredAt: [] as number[],
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

const FRAME_MS = 230;
const FRAMES = 300;
const GRADE_QUANTUM_PERCENT = 0.01;
/** The solo-draft gate's pacer: a touch stronger than the trace, so the rider sits behind it. */
const PACER_INTENSITY = '2.9';
const LINE = 'Come with me up this rise.';
const THRESHOLD = watts(250);
const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

const intervals: WorkoutRecord = {
  id: workoutId('w2712-intervals'),
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

function tracePower(atMs: number): number {
  const t = (atMs - 1_000_000) / 1000;
  return Math.round(230 + 90 * Math.sin((2 * Math.PI * t) / 37) + 40 * Math.sin(t / 1.7));
}

/** What the AI pacer double was asked and did, for one run. */
interface Asked {
  readonly inputs: ModelPacerInput[];
  /** #2835: the warm-ups asked for, each with how many rides had started by then. */
  readonly warms: number[];
  starts: number;
  ends: number;
}

/** An instance that offers a local model and answers every ask at once with the same line. */
function aiPacerPort(asked: Asked): PacerPort {
  let consented = false;
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
    warmPacer: () => {
      asked.warms.push(asked.starts);
      return Promise.resolve(true);
    },
    startPacerRide: () => {
      asked.starts += 1;
      return Promise.resolve(true);
    },
    decidePacer: (input) => {
      asked.inputs.push(input);
      return Promise.resolve({ kind: 'answer', say: LINE });
    },
    endPacerRide: () => {
      asked.ends += 1;
      return Promise.resolve();
    },
  };
}

function tracedPort(
  route: RidableRoute,
  aiPacer: PacerPort | undefined,
  thresholds?: { readonly power: number; readonly heartRate: number },
): GamePort {
  return {
    ...(thresholds === undefined
      ? {}
      : {
          ownThresholdPower: () => Promise.resolve(watts(thresholds.power)),
          ownThresholdHeartRate: () => Promise.resolve(beatsPerMinute(thresholds.heartRate)),
        }),
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(tracePower(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
    ...(aiPacer === undefined ? {} : { aiPacer }),
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
  readonly offeredAt: readonly number[];
  readonly pacerDistance: number;
  readonly asked: Asked;
  /** What the ride controller was handed for the recording. */
  readonly records: readonly PacerDecisionRecord[];
  /** Whether the HUD showed the pacer's line, labelled, on some frame. */
  readonly lineShown: boolean;
  /** What the chooser said before the rider agreed. */
  readonly consentText: string | undefined;
}

async function rideWith(directed: boolean, mode: 'simulation' | 'erg'): Promise<Run> {
  localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'on');
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
    newSessionId: () => recordingSessionId('ride-2712'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written }),
  });
  const records: PacerDecisionRecord[] = [];
  const kept = own.notePacerDecision.bind(own);
  const watched: RideController = {
    ...own,
    notePacerDecision: (record, ride) => {
      records.push(record);
      kept(record, ride);
    },
  };
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
  const asked: Asked = { inputs: [], warms: [], starts: 0, ends: 0 };
  mounted = await mount(
    <GameView
      port={tracedPort(
        { id: 'route-rolling', name: 'Rolling', profile, attempts: 0 },
        directed ? aiPacerPort(asked) : undefined,
      )}
      trainer={gameTrainerPortOver(watched)}
      renderer={() => Promise.resolve(blankRenderer())}
      now={() => nowMs}
    />,
  );
  await settle();
  await press(toggle('Ride against a pacer'));
  const intensity = labelled('Pacer intensity, watts per kilogram');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    setter?.set?.call(intensity, PACER_INTENSITY);
    intensity.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  let consentText: string | undefined;
  if (directed) {
    await press(toggle('Let the AI on your instance steer the pacer'));
    consentText = queryAll<HTMLParagraphElement>(mounted.container, '.oyl-game__ai-pacer p')
      .map((each) => each.textContent ?? '')
      .join(' ');
    await press(buttonStarting('Allow the AI pacer'));
  }
  await press(buttonStarting('Ride '));
  stamp();

  let lineShown = false;
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
    lineShown ||= (mounted.container.textContent ?? '').includes(`Your pacer: ${LINE}`);
  }
  const simulation = seen.simulations.at(-1);
  const pacerDistance = simulation?.state.bot?.state.distance ?? Number.NaN;
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
    offeredAt: [...seen.offeredAt],
    pacerDistance,
    asked,
    records,
    lineShown,
    consentText,
  };
}

/** Each run ridden once by the first case that asks for it (#1688: cheaper, never a longer timeout). */
const runs = new Map<string, Promise<Run>>();
function ridden(directed: boolean, mode: 'simulation' | 'erg'): Promise<Run> {
  const key = `${directed ? 'ai' : 'plain'} ${mode}`;
  let run = runs.get(key);
  if (run === undefined) {
    run = rideWith(directed, mode).then(async (done) => {
      await endRun();
      return done;
    });
    runs.set(key, run);
    run.catch(() => runs.delete(key));
  }
  return run;
}

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

/** The pacer's decisions were ridden: asked, logged, shown, and the pacer rode a different ride. */
function expectDirected(plain: Run, directed: Run): void {
  expect(plain.asked.inputs).toEqual([]);
  expect(plain.records).toEqual([]);
  expect(plain.lineShown).toBe(false);
  expect(directed.asked.starts).toBe(1);
  expect(directed.asked.ends).toBe(1);
  // #2835, ADR 0083 D-4: the model is warmed once, from the ride menu, when
  // the AI pacer is on and consented to — before any ride had started — and
  // never on a ride with no AI pacer.
  expect(plain.asked.warms).toEqual([]);
  expect(directed.asked.warms).toEqual([0]);
  expect(directed.asked.inputs.length).toBeGreaterThan(8);
  expect(directed.records.filter((each) => each.outcome === 'applied').length).toBeGreaterThan(8);
  expect(directed.lineShown).toBe(true);
  // #2835: every record is a decision of the device's, ridden from its ask.
  expect(directed.records.every((each) => 'reason' in each)).toBe(true);
  // Not "further", since #2835: the device eases the pacer in at the start
  // and waits for a rider behind it, so a directed pacer may well ride less.
  expect(Math.abs(directed.pacerDistance - plain.pacerDistance)).toBeGreaterThan(5);
}

function expectGradesOnly(plain: Run, directed: Run): void {
  const notGrades = (run: Run): readonly (readonly number[])[] =>
    run.riding
      .filter((write) => write.bytes[0] !== SET_SIMULATION_PARAMETERS)
      .map((write) => write.bytes);
  expect(notGrades(directed)).toEqual(notGrades(plain));
  for (const [name, run] of [
    ['plain', plain],
    ['directed', directed],
  ] as const) {
    const grades = run.riding.filter((write) => write.bytes[0] === SET_SIMULATION_PARAMETERS);
    expect(grades.length, name).toBeGreaterThan(15);
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
  expect(plain.release.some((write) => write.bytes[0] === STOP)).toBe(true);
  expect(directed.release.map((write) => write.bytes)).toEqual(
    plain.release.map((write) => write.bytes),
  );
}

describe('the AI pacer through the shipped path — #2712, ADR 0072', () => {
  it('rides the pacer undirected with no AI pacer port', async () => {
    const plain = await ridden(false, 'simulation');
    expect(plain.asked.inputs).toEqual([]);
  });

  it('asks for consent naming the instance and the model address, then steers the pacer and shows its line', async () => {
    const directed = await ridden(true, 'simulation');
    expect(directed.consentText).toContain('http://127.0.0.1:11434/v1');
    expect(directed.consentText).toContain('https://ride.example');
    expect(directed.consentText).toContain('never sets your trainer');
    // What it sent: the pacer's state, with no coordinate in it.
    expect(JSON.stringify(directed.asked.inputs)).not.toMatch(/latitude|longitude/);
    expect(directed.asked.inputs[0]).toMatchObject({ pacerWPerKg: 2.9, plan: 'rolling' });
    // #2835, ADR 0083: the device decides, and tells the model what the pacer
    // is doing and why. The double answers a line and nothing else, so every
    // intent here is the rule's: the plan never leaves #92's own, the first
    // ask is inside the start ramp, and the pacer both holds and, once the
    // rider has ridden away from its gentle start, chases.
    const intents = directed.asked.inputs.map((each) => each.intent);
    expect(directed.asked.inputs.every((each) => each.plan === 'rolling')).toBe(true);
    expect(directed.asked.inputs[0]).toMatchObject({ starting: true });
    for (const each of directed.asked.inputs) {
      expect(PACER_REASONS).toContain(each.reason);
      expect(readModelPacerInput(each).ok).toBe(true);
    }
    expect(new Set(intents).size).toBeGreaterThan(1);
    expect(intents).toContain('hold');
    expect(intents).toContain('lift');
    // #2760: the consent names the new data, and the state carries the
    // rider's own sensors from the shipped frame loop — cadence and heart
    // rate as the port reads them, the HUD's 3 s power — and the model's own
    // last line. No threshold is set on this port, so no zone is guessed.
    expect(directed.consentText).toContain('cadence');
    expect(directed.consentText).toContain('heart rate');
    expect(directed.asked.inputs[0]).not.toHaveProperty('recentLines');
    const last = directed.asked.inputs.at(-1);
    // The double says the same line every time: since #2835 it is shown
    // once, a repeat is no new line, and it is sent back once.
    expect(last).toMatchObject({
      cadenceRpm: 88,
      heartRateBpm: 142,
      recentLines: [LINE],
    });
    const lines = directed.records.map((each) => ('line' in each ? each.line : undefined));
    expect(lines.filter((each) => each === 'shown')).toHaveLength(1);
    expect(lines).toContain('repeat');
    expect(last?.rider3sWPerKg).toBeGreaterThan(0);
    expect(last).not.toHaveProperty('powerZone');
    expect(last).not.toHaveProperty('heartRateZone');
    expect(last).not.toHaveProperty('aboveThresholdS');
    // #2777: where the rider is, and how the gap moved since the last ask,
    // through the shipped frame loop; the first ask has no trend.
    expect(directed.asked.inputs[0]).not.toHaveProperty('gapTrend');
    expect(RIDER_PLACES).toContain(last?.riderPlace);
    expect(PACER_GAP_TRENDS).toContain(last?.gapTrend);
  });

  it('reaches no trainer write in simulation mode: the grade at the rider’s own odometer, the defaults, and the same release', async () => {
    const plain = await ridden(false, 'simulation');
    const directed = await ridden(true, 'simulation');
    expectDirected(plain, directed);
    expectGradesOnly(plain, directed);
  });

  it('rides the pacer undirected under a workout (ERG)', async () => {
    const plain = await ridden(false, 'erg');
    const targets = plain.riding.filter((write) => write.bytes[0] === SET_TARGET_POWER);
    expect(new Set(targets.map((write) => write.bytes.join(','))).size).toBeGreaterThan(2);
  });

  it('reaches no trainer write under a workout (ERG): the same bytes at the same frames, and the same release', async () => {
    const plain = await ridden(false, 'erg');
    const directed = await ridden(true, 'erg');
    expectDirected(plain, directed);
    expect(directed.riding).toEqual(plain.riding);
    expect(directed.release.map((write) => write.bytes)).toEqual(
      plain.release.map((write) => write.bytes),
    );
  });

  describe('never in a lap race (ADR 0072 D-1.2)', () => {
    const RACE: LapRaceChoice = { laps: 2, bots: 1, tier: 'brisk', itemsOn: false };

    /** A loop ridden with the AI pacer consented to, raced or not; what the instance was asked. */
    async function askedOnLoop(
      race: LapRaceChoice | undefined,
      thresholds?: { readonly power: number; readonly heartRate: number },
    ): Promise<Asked> {
      const asked: Asked = { inputs: [], warms: [], starts: 0, ends: 0 };
      mounted = await mount(
        <GameView
          port={tracedPort(
            { id: 'route-loop', name: 'Loop', profile: circuitRoute(400), attempts: 0 },
            aiPacerPort(asked),
            thresholds,
          )}
          renderer={() => Promise.resolve(blankRenderer())}
          now={() => nowMs}
          {...(race === undefined ? {} : { lapRace: race })}
        />,
      );
      await settle();
      await press(toggle('Ride against a pacer'));
      await press(toggle('Let the AI on your instance steer the pacer'));
      await press(buttonStarting('Allow the AI pacer'));
      await press(buttonStarting('Ride '));
      for (let frame = 0; frame < 60; frame += 1) {
        const next = pending.shift();
        if (next === undefined) break;
        nowMs += FRAME_MS;
        await act(async () => {
          next(nowMs);
          await Promise.resolve();
        });
        await settle();
      }
      return asked;
    }

    it('sends the zones and the stretch above threshold when the port knows both thresholds (#2760)', async () => {
      // 100 W and 60 bpm sit below the whole trace, so the rider is above
      // threshold on every frame and in a zone.
      const asked = await askedOnLoop(undefined, { power: 100, heartRate: 60 });
      const last = asked.inputs.at(-1);
      expect(last).toHaveProperty('powerZone');
      expect(last).toHaveProperty('heartRateZone');
      expect(last?.aboveThresholdS).toBeGreaterThan(0);
    });

    it('asks the instance on the same loop when it is not raced', async () => {
      const asked = await askedOnLoop(undefined);
      expect(asked.starts).toBe(1);
      expect(asked.inputs.length).toBeGreaterThan(0);
    });

    it('claims no model slot and sends no pacer state in a lap race', async () => {
      const asked = await askedOnLoop(RACE);
      expect(asked.starts).toBe(0);
      expect(asked.inputs).toEqual([]);
    });
  });
});
