// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2461 (ADR 0067 D-3, AC3) through the real `GameView`: a rider 2 m behind a
 * bot for 30 s covers more effort distance than the same power trace with no
 * bot ahead, read off the game simulation's odometer, which the race's effort
 * distance reads. That is not the recorded ride: the saved activity's distance,
 * and the HUD's *Distance*, *Climbed* and *Avg power* (#2076), are the
 * recorder's, integrated from the trainer's measured speed. The second case
 * records the race through the real ride controller and reads the saved
 * activity back from the store: its speed and distance are the trainer's, and
 * the draft shows only in its lap times (ADR 0060's 2026-11-12 amendment).
 *
 * Its own file, not `lap-race-wiring.test.tsx`: ADR 0067 D-3.6 restates that
 * file "only as follows" and says nothing else in it changes. The harness here
 * is the least this one case needs: the real game, the real simulation (its
 * draft multiplier `k` watched at each `advanceTo`), a renderer that draws
 * nothing and a clock the test turns.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gradePercent, metresPerSecond, seconds, watts } from '@onyourleft/domain';
import {
  dragAreaSquareMetres,
  powerRequired,
  withDefaultCoefficients,
  withDragArea,
} from '@onyourleft/physics';
import { createSimulator, DEFAULT_RIDER, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { activityId, lapId, recordingSessionId } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { riderMassFor } from '../athlete/mass';
import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, settle, queryAll, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { LapRaceChoice } from './lap-race/choice';
import { lapRaceBotConditions, startLapRaceRide, stepLapRaceRide } from './lap-race/ride-race';
import type { GameRenderer } from './port';
import { lineOffsetAt, racingLine } from './racing-line';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { circuitRoute } from './route-fixtures-testing';
import { GameSimulation } from './simulation';
import { SOLO_DRAFT_STORAGE_KEY } from './solo-draft-preference';
import { gameTrainerPortOver, type GameTrainerPort } from './trainer-port';

/** The rider's draft multiplier `k` at each `advanceTo` of the ride being ridden. */
const draftTrace = vi.hoisted(() => ({ recorded: undefined as number[] | undefined }));
vi.mock('./simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulation')>();
  class TracedSimulation extends actual.GameSimulation {
    override advanceTo(
      ...args: Parameters<InstanceType<typeof actual.GameSimulation>['advanceTo']>
    ): ReturnType<InstanceType<typeof actual.GameSimulation>['advanceTo']> {
      draftTrace.recorded?.push(this.draftFactor);
      return super.advanceTo(...args);
    }
  }
  return { ...actual, GameSimulation: TracedSimulation };
});

/** The ride's odometer at each frame the game drew, from the simulation's own state. */
const odometers = vi.hoisted((): number[] => []);
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      odometers.push(args[0].state.ride.distance);
      return actual.sceneFrame(...args);
    },
  };
});

const RADIUS = 40;
/** Ten simulation steps a frame. */
const FRAME_MS = 500;
const START_MS = 1_000_000;
/** The race's seed, the same for the race and its shadow. */
const SEED = 7;

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  odometers.length = 0;
  localStorage.clear();
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: false }),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  draftTrace.recorded = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The race's seed, as `ride-race.ts` will draw it. */
function stubSeed(seed: number): void {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  );
}

const renderer: GameRenderer = {
  loadRealisticWorld: () =>
    Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
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

function port(route: RidableRoute, power: (at: number) => number): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(power(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

/**
 * Ride `frames` frames of `power` on the flat loop, with `race` or none; the
 * last odometer and every `k`. With `recorder`, the ride drives that trainer
 * port and calls `onFrame` after each frame.
 */
async function rideFlat(
  race: LapRaceChoice | undefined,
  power: (at: number) => number,
  frames: number,
  recorder?: {
    readonly trainer: GameTrainerPort;
    readonly onFrame: () => Promise<void>;
    /** After the last frame, before the game is unmounted. */
    readonly atEnd: () => Promise<void>;
  },
): Promise<{ readonly odometer: number; readonly trace: readonly number[] }> {
  pending = [];
  nowMs = START_MS;
  odometers.length = 0;
  const trace: number[] = [];
  draftTrace.recorded = trace;
  stubSeed(SEED);
  mounted = await mount(
    <GameView
      port={port(FLAT_ROUTE, power)}
      renderer={() => Promise.resolve(renderer)}
      now={() => nowMs}
      {...(race === undefined ? {} : { lapRace: race })}
      {...(recorder === undefined ? {} : { trainer: recorder.trainer })}
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
  for (let frame = 0; frame < frames; frame += 1) {
    const due = pending;
    if (due.length === 0) throw new Error('the ride asked for no frame');
    pending = [];
    nowMs += FRAME_MS;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
    await recorder?.onFrame();
  }
  await recorder?.atEnd();
  const odometer = odometers.at(-1) ?? Number.NaN;
  mounted.unmount();
  mounted = undefined;
  draftTrace.recorded = undefined;
  return { odometer, trace };
}

/** A flat loop, so the gap to a bot is the rider's power and the draft alone. */
const FLAT = circuitRoute(RADIUS, () => 0);
const FLAT_ROUTE: RidableRoute = { id: 'flat-race', name: 'Flat loop', profile: FLAT, attempts: 0 };

describe('the rider takes a draft from a bot, through the simulation only — #2461 (ADR 0067 D-3)', () => {
  /** One bot, no items: the bot the rider sits behind, and nothing else moving the race. */
  const ONE_BOT: LapRaceChoice = { laps: 4, bots: 1, tier: 'brisk', itemsOn: false };
  /** The gap the rider holds, metres behind the bot on effort distance, and how close to it. */
  const WHEEL_METRES = 2;
  const WHEEL_BAND_METRES = 0.5;
  /** A minute of ride: the gap settles in the first half and is held through the second. */
  const WHEEL_FRAMES = 120;
  /** 30 s of frames: the least the rider must sit on the wheel for. */
  const HELD_FRAMES = 60;

  /**
   * The shadow of a drafted one-bot race, with the rider holding the bot's
   * wheel at {@link WHEEL_METRES}, as `GameView` would ride it: the simulation,
   * the race stepped on it, and the rider's `k` handed back by `draftWith`.
   * The rider's power each frame is a rider's own: the power to ride at the
   * bot's speed, plus a little to close or open the gap, at the `k` the rider
   * is getting. What comes out is a power trace, a function of the clock.
   */
  function wheelShadow(): {
    readonly power: readonly number[];
    readonly gaps: readonly number[];
    readonly odometer: number;
  } {
    stubSeed(SEED);
    const conditions = rideConditionsFor(riderMassFor(undefined).mass, DEFAULT_RIDING_POSITION);
    let ride = startLapRaceRide({
      choice: ONE_BOT,
      profile: FLAT,
      conditions: lapRaceBotConditions(FLAT, conditions),
      riderDistance: 0,
      lineOffset: lineOffsetAt(racingLine(FLAT), 0),
      storage: undefined,
      draft: true,
      riderMassKilograms: riderMassFor(undefined).mass,
    });
    vi.restoreAllMocks();
    if (ride === undefined) throw new Error('the flat loop is a loop, so a race starts on it');
    const simulation = new GameSimulation({ profile: FLAT, conditions });
    const area = withDefaultCoefficients(conditions.coefficients);
    // Frame 0 is the press; frame 1 the first the simulation runs from.
    const power: number[] = [150, 150];
    const gaps: number[] = [];
    for (let frame = 1; frame <= WHEEL_FRAMES; frame += 1) {
      const { steps } = simulation.advanceTo(START_MS + frame * FRAME_MS, {
        power: watts(power[frame] ?? 0),
        live: true,
      });
      if (steps > 0) {
        ride = stepLapRaceRide(ride, {
          ticks: steps,
          along: simulation.state.ride.distance,
          riderWatts: power[frame] ?? 0,
        });
      }
      simulation.draftWith(ride.riderDraft);
      const bot = ride.bots[0];
      if (bot === undefined) throw new Error('a one-bot race has its bot');
      const gap = bot.ride.distance - simulation.state.ride.distance;
      gaps.push(gap);
      // The bot's speed, a fifth of the gap's error a second faster or slower,
      // reached in about a second.
      const speed = simulation.state.ride.speed as number;
      const target = Math.max(0.5, (bot.ride.speed as number) + 0.2 * (gap - WHEEL_METRES));
      const held = powerRequired({
        groundSpeed: metresPerSecond(target),
        totalMass: conditions.totalMass,
        grade: gradePercent(0),
        airDensityKilogramsPerCubicMetre: conditions.airDensityKilogramsPerCubicMetre,
        coefficients: { ...area, ...withDragArea(ride.riderDraft * dragAreaSquareMetres(area)) },
      }).totalWatts;
      const surge = (conditions.totalMass as number) * speed * (target - speed);
      power.push(Math.max(0, Math.min(800, held + surge)));
    }
    return { power, gaps, odometer: simulation.state.ride.distance };
  }

  it('carries a rider 2 m behind a bot for 30 s further than the same trace with no bot ahead, read off the ride the HUD reads', async () => {
    const shadow = wheelShadow();
    // The fixture: the rider sat within half a metre of 2 m behind the bot for
    // at least 30 s in a row.
    let run = 0;
    let longest = 0;
    for (const gap of shadow.gaps) {
      run = Math.abs(gap - WHEEL_METRES) <= WHEEL_BAND_METRES ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeGreaterThanOrEqual(HELD_FRAMES);
    const trace = (at: number): number =>
      shadow.power[Math.round((at - START_MS) / FRAME_MS)] ?? 150;
    // The device's default, the switch on, and the same trace on an ordinary ride.
    const drafted = await rideFlat(ONE_BOT, trace, WHEEL_FRAMES);
    const alone = await rideFlat(undefined, trace, WHEEL_FRAMES);
    // `GameState.ride.distance` on the last frame: the game simulation's
    // odometer, which the race's effort distance reads. Not the recorder's
    // distance, which the saved ride and the HUD's Distance field show.
    // The real ride is the shadow's, so its rider sat on the wheel too.
    expect(drafted.odometer).toBe(shadow.odometer);
    expect(drafted.trace.filter((k) => k < 0.75).length).toBeGreaterThanOrEqual(HELD_FRAMES);
    expect(alone.trace.every((k) => k === 1)).toBe(true);
    // Sheltered, the same power went further: by metres, not by rounding.
    expect(drafted.odometer).toBeGreaterThan(alone.odometer + 10);
  });

  /** What the store holds of a recorded ride, read back after the save. */
  interface Saved {
    readonly odometer: number;
    readonly trace: readonly number[];
    readonly speed: readonly (number | undefined)[];
    readonly sampleInterval: number;
    readonly distance: number;
    readonly lapSeconds: readonly number[];
  }

  /**
   * The wheel trace ridden as a one-bot race, recorded by the real ride
   * controller against the #44 simulator's trainer, saved, and read back
   * through the store. The switch is on unless `drafted` is false.
   */
  async function savedRace(drafted: boolean, power: (at: number) => number): Promise<Saved> {
    if (!drafted) localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    const harness = createStoreHarness();
    await seedAthletes(harness);
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
    });
    let laps = 0;
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
      openTrainer: simulatedOpenTrainer(bench, { written: [], refuseControl: false }),
      rideSave: {
        newActivityId: () => activityId('the-race'),
        newLapId: () => lapId(`lap-${String((laps += 1))}`),
        timeZone: 'Europe/London',
        store: {
          putFinishedRide: (ride) => harness.write(async (store) => store.putFinishedRide(ride)),
        },
      },
    });
    await controller.pair('trainer');
    await controller.start();
    const ridden = await rideFlat(ONE_BOT, power, RECORDED_FRAMES, {
      trainer: gameTrainerPortOver(controller),
      // The bench keeps whole seconds: one a frame.
      onFrame: async () => {
        await act(async () => {
          bench.advance(seconds(1));
          await controller.tick(bench.now);
        });
      },
      atEnd: async () => {
        await act(async () => {
          controller.armStop();
          await controller.confirmStop();
        });
        for (let index = 0; index < 10; index += 1) await settle();
      },
    });
    expect(controller.getSnapshot().saveState).toBe('saved');
    const [activity, streams, lapRows] = await harness.read(async (store) => [
      await store.getActivity(ATHLETE_A, activityId('the-race')),
      await store.getStreamSet(ATHLETE_A, activityId('the-race')),
      await store.listLaps(ATHLETE_A, activityId('the-race')),
    ]);
    controller.dispose();
    await harness.destroy();
    if (activity === undefined || streams === undefined) throw new Error('the ride was not saved');
    return {
      ...ridden,
      speed: [...(streams.channels.speed ?? [])],
      sampleInterval: streams.sampleInterval,
      distance: activity.distance,
      lapSeconds: lapRows.map((lap) => lap.elapsedTime as number),
    };
  }

  /** 40 s of ride: past the first lap line drafted and undrafted. */
  const RECORDED_FRAMES = 80;

  it('saves the trainer’s measured speed and distance with the switch on, and the draft only moves the lap times (ADR 0060 D-2.4, 2026-11-12)', async () => {
    const shadow = wheelShadow();
    const trace = (at: number): number =>
      shadow.power[Math.round((at - START_MS) / FRAME_MS)] ?? 150;
    const on = await savedRace(true, trace);
    const off = await savedRace(false, trace);
    // Not vacuous: the switch-on rider sat in the draft, and in the game it
    // went further on the same power than with the switch off.
    expect(on.trace.filter((k) => k < 0.75).length).toBeGreaterThanOrEqual(HELD_FRAMES / 2);
    expect(off.trace.every((k) => k === 1)).toBe(true);
    expect(on.odometer).toBeGreaterThan(off.odometer + 10);
    // The saved speed is the trainer's measured speed, every sample: no draft in it.
    for (const ride of [on, off]) {
      const measured = ride.speed.filter((value) => value !== undefined);
      expect(measured.length).toBeGreaterThan(30);
      expect(new Set(measured)).toStrictEqual(new Set([DEFAULT_RIDER.speed as number]));
      // The saved distance is that channel integrated, not the game's odometer.
      expect(ride.distance).toBe(
        measured.reduce((sum, value) => sum + value * ride.sampleInterval, 0),
      );
    }
    // The draft reaches the saved ride through the lap line only: reached sooner.
    expect(on.lapSeconds.length).toBeGreaterThanOrEqual(1);
    expect(off.lapSeconds.length).toBeGreaterThanOrEqual(1);
    expect(on.lapSeconds[0]).toBeLessThan(off.lapSeconds[0] ?? 0);
  });
});
