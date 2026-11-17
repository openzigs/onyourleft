// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2656's wiring: **the HUD's *Pause* pauses the ride**, so a pause neither
 * runs the moving time on nor lowers an average.
 *
 * The owner's report of 2026-11-15, on the tablet: *"when you pause a ride
 * timer still goes which changes averages."* Until #2656 the game's *Pause*
 * paused the SIMULATION and nothing else (`trainer-port.ts`
 * §`GameTrainerPort.rideMovingSeconds` said so): the recording under the ride
 * went on taking every reading the trainer sent, and a trainer's flywheel
 * still turning is movement (`recording/channels.ts` §`isMovingReading`), so
 * the auto-pause never came. *Moving* ran on through the pause, the paused
 * seconds' zero watts went into *Avg power* and *Energy*, the flywheel's
 * speed into *Distance*, and the saved ride and every export said the same.
 *
 * Two rides through the production path, as `power-shown-wiring.test.tsx`
 * rides them: the #44 simulator's trainer, the real ride controller recording
 * it, `gameSensors` over its snapshot, the real `GameView` and HUD, and the
 * trainer written through `gameTrainerPortOver(controller)`. The only doubles
 * are the store (`createStoreHarness`), the GL context and the clock.
 *
 * - **Ridden straight through**: twenty seconds of 200 and 300 W by turns.
 * - **Paused part-way**: the same first ten seconds, then the HUD's *Pause*,
 *   twenty seconds in which the rider is off the bike and the trainer goes on
 *   reporting — 0 W, no cadence, the flywheel still turning at 3 m/s — then
 *   *Resume* and the same last ten seconds.
 *
 * Each is read back the ways a real consumer reads it — the HUD as drawn, the
 * activity the store kept, and each export imported again — and the paused
 * ride must say what the straight one says, except *Elapsed*, which is wall
 * time from the start and honestly carries the pause.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type Seconds,
} from '@onyourleft/domain';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import {
  activityId,
  recordingSessionId,
  workoutId,
  type ActivityRecord,
  type WorkoutRecord,
} from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { exportActivity } from '../transfer/export-activity';
import type { ActivityFileFormat } from '../transfer/file-format';
import { readActivityFile, type ImportedRide } from '../transfer/read-activity-file';
import { RideView } from '../views/RideView';

import { GameView, type RidableRoute } from './GameView';
import { DEFAULT_HUD_LAYOUT, writeHudLayout } from './hud/hud-layout-preference';
import type { GameRenderer } from './port';
import { northRoute } from './route-fixtures-testing';
import { gameSensors } from './sensors';
import { gameTrainerPortOver } from './trainer-port';

const START_MS = 1_000_000;
/** Four frames a second of the game's clock; the bench keeps whole seconds. */
const FRAME_MS = 250;
const FRAMES_PER_SECOND = 1000 / FRAME_MS;
/** The seconds ridden before the pause, and again after it. */
const RIDDEN_EACH_SIDE = 10;
/** How long the paused ride is paused for. */
const PAUSED_SECONDS = 20;

/** A steady 250 W as the pedal stroke delivers it: 200 and 300 by turns. */
function powerInSecond(ridden: number): number {
  return ridden % 2 === 0 ? 200 : 300;
}

const ROUTE: RidableRoute = {
  id: 'north',
  name: 'North road',
  profile: northRoute(2_000, (along) => along * 0.03),
  attempts: 0,
};

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

/** A renderer that draws nothing, and says so, so no frame is built for it (#2524). */
function renderer(): GameRenderer {
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

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  if (element === undefined) throw new Error('no such button');
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
}

/** The HUD's button whose text is exactly `name`, as a rider finds it. */
function button(name: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (each) => (each.textContent ?? '').trim() === name,
  );
}

/** One animation frame. */
async function pump(): Promise<void> {
  const due = pending;
  if (due.length === 0) throw new Error('the ride asked for no frame');
  pending = [];
  nowMs += FRAME_MS;
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The value of the HUD reading whose term is `label`, as drawn: value and unit. */
function shown(label: string): string {
  const term = queryAll(mounted?.container ?? document, '.oyl-hud dt').find(
    (each) => (each.textContent ?? '').trim() === label,
  );
  const value = term?.nextElementSibling?.textContent;
  if (value === undefined || value === null) throw new Error(`the HUD shows no ${label}`);
  return value.trim();
}

/** A ride time as the HUD draws it, `h:mm:ss`, in seconds. */
function secondsOf(drawn: string): number {
  const parts = /^(\d+):(\d\d):(\d\d)$/.exec(drawn);
  if (parts === null) throw new Error(`not a ride time: ${drawn}`);
  return Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
}

/** What the HUD drew of the ride, the moment before it ended. */
interface HudFigures {
  readonly moving: string;
  readonly elapsed: string;
  readonly distance: string;
  readonly averagePower: string;
  readonly averageSpeed: string;
  readonly energy: string;
}

function hudFigures(): HudFigures {
  return {
    moving: shown('Moving'),
    elapsed: shown('Elapsed'),
    distance: shown('Distance'),
    averagePower: shown('Avg power'),
    averageSpeed: shown('Avg speed'),
    energy: shown('Energy'),
  };
}

/** What an export said once it was read back in. */
interface ReadBack {
  readonly movingTime: Seconds;
  readonly distance: number;
  readonly averagePower: number | undefined;
}

const EXPORTS: readonly ActivityFileFormat[] = ['fit', 'gpx', 'tcx'];

/** Everything one ride left, in each consumer. */
interface Ridden {
  readonly hud: HudFigures;
  /** *Moving* and *Elapsed* as drawn at the start and the end of the pause. */
  readonly duringPause:
    { readonly from: HudFigures; readonly to: HudFigures; readonly writes: number } | undefined;
  readonly activity: ActivityRecord;
  readonly exported: Readonly<Record<ActivityFileFormat, ReadBack>>;
  /** Every write to the trainer's control point, as octets. */
  readonly written: readonly (readonly number[])[];
}

/** One ride, recorded by the real controller against the #44 simulator. */
async function ride(paused: boolean): Promise<Ridden> {
  pending = [];
  nowMs = START_MS;
  // #2387's strip on, for *Avg speed* and *Energy*.
  writeHudLayout(localStorage, { ...DEFAULT_HUD_LAYOUT, totalsStrip: true });
  const harness = createStoreHarness();
  await seedAthletes(harness);
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  const written: number[][] = [];
  const controller = createRideController({
    transport,
    store: {
      putRecordingSession: async (record) =>
        harness.write(async (store) => store.putRecordingSession(record)),
      appendRecordingChunk: async (chunk) =>
        harness.write(async (store) => store.appendRecordingChunk(chunk)),
      readRecordingSessions: async (owner) =>
        harness.write(async (store) => store.readRecordingSessions(owner)),
      recoverRecording: async (owner, id) =>
        harness.write(async (store) => store.recoverRecording(owner, id)),
      deleteRecordingSession: async (owner, id) =>
        harness.write(async (store) => store.deleteRecordingSession(owner, id)),
    },
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-1'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written, refuseControl: false }),
    rideSave: {
      newActivityId: () => activityId('the-ride'),
      newLapId: () => {
        throw new Error('this ride has no laps');
      },
      timeZone: 'Europe/London',
      store: {
        putFinishedRide: (finished) =>
          harness.write(async (store) => store.putFinishedRide(finished)),
      },
    },
  });
  await controller.pair('trainer');
  await controller.start();

  mounted = await mount(
    <GameView
      port={{
        listRoutes: () => Promise.resolve([ROUTE]),
        loadGhost: () => Promise.resolve(undefined),
        readSensors: () => gameSensors(controller.getSnapshot()),
      }}
      trainer={gameTrainerPortOver(controller)}
      renderer={() => Promise.resolve(renderer())}
      now={() => nowMs}
    />,
  );
  await settle();
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((each) =>
      (each.textContent ?? '').startsWith('Ride '),
    ),
  );

  /** One second of the trainer's readings, as the controller is ticked on the Ride screen. */
  const second = async (): Promise<void> => {
    await act(async () => {
      bench.advance(seconds(1));
      await controller.tick(bench.now);
    });
  };
  let ridden = 0;
  /** `count` seconds of riding: 200 and 300 W by turns, 90 rpm, 9 m/s, four frames each. */
  const rideFor = async (count: number): Promise<void> => {
    for (let each = 0; each < count; each += 1) {
      bench.rider.set({
        power: watts(powerInSecond(ridden)),
        cadence: revolutionsPerMinute(90),
        speed: metresPerSecond(9),
      });
      ridden += 1;
      await second();
      for (let frame = 0; frame < FRAMES_PER_SECOND; frame += 1) await pump();
    }
  };

  await rideFor(RIDDEN_EACH_SIDE);
  let duringPause: Ridden['duringPause'];
  if (paused) {
    await clickThrough(button('Pause'));
    const from = hudFigures();
    const writesBefore = written.length;
    // Off the bike: no watts, no cadence, and the flywheel still turning.
    bench.rider.set({
      power: watts(0),
      cadence: revolutionsPerMinute(0),
      speed: metresPerSecond(3),
    });
    for (let each = 0; each < PAUSED_SECONDS; each += 1) await second();
    await settle();
    duringPause = { from, to: hudFigures(), writes: written.length - writesBefore };
    await clickThrough(button('Resume'));
  }
  await rideFor(RIDDEN_EACH_SIDE);
  await settle();
  const hud = hudFigures();

  await act(async () => {
    controller.armStop();
    await controller.confirmStop();
  });
  for (let index = 0; index < 10; index += 1) await settle();
  expect(controller.getSnapshot().saveState).toBe('saved');
  const activity = await harness.read(async (store) =>
    store.getActivity(ATHLETE_A, activityId('the-ride')),
  );
  if (activity === undefined) throw new Error('the ride was not saved');
  const exported = {} as Record<ActivityFileFormat, ReadBack>;
  for (const format of EXPORTS) {
    const file = await harness.read(async (store) =>
      exportActivity({ store, athleteId: ATHLETE_A, activityId: activity.id, format }),
    );
    const back: ImportedRide = readActivityFile(file.file.fileName, file.file.bytes);
    exported[format] = {
      movingTime: back.movingTime,
      distance: Math.round(back.distance),
      averagePower: back.averagePower,
    };
  }
  controller.dispose();
  await harness.destroy();
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  return { hud, duringPause, activity, exported, written };
}

/**
 * Each ride, ridden once by the first case that asks for it, so a case pays
 * for one ride (#1688: a slow case is made cheaper, never given a longer
 * timeout).
 */
const rides = new Map<boolean, Promise<Ridden>>();
function ridden(paused: boolean): Promise<Ridden> {
  let run = rides.get(paused);
  if (run === undefined) {
    run = ride(paused);
    rides.set(paused, run);
  }
  return run;
}

describe('a pause on the HUD pauses the ride — #2656', () => {
  it('holds Moving still through the pause while Elapsed goes on, and sends the trainer nothing', async () => {
    const { duringPause } = await ridden(true);
    if (duringPause === undefined) throw new Error('the ride was not paused');
    expect(duringPause.to.moving).toBe(duringPause.from.moving);
    // Non-vacuity: the HUD was drawn again through the pause, and Elapsed,
    // wall time from the start, carries it.
    expect(secondsOf(duringPause.to.elapsed) - secondsOf(duringPause.from.elapsed)).toBe(
      PAUSED_SECONDS,
    );
    // Nor do the paused seconds' zeros reach the averages as they arrive.
    expect(duringPause.to.averagePower).toBe(duringPause.from.averagePower);
    expect(duringPause.to.distance).toBe(duringPause.from.distance);
    // The trainer: nothing written while paused, as before #2656.
    expect(duringPause.writes).toBe(0);
  });

  it('gives the HUD the averages of the same ride with no pause, Elapsed aside', async () => {
    const straight = await ridden(false);
    const paused = await ridden(true);
    // Non-vacuity: the straight ride rode, and its figures are figures.
    expect(secondsOf(straight.hud.moving)).toBeGreaterThanOrEqual(2 * RIDDEN_EACH_SIDE);
    expect(straight.hud.averagePower).toMatch(/^2\d\d W$/);
    expect(straight.hud.averageSpeed).toMatch(/^\d+\.\d km\/h$/);
    expect(straight.hud.energy).toMatch(/^\d+ kJ$/);

    expect(paused.hud.moving).toBe(straight.hud.moving);
    expect(paused.hud.distance).toBe(straight.hud.distance);
    expect(paused.hud.averagePower).toBe(straight.hud.averagePower);
    expect(paused.hud.averageSpeed).toBe(straight.hud.averageSpeed);
    expect(paused.hud.energy).toBe(straight.hud.energy);
    expect(secondsOf(paused.hud.elapsed)).toBe(secondsOf(straight.hud.elapsed) + PAUSED_SECONDS);
  });

  it('saves the averages of the same ride with no pause, with the pause as paused time', async () => {
    const straight = await ridden(false);
    const paused = await ridden(true);
    expect(straight.activity.movingTime).toBeGreaterThanOrEqual(2 * RIDDEN_EACH_SIDE);
    expect(paused.activity.movingTime).toBe(straight.activity.movingTime);
    expect(paused.activity.elapsedTime).toBe(straight.activity.elapsedTime + PAUSED_SECONDS);
    expect(paused.activity.distance).toBe(straight.activity.distance);
    expect(straight.activity.averagePower).toBeGreaterThan(200);
    expect(paused.activity.averagePower).toBe(straight.activity.averagePower);
  });

  it('exports the same averages in FIT, GPX and TCX, read back in, with FIT keeping the pause', async () => {
    const straight = await ridden(false);
    const paused = await ridden(true);
    for (const format of EXPORTS) {
      expect(paused.exported[format].averagePower, format).toBe(
        straight.exported[format].averagePower,
      );
      expect(paused.exported[format].distance, format).toBe(straight.exported[format].distance);
    }
    // Non-vacuity: FIT carries power, and the moving time with the pause out
    // of it. GPX and TCX state no moving time (`export-activity.ts`
    // §`LOSSY_CHANNELS`, the rider is told before choosing).
    expect(paused.exported.fit.averagePower).toBe(paused.activity.averagePower);
    expect(paused.exported.fit.movingTime).toBe(straight.exported.fit.movingTime);
  });

  it('sends the trainer what the straight ride sends it, and nothing for the pause', async () => {
    const straight = await ridden(false);
    const paused = await ridden(true);
    expect(straight.written.length).toBeGreaterThan(1);
    expect(paused.written).toStrictEqual(straight.written);
  });
});

/**
 * Under a running ERG workout — the owner's ruling on #2667, 2026-11-15:
 * *"During a workout, the game HUD's Pause should behave like the Ride
 * screen's Pause: it pauses the recording and the workout, which eases the
 * trainer to its floor, and Resume sets the interval's target again."*
 *
 * The same production path as above, with the trainer under control and one
 * long steady interval running. The machine's floor is not 0 W, so the ease
 * is told apart from any other write; the interval's target is 300 W.
 */
const FLOOR = 40;
const THRESHOLD = watts(250);
const INTERVAL_WATTS = 300;
/** FTMS *Set Target Power*: op code 0x05, then the watts as a little-endian sint16. */
function setTargetPower(target: number): readonly number[] {
  return [0x05, target & 0xff, (target >> 8) & 0xff];
}

const HARD_AND_LONG: WorkoutRecord = {
  id: workoutId('w2656-pause'),
  createdBy: ATHLETE_A,
  name: 'Hard',
  workout: {
    name: 'Hard',
    blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(1.2) }],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

/** Who pressed *Pause*: nobody, the game HUD, or the Ride screen. */
type PausedBy = 'nobody' | 'hud' | 'ride-screen';

/** What a workout ride left. */
interface WorkoutRidden {
  /** Every write to the trainer's control point, as octets. */
  readonly written: readonly (readonly number[])[];
  /** The writes from the *Pause* press to the *Resume* press. */
  readonly whilePaused: readonly (readonly number[])[];
  /**
   * The writes from the *Pause* press to the end of the first second after it,
   * the rider still pedalling: the pause's own ease, told apart from a stall
   * rescue's (#585), which eases a rider who stops pedalling.
   */
  readonly atPause: readonly (readonly number[])[];
  /** The writes from the *Resume* press to the end of the first second after it. */
  readonly onResume: readonly (readonly number[])[];
  /** The HUD's figures at the *Pause* press and before *Resume*; game rides only. */
  readonly duringPause: { readonly from: HudFigures; readonly to: HudFigures } | undefined;
  /**
   * The bench seconds from the *Pause* press to the *Resume* press. More than
   * {@link PAUSED_SECONDS}: the simulated trainer takes a bench second to
   * answer each control-point write (`simulated-trainer-testing.ts`), and
   * the ease is written inside the pause.
   */
  readonly pausedFor: number;
  /** The HUD's figures before the end; game rides only. */
  readonly hud: HudFigures | undefined;
  readonly activity: ActivityRecord;
}

/** One workout ride, recorded by the real controller against the #44 simulator. */
async function workoutRide(pausedBy: PausedBy): Promise<WorkoutRidden> {
  pending = [];
  nowMs = START_MS;
  writeHudLayout(localStorage, { ...DEFAULT_HUD_LAYOUT, totalsStrip: true });
  const harness = createStoreHarness();
  await seedAthletes(harness);
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A', minTargetPower: watts(FLOOR) })],
  });
  const written: number[][] = [];
  const controller = createRideController({
    transport,
    store: {
      putRecordingSession: async (record) =>
        harness.write(async (store) => store.putRecordingSession(record)),
      appendRecordingChunk: async (chunk) =>
        harness.write(async (store) => store.appendRecordingChunk(chunk)),
      readRecordingSessions: async (owner) =>
        harness.write(async (store) => store.readRecordingSessions(owner)),
      recoverRecording: async (owner, id) =>
        harness.write(async (store) => store.recoverRecording(owner, id)),
      deleteRecordingSession: async (owner, id) =>
        harness.write(async (store) => store.deleteRecordingSession(owner, id)),
    },
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-1'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written, refuseControl: false }),
    rideSave: {
      newActivityId: () => activityId('the-ride'),
      newLapId: () => {
        throw new Error('this ride has no laps');
      },
      timeZone: 'Europe/London',
      store: {
        putFinishedRide: (finished) =>
          harness.write(async (store) => store.putFinishedRide(finished)),
      },
    },
  });
  await controller.pair('trainer');
  await controller.requestTrainerControl();
  await controller.start();
  expect(controller.startWorkout(HARD_AND_LONG, THRESHOLD)).toBe(true);

  const inGame = pausedBy !== 'ride-screen';
  if (inGame) {
    mounted = await mount(
      <GameView
        port={{
          listRoutes: () => Promise.resolve([ROUTE]),
          loadGhost: () => Promise.resolve(undefined),
          readSensors: () => gameSensors(controller.getSnapshot()),
        }}
        trainer={gameTrainerPortOver(controller)}
        renderer={() => Promise.resolve(renderer())}
        now={() => nowMs}
      />,
    );
    await settle();
    await clickThrough(
      queryAll<HTMLButtonElement>(mounted.container, 'button').find((each) =>
        (each.textContent ?? '').startsWith('Ride '),
      ),
    );
  } else {
    mounted = await mount(<RideView controller={controller} />);
    await settle();
  }

  const second = async (): Promise<void> => {
    await act(async () => {
      bench.advance(seconds(1));
      await controller.tick(bench.now);
    });
  };
  let ridden = 0;
  const rideFor = async (count: number): Promise<void> => {
    for (let each = 0; each < count; each += 1) {
      bench.rider.set({
        power: watts(powerInSecond(ridden)),
        cadence: revolutionsPerMinute(90),
        speed: metresPerSecond(9),
      });
      ridden += 1;
      await second();
      if (inGame) for (let frame = 0; frame < FRAMES_PER_SECOND; frame += 1) await pump();
    }
  };

  await rideFor(RIDDEN_EACH_SIDE);
  let whilePaused: number[][] = [];
  let eased: number[][] = [];
  let onResume: number[][] = [];
  let duringPause: WorkoutRidden['duringPause'];
  let pausedFor = 0;
  if (pausedBy !== 'nobody') {
    const atPause = written.length;
    const benchAtPause = Number(bench.now);
    // The HUD's button, or the Ride screen's: both are named so to a rider.
    await clickThrough(button('Pause'));
    const from = inGame ? hudFigures() : undefined;
    // The first second still pedalling, as a rider presses Pause before they
    // stop: the ease that comes in it is the pause's, as a stall rescue
    // (#585) eases a rider at 0 rpm too, and nothing else is.
    await second();
    eased = written.slice(atPause);
    // Then off the bike: no watts, no cadence, and the flywheel still turning.
    bench.rider.set({
      power: watts(0),
      cadence: revolutionsPerMinute(0),
      speed: metresPerSecond(3),
    });
    for (let each = 1; each < PAUSED_SECONDS; each += 1) await second();
    await settle();
    if (from !== undefined) duringPause = { from, to: hudFigures() };
    const atResume = written.length;
    pausedFor = Number(bench.now) - benchAtPause;
    whilePaused = written.slice(atPause, atResume);
    await clickThrough(button('Resume'));
    await rideFor(1);
    await settle();
    onResume = written.slice(atResume);
    await rideFor(RIDDEN_EACH_SIDE - 1);
  } else {
    await rideFor(RIDDEN_EACH_SIDE);
  }
  await settle();
  const hud = inGame ? hudFigures() : undefined;

  await act(async () => {
    controller.armStop();
    await controller.confirmStop();
  });
  for (let index = 0; index < 10; index += 1) await settle();
  expect(controller.getSnapshot().saveState).toBe('saved');
  const activity = await harness.read(async (store) =>
    store.getActivity(ATHLETE_A, activityId('the-ride')),
  );
  if (activity === undefined) throw new Error('the ride was not saved');
  controller.dispose();
  await harness.destroy();
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  return { written, whilePaused, atPause: eased, onResume, duringPause, pausedFor, hud, activity };
}

/** Each workout ride, ridden once by the first case that asks for it (#1688). */
const workoutRides = new Map<PausedBy, Promise<WorkoutRidden>>();
function workoutRidden(pausedBy: PausedBy): Promise<WorkoutRidden> {
  let run = workoutRides.get(pausedBy);
  if (run === undefined) {
    run = workoutRide(pausedBy);
    workoutRides.set(pausedBy, run);
  }
  return run;
}

describe('a pause on the HUD under a workout is the Ride screen’s pause — owner ruling on #2667', () => {
  it('eases the trainer to its floor at the pause, and writes nothing else while paused', async () => {
    const { atPause, whilePaused } = await workoutRidden('hud');
    expect(atPause).toStrictEqual([setTargetPower(FLOOR)]);
    expect(whilePaused).toStrictEqual([setTargetPower(FLOOR)]);
  });

  it('writes the interval’s target again on Resume, and nothing else', async () => {
    const { onResume } = await workoutRidden('hud');
    expect(onResume).toStrictEqual([setTargetPower(INTERVAL_WATTS)]);
  });

  it('sends the trainer exactly what the Ride screen’s Pause and Resume send it', async () => {
    const hud = await workoutRidden('hud');
    const rideScreen = await workoutRidden('ride-screen');
    // Non-vacuity: the Ride screen's pause eased and re-targeted too.
    expect(rideScreen.atPause).toStrictEqual([setTargetPower(FLOOR)]);
    expect(rideScreen.whilePaused).toStrictEqual([setTargetPower(FLOOR)]);
    expect(rideScreen.onResume).toStrictEqual([setTargetPower(INTERVAL_WATTS)]);
    expect(hud.atPause).toStrictEqual(rideScreen.atPause);
    expect(hud.whilePaused).toStrictEqual(rideScreen.whilePaused);
    expect(hud.onResume).toStrictEqual(rideScreen.onResume);
    expect(hud.written).toStrictEqual(rideScreen.written);
  });

  it('keeps the pause out of Moving and the averages, on the HUD and in the saved ride', async () => {
    const straight = await workoutRidden('nobody');
    const paused = await workoutRidden('hud');
    const rideScreen = await workoutRidden('ride-screen');
    const during = paused.duringPause;
    if (during === undefined || paused.hud === undefined || straight.hud === undefined) {
      throw new Error('the game ride drew no HUD');
    }
    // Through the pause the HUD holds Moving and every average, while Elapsed,
    // wall time from the start, goes on.
    expect(during.to.moving).toBe(during.from.moving);
    expect(during.to.averagePower).toBe(during.from.averagePower);
    expect(during.to.distance).toBe(during.from.distance);
    expect(during.to.energy).toBe(during.from.energy);
    expect(secondsOf(during.to.elapsed) - secondsOf(during.from.elapsed)).toBe(paused.pausedFor);
    // Non-vacuity: with nobody pausing, Moving is Elapsed.
    expect(straight.hud.moving).toBe(straight.hud.elapsed);
    expect(straight.activity.movingTime).toBe(straight.activity.elapsedTime);
    expect(paused.pausedFor).toBeGreaterThanOrEqual(PAUSED_SECONDS);
    // …and with the HUD's pause, Moving is Elapsed less the pause: on the HUD
    // and in the saved ride.
    expect(secondsOf(paused.hud.moving)).toBe(secondsOf(paused.hud.elapsed) - paused.pausedFor);
    expect(paused.activity.movingTime).toBe(paused.activity.elapsedTime - paused.pausedFor);
    // The paused seconds' readings — the trainer at its floor, the rider's
    // 0 W — are not in the average. With them it would fall under 200 W.
    expect(straight.activity.averagePower).toBeGreaterThan(250);
    expect(paused.activity.averagePower).toBeGreaterThan(250);
    // The same saved ride as the Ride screen's Pause makes, figure for figure.
    expect(paused.activity.movingTime).toBe(rideScreen.activity.movingTime);
    expect(paused.activity.elapsedTime).toBe(rideScreen.activity.elapsedTime);
    expect(paused.activity.averagePower).toBe(rideScreen.activity.averagePower);
    expect(paused.activity.distance).toBe(rideScreen.activity.distance);
  });
});
