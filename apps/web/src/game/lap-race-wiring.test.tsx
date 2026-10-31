// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1906's wiring: a solo lap race against bots run inside a real game ride,
 * and **the trainer sent exactly what the same ride without it is sent** —
 * the behavioural half of ADR 0060 D-2.1, which
 * `lap-race/lap-race-cannot-reach-trainer.test.ts` (#1898) says no import walk
 * can see, in the shape `delivery-wiring.test.tsx` gave Delivery's DL5.
 *
 * The real `GameView`, picker, `GameSimulation`, gradient driver and writer,
 * race, bots, items, HUD and announcer; what is read is what a **trainer** was
 * handed, what the **store** kept, what the **frames** carried and what the
 * HUD **said**. The only doubles are the store behind `GamePort`, the GL
 * context, the clock and the platform's random source, which is stubbed so
 * the race's seed is known.
 *
 * ## The scripted ride
 *
 * One power trace, a function of the ride's clock alone, ridden as an
 * ordinary ride, as a lap race with items off and as one with items on in
 * which the rider is hit more than once. The rider's lane and item presses
 * are scripted ({@link PRESSES}) against a **shadow**: a `GameSimulation`
 * built as `GameView` builds one, advanced on the same clock with the same
 * power, and the same pure race (`lap-race/ride-race.ts`) stepped on it. The
 * seed is the first whose shadow race hits the rider twice and finishes in
 * the trace. The real ride is held to what the shadow predicts: its finish
 * sentence, and where each frame drew the rider across the road.
 *
 * Every shared ride runs with every network primitive replaced by a refusal
 * that counts its calls (ADR 0060 D-7.3, CLAUDE.md §1).
 */

import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { seconds, watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { activityId, lapId, recordingSessionId } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { riderMassFor } from '../athlete/mass';
import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { roomPortOver } from '../net/room-port';
import { ManualClock, ScriptedRoom } from '../net/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { SteerIntent } from './lanes';
import { LAP_RACE_ASSIST_STORAGE_KEY } from './lap-race/assist-preference';
import { HIT_GLOW_MEAN } from './lap-race/in-view';
import {
  askRaceItem,
  askRaceLane,
  LAP_RACE_RIDER_ID,
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceChoice,
  type LapRaceRide,
} from './lap-race/ride-race';
import type { GameRenderer, SceneFrame } from './port';
import { lineOffsetAt, racingLine } from './racing-line';
import {
  LAP_RACE_SCENE_DRAW_CALLS,
  STYLISED_SCENE_DRAW_CALLS,
  stylisedSceneDrawCallCeiling,
} from './realistic-budget';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { GameSimulation, SIMULATION_STEP_SECONDS, type RiderInput } from './simulation';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';
import { writeRealisticWorldChoice } from './world-preference';

/** Every sentence the real announcer said, in order. */
const said = vi.hoisted((): string[] => []);
vi.mock('./hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hud/announce')>();
  return {
    ...actual,
    announce: (...args: Parameters<typeof actual.announce>) => {
      const heard = actual.announce(...args);
      if (heard.sentence !== undefined) said.push(heard.sentence);
      return heard;
    },
  };
});

/** What each drawn frame's input said of the rider and the race, in order. */
interface DrawnInput {
  readonly riderDistance: number;
  readonly odometer: number;
  readonly steeredLateral: number | undefined;
  readonly bots: number | undefined;
}
const inputs = vi.hoisted((): DrawnInput[] => []);
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      const input = args[0];
      inputs.push({
        riderDistance: input.riderDistance ?? Number.NaN,
        odometer: input.state.ride.distance,
        steeredLateral: input.steeredLateral,
        bots: input.raceBots?.length,
      });
      return actual.sceneFrame(...args);
    },
  };
});

/** A loop of about 250 m that climbs and falls, so its grades are worth writing. */
const RADIUS = 40;
const CIRCUIT = circuitRoute(
  RADIUS,
  (along) => 2.5 * Math.sin((along / (2 * Math.PI * RADIUS)) * 2 * Math.PI),
);
const ROUTE: RidableRoute = { id: 'lap-race', name: 'Race loop', profile: CIRCUIT, attempts: 0 };

/** Two laps against seven bots of about the rider's pace. */
const RACE: LapRaceChoice = { laps: 2, bots: 7, tier: 'hard', itemsOn: true };
const ITEMS_OFF: LapRaceChoice = { ...RACE, itemsOn: false };

/** Ten simulation steps a frame: a slow frame, so every frame runs the several-steps path. */
const FRAME_MS = 500;
const START_MS = 1_000_000;
/** 70 s of ride: two laps, and long enough after the line for the finish to be said. */
const FRAMES = 140;

/** The scripted power trace: a function of the ride's clock alone, the same in every ride. */
function powerAt(nowMs: number): number {
  return 290 + 70 * Math.sin((nowMs - START_MS) / 6_000);
}

/** The rider's presses after each frame's tick, by frame index: lanes, and the item key often. */
const PRESSES: ReadonlyMap<number, SteerIntent | 'item'> = new Map<number, SteerIntent | 'item'>([
  [6, 'lane-left'],
  [30, 'lane-right'],
  [31, 'lane-right'],
  [70, 'lane-left'],
  ...Array.from({ length: 13 }, (_, index): [number, 'item'] => [12 + index * 9, 'item']),
]);

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

function port(route: RidableRoute = ROUTE): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(powerAt(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function capturingRenderer(frames: SceneFrame[], realistic?: { asked: number }): GameRenderer {
  return {
    loadRealisticWorld: () => {
      if (realistic !== undefined) realistic.asked += 1;
      return Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' });
    },
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** One write a trainer was handed, and when. */
interface Write {
  readonly parameters: SimulationParameters;
  readonly atMs: number;
}

/** A ready trainer, through the real `gameTrainerPortOver`, that records every write and its time. */
function trainerPort(written: Write[]): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      written.push({ parameters, atMs: nowMs });
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

/** Every network call the ride attempted, by primitive: each is refused, and the count must stay nought. */
const reached: string[] = [];

/** Every way this client could reach the network, each replaced by a refusal that counts. */
function forbidTheNetwork(): void {
  const refuse = (name: string) => (): never => {
    reached.push(name);
    throw new Error(`a solo lap race must not reach the network: it called ${name}`);
  };
  vi.stubGlobal('fetch', refuse('fetch'));
  vi.stubGlobal('XMLHttpRequest', refuse('XMLHttpRequest'));
  vi.stubGlobal('WebSocket', refuse('WebSocket'));
  vi.stubGlobal('EventSource', refuse('EventSource'));
  vi.stubGlobal('RTCPeerConnection', refuse('RTCPeerConnection'));
  vi.stubGlobal('Image', refuse('Image'));
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: refuse('navigator.sendBeacon') });
}

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  said.length = 0;
  inputs.length = 0;
  localStorage.clear();
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
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

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

function buttonStarting(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith(words),
  );
}

/** One animation frame, as `delivery-wiring.test.tsx` §`pump` runs one. */
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

/** The key the HUD maps to a lane change or the item (`lanes.ts`, `item-input.ts`). */
async function press(what: SteerIntent | 'item'): Promise<void> {
  const [key, code] =
    what === 'item' ? ['w', 'KeyW'] : what === 'lane-left' ? ['a', 'KeyA'] : ['d', 'KeyD'];
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, cancelable: true }));
    await Promise.resolve();
  });
}

/** The lap race's HUD fields' text, in order: none on a ride with no race. */
function raceFields(): string[] {
  return queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-hud__field--lap-race').map(
    (each) => (each.textContent ?? '').trim(),
  );
}

// ---------------------------------------------------------------------------
// The shadow of the ride, and the script.
// ---------------------------------------------------------------------------

interface ShadowFrame {
  readonly steps: number;
  readonly along: number;
}

/** `frames` frames of the scripted ride, advanced as `GameView`'s tick advances its simulation. */
function shadowRide(frames: number): ShadowFrame[] {
  const simulation = new GameSimulation({
    profile: CIRCUIT,
    conditions: rideConditionsFor(riderMassFor(undefined).mass, DEFAULT_RIDING_POSITION),
  });
  const out: ShadowFrame[] = [];
  for (let frame = 1; frame <= frames; frame += 1) {
    const at = START_MS + frame * FRAME_MS;
    const input: RiderInput = { power: watts(powerAt(at)), live: true };
    const { steps } = simulation.advanceTo(at, input);
    out.push({ steps, along: simulation.state.ride.distance });
  }
  return out;
}

interface Script {
  readonly seed: number;
  readonly ride: LapRaceRide;
  /** How many distinct hits moved the rider back. */
  readonly hits: number;
  /** Where the shadow race had steered the rider after each frame's tick, by frame index. */
  readonly steered: readonly number[];
  /** The rider's race offset after each frame's tick, by frame index. */
  readonly offsets: readonly number[];
  /** The frame the rider crossed the line on. */
  readonly finishedFrame: number | undefined;
}

/** The shadow's race under `seed`, with {@link PRESSES} taken as `GameView`'s ports take them. */
function scriptFor(seed: number, choice: LapRaceChoice, shadow: readonly ShadowFrame[]): Script {
  stubSeed(seed);
  const conditions = rideConditionsFor(riderMassFor(undefined).mass, DEFAULT_RIDING_POSITION);
  let ride = startLapRaceRide({
    choice,
    profile: CIRCUIT,
    conditions: lapRaceBotConditions(CIRCUIT, conditions),
    riderDistance: 0,
    lineOffset: lineOffsetAt(racingLine(CIRCUIT), 0),
    storage: undefined,
  });
  vi.restoreAllMocks();
  if (ride === undefined) throw new Error('the circuit is a loop, so a race starts on it');
  const hits = new Set<string>();
  const steered: number[] = [];
  const offsets: number[] = [];
  let finishedFrame: number | undefined;
  shadow.forEach((frame, index) => {
    if (ride === undefined) return;
    if (frame.steps > 0) ride = stepLapRaceRide(ride, { ticks: frame.steps, along: frame.along });
    const me = ride.race.racers.find((entry) => entry.racer.id === LAP_RACE_RIDER_ID);
    for (const effect of me?.effects ?? []) {
      if (effect.rateMetresPerSecond < 0) hits.add(`${String(effect.fromMs)}`);
    }
    if (finishedFrame === undefined && me?.racer.finishedAtMs !== null) finishedFrame = index;
    steered.push(ride.input.steer.offset);
    offsets.push(me?.racer.raceOffset ?? 0);
    const asked = PRESSES.get(index);
    if (asked === 'item') ride = askRaceItem(ride);
    else if (asked !== undefined) ride = askRaceLane(ride, asked);
  });
  return { seed, ride, hits: hits.size, steered, offsets, finishedFrame };
}

let script: Script;

beforeAll(() => {
  const shadow = shadowRide(FRAMES);
  for (let seed = 1; seed < 200; seed += 1) {
    const found = scriptFor(seed, RACE, shadow);
    if (found.hits >= 2 && found.finishedFrame !== undefined && found.finishedFrame < FRAMES - 20) {
      script = found;
      return;
    }
  }
  throw new Error('no seed hit the rider twice in a race finished inside the trace');
});

/** Mount the game, press Ride, and ride the scripted trace, pressing as the script says when racing. */
async function rideTheTrace(options: {
  readonly race: LapRaceChoice | undefined;
  readonly trainer?: GameTrainerPort | undefined;
  readonly drawn?: SceneFrame[] | undefined;
  readonly onFrame?: ((index: number) => Promise<void>) | undefined;
  readonly frames?: number | undefined;
  readonly route?: RidableRoute | undefined;
  readonly realistic?: { asked: number } | undefined;
  /** Filled with what each drawn frame's input said, by frame index. */
  readonly seen?: Map<number, DrawnInput> | undefined;
  readonly room?: Pick<Parameters<typeof GameView>[0], 'room' | 'roomId'> | undefined;
  readonly delivery?: boolean | undefined;
  /** The presses to make, {@link PRESSES} unless given. */
  readonly presses?: ReadonlyMap<number, SteerIntent | 'item'> | undefined;
}): Promise<void> {
  stubSeed(script.seed);
  mounted = await mount(
    <GameView
      port={port(options.route)}
      {...(options.trainer === undefined ? {} : { trainer: options.trainer })}
      renderer={() => Promise.resolve(capturingRenderer(options.drawn ?? [], options.realistic))}
      now={() => nowMs}
      {...(options.race === undefined ? {} : { lapRace: options.race })}
      {...(options.delivery === undefined ? {} : { delivery: options.delivery })}
      {...(options.room ?? {})}
    />,
  );
  await settle();
  await clickThrough(buttonStarting('Ride '));
  for (let index = 0; index < (options.frames ?? FRAMES); index += 1) {
    const built = inputs.length;
    await pump();
    const input = inputs.at(-1);
    if (inputs.length > built && input !== undefined) options.seen?.set(index, input);
    await options.onFrame?.(index);
    const asked = options.race === undefined ? undefined : (options.presses ?? PRESSES).get(index);
    if (asked !== undefined) await press(asked);
  }
  await settle();
}

/** What one scripted ride left. */
interface RideResult {
  readonly writes: readonly Write[];
  readonly drawn: readonly SceneFrame[];
  readonly inputs: ReadonlyMap<number, DrawnInput>;
  readonly said: readonly string[];
  readonly fields: readonly string[];
  readonly standings: string;
  readonly reached: readonly string[];
}

/** The scripted ride, start to *End ride*, with the network refused, read and unmounted. */
async function rideOnce(race: LapRaceChoice | undefined): Promise<RideResult> {
  pending = [];
  nowMs = START_MS;
  said.length = 0;
  inputs.length = 0;
  reached.length = 0;
  forbidTheNetwork();
  const writes: Write[] = [];
  const drawn: SceneFrame[] = [];
  const seen = new Map<number, DrawnInput>();
  const standings = (): string =>
    mounted?.container.querySelector('.oyl-hud__standings')?.textContent ?? '';
  let midRace = '';
  await rideTheTrace({
    race,
    trainer: trainerPort(writes),
    drawn,
    seen,
    // Mid-race, half way round the first lap: every racer still riding.
    onFrame: (index) => {
      if (index === 30) midRace = standings();
      return Promise.resolve();
    },
  });
  const read = { said: [...said], inputs: seen, fields: raceFields(), standings: midRace };
  await clickThrough(buttonStarting('End ride'));
  mounted?.unmount();
  mounted = undefined;
  return { ...read, writes, drawn, reached: [...reached] };
}

/** The three shared rides, each ridden once by the first case that asks. */
let plainRide: Promise<RideResult> | undefined;
let offRide: Promise<RideResult> | undefined;
let onRide: Promise<RideResult> | undefined;
const plain = (): Promise<RideResult> => (plainRide ??= rideOnce(undefined));
const itemsOff = (): Promise<RideResult> => (offRide ??= rideOnce(ITEMS_OFF));
const itemsOn = (): Promise<RideResult> => (onRide ??= rideOnce(RACE));

/**
 * A case that may ride the shared rides, which the first to ask pays for:
 * about three times their cost under coverage, as `docs/agents/ci.md` §4c
 * asks of a case slow under coverage. Measured 2026-10-31 on an Apple M-series
 * Mac without coverage: the first case, paying for two rides, 472 ms; the
 * D-2.1 case, paying for the third, 214 ms. The CI runners' figures are not
 * measured yet.
 */
const SHARED_RIDE = { timeout: 10_000 } as const;

describe('a solo lap race inside a game ride — #1906', () => {
  it('fixture: the shadow race hits the rider twice and finishes inside the trace', () => {
    expect(script.hits).toBeGreaterThanOrEqual(2);
    expect(script.finishedFrame).toBeLessThan(FRAMES - 20);
    // Items moved the rider off their effort distance, which is what D-2.1 is about.
    expect(Math.min(...script.offsets)).toBeLessThan(-1);
    expect(LAP_RACE_TICK_SECONDS).toBe(SIMULATION_STEP_SECONDS);
  });

  it(
    'runs the race the shadow predicts: its finish said, its racers drawn, the rider drawn at the race position',
    SHARED_RIDE,
    async () => {
      const ride = await itemsOn();
      const ordinary = await plain();
      const me = script.ride.race.racers.find((entry) => entry.racer.id === LAP_RACE_RIDER_ID);
      if (me === undefined || me.racer.finishedAtMs === null)
        throw new Error('the shadow rider did not finish');
      // The finish the shadow predicts is the one the real ride says, once.
      const finishes = ride.said.filter((text) => text.startsWith('Finished, '));
      expect(script.ride.owed.finish).toMatch(/^Finished, \d of 8, in /u);
      expect(finishes).toEqual([script.ride.owed.finish]);
      // A hit and a lap were said through the one region.
      expect(
        ride.said.some((text) => /^(Hit by a crosswind gust|Rode through a puddle)/u.test(text)),
      ).toBe(true);
      expect(ride.said.some((text) => text.startsWith('Lap 1 of 2 done.'))).toBe(true);
      // The standings name the bots by tier and give W/kg, the rider's own included, never watts.
      expect(ride.standings).toContain('Hard bot 1');
      const perKilogram = [...ride.standings.matchAll(/(\d+\.\d) W\/kg/gu)].map((each) =>
        Number(each[1]),
      );
      expect(perKilogram.length).toBeGreaterThan(1);
      // A W/kg a person or a bot of these tiers rides at, never a figure in watts.
      for (const value of perKilogram) expect(value).toBeGreaterThan(1);
      for (const value of perKilogram) expect(value).toBeLessThan(8);
      expect(ride.standings).not.toMatch(/\d W\b(?!\/)/u);
      // The HUD's place field says the rider is over the line.
      expect(
        ride.fields.some((text) => text.startsWith('Place') && text.includes('Finished')),
      ).toBe(true);
      // Every drawn frame carried the race and its seven bots' inputs.
      expect(ride.drawn.length).toBeGreaterThan(100);
      expect(ride.drawn.every((frame) => frame.lapRace !== undefined)).toBe(true);
      // So every frame of the race is held to its own ceiling (#1903, ADR 0060 D-10.2).
      for (const frame of ride.drawn) {
        expect(stylisedSceneDrawCallCeiling(frame)).toBe(LAP_RACE_SCENE_DRAW_CALLS);
      }
      const drawnInputs = [...ride.inputs.values()];
      expect(drawnInputs.every((input) => input.bots !== undefined)).toBe(true);
      expect(drawnInputs.some((input) => input.bots === 7)).toBe(true);
      expect(ride.drawn[0]?.lapRace?.pickUps.length).toBeGreaterThan(0);
      expect(ride.inputs.size).toBeGreaterThan(100);
      for (const [index, input] of ride.inputs) {
        // Steered as the shadow steered: each frame's lateral, from the race's own steering.
        expect(input.steeredLateral, `frame ${String(index)}`).toBe(script.steered[index]);
        // Drawn at effort distance plus race offset: where the ordinary ride
        // drew the rider, moved by the shadow's offset, on the same odometer.
        const was = ordinary.inputs.get(index);
        expect(input.odometer, `frame ${String(index)}`).toBe(was?.odometer);
        expect(input.riderDistance - (was?.riderDistance ?? Number.NaN)).toBeCloseTo(
          script.offsets[index] ?? Number.NaN,
          9,
        );
      }
      // The offset was not nought throughout: some frame drew the rider off their odometer.
      expect(script.offsets.some((offset) => Math.abs(offset) > 1)).toBe(true);
    },
  );

  it(
    'sends the trainer the same writes, each grade at the same time, as an ordinary ride, a race with items off and one with the rider hit (D-2.1)',
    SHARED_RIDE,
    async () => {
      const ordinary = await plain();
      const off = await itemsOff();
      const on = await itemsOn();
      // Non-vacuity: the road climbs and falls, the writes are many, and the
      // items-on race moved the rider off their effort distance.
      expect(ordinary.writes.length).toBeGreaterThan(30);
      const grades = ordinary.writes.map((each) => each.parameters.grade);
      expect(Math.max(...grades)).toBeGreaterThan(1);
      expect(Math.min(...grades)).toBeLessThan(-1);
      // The items-off race ran, and drew no pick-up point: nothing is picked up there.
      expect(off.drawn.every((frame) => frame.lapRace !== undefined)).toBe(true);
      expect(off.drawn.every((frame) => frame.lapRace?.pickUps.length === 0)).toBe(true);
      expect(on.drawn.some((frame) => (frame.lapRace?.pickUps.length ?? 0) > 0)).toBe(true);
      expect(script.hits).toBeGreaterThanOrEqual(2);
      expect(off.writes).toStrictEqual(ordinary.writes);
      expect(on.writes).toStrictEqual(ordinary.writes);
    },
  );

  it(
    'runs a whole race with every network primitive refused, and reaches none (D-7.3)',
    SHARED_RIDE,
    async () => {
      const on = await itemsOn();
      const off = await itemsOff();
      expect(on.said.filter((text) => text.startsWith('Finished, '))).toHaveLength(1);
      expect(on.reached).toEqual([]);
      expect(off.reached).toEqual([]);
    },
  );

  it(
    'runs nothing of a race without the option: no field, no bots, no pick-ups, nothing said',
    SHARED_RIDE,
    async () => {
      const ordinary = await plain();
      expect(ordinary.drawn.length).toBeGreaterThan(100);
      expect(ordinary.drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
      // An ordinary ride's frame keeps the stylised world's own budget.
      for (const frame of ordinary.drawn) {
        expect(stylisedSceneDrawCallCeiling(frame)).toBe(STYLISED_SCENE_DRAW_CALLS);
      }
      expect([...ordinary.inputs.values()].every((input) => input.bots === undefined)).toBe(true);
      expect(ordinary.fields).toEqual([]);
      expect(ordinary.said.filter((text) => /^(Finished|Lap \d of \d done)/u.test(text))).toEqual(
        [],
      );
    },
  );

  it('ends the race cleanly when End ride comes mid-race, and the next ride starts a fresh one', async () => {
    const rejected: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejected.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      // Past the first lap's line, on the last lap.
      await rideTheTrace({ race: RACE, frames: 70 });
      expect(raceFields()[0]).toMatch(/Lap 2 of 2/u);
      await clickThrough(buttonStarting('End ride'));
      // Back on the picker: no race on the screen, and no frame asked for.
      expect(raceFields()).toEqual([]);
      expect(buttonStarting('Ride ')).toBeDefined();
      pending = [];
      for (let index = 0; index < 5; index += 1) await settle();
      expect(pending).toEqual([]);
      // A new ride is a new race, on its line: lap 1 again, nobody finished.
      stubSeed(script.seed);
      await clickThrough(buttonStarting('Ride '));
      await pump();
      await pump();
      const fields = raceFields();
      expect(fields).toHaveLength(2);
      expect(fields[0]).toMatch(/Lap 1 of 2/u);
      await clickThrough(buttonStarting('End ride'));
      for (let index = 0; index < 5; index += 1) await settle();
      expect(rejected).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('runs no race on a ride in a room, which is solo’s alone (D-7.3, D-8)', async () => {
    const clock = new ManualClock();
    const room = new ScriptedRoom();
    const drawn: SceneFrame[] = [];
    await rideTheTrace({
      race: RACE,
      drawn,
      frames: 8,
      room: {
        room: roomPortOver(() => room.link(), { timers: clock, now: () => nowMs }),
        roomId: 'room-1',
      },
    });
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
    expect(raceFields()).toEqual([]);
  });

  it('runs no race on a ride running a Delivery round, one mode a ride', async () => {
    const drawn: SceneFrame[] = [];
    await rideTheTrace({ race: RACE, delivery: true, drawn, frames: 6 });
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
    expect(raceFields()).toEqual([]);
  });

  it('starts the race with the device’s assisted setting: items off and gentler bots (#1905)', async () => {
    localStorage.setItem(
      LAP_RACE_ASSIST_STORAGE_KEY,
      JSON.stringify({ itemsOff: true, autoUse: false, noKnockBack: false, gentlerBots: true }),
    );
    await rideTheTrace({ race: RACE, frames: 6 });
    // Items off: the place field and no item field.
    expect(raceFields()).toHaveLength(1);
    const standings = mounted?.container.querySelector('.oyl-hud__standings')?.textContent ?? '';
    // One tier below the chosen 'hard'.
    expect(standings).toContain('Brisk bot');
    expect(standings).not.toContain('Hard bot');
  });

  it('draws a hit steady under reduced motion (WCAG 2.3.1)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const drawn: SceneFrame[] = [];
    await rideTheTrace({ race: RACE, drawn, frames: 80 });
    const hits = drawn.flatMap((frame) => frame.markers.flatMap((marker) => marker.hit ?? []));
    expect(hits.length).toBeGreaterThan(5);
    for (const hit of hits) expect(hit).toEqual({ glow: HIT_GLOW_MEAN, scale: 1, spin: 0 });
  });

  it('takes no lane or item press while the ride is paused, and the next ones once it rides again', async () => {
    await rideTheTrace({ race: RACE, frames: 40, presses: new Map() });
    const item = (): string => raceFields()[1] ?? '';
    const lateral = (): number | undefined => inputs.at(-1)?.steeredLateral;
    const holding = item();
    // Past the first pick-up point, so the rider holds something to use.
    expect(holding).toMatch(/^Item(?!None)/u);
    const line = lateral();
    await clickThrough(buttonStarting('Pause'));
    await press('lane-left');
    await press('item');
    await clickThrough(buttonStarting('Resume'));
    for (let index = 0; index < 8; index += 1) await pump();
    // Neither was taken: the same item held, and the rider still on their line.
    expect(item()).toBe(holding);
    expect(lateral()).toBe(line);
    // Riding again, both are.
    await press('lane-left');
    await press('item');
    for (let index = 0; index < 8; index += 1) await pump();
    expect(item()).not.toBe(holding);
    expect(lateral()).toBeLessThan((line ?? 0) - 1);
  });

  it('runs no race on a route that is not a loop: an ordinary ride', async () => {
    const drawn: SceneFrame[] = [];
    const road: RidableRoute = { ...ROUTE, id: 'out', profile: northRoute(800, () => 0) };
    await rideTheTrace({ race: RACE, frames: 6, drawn, route: road });
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
    expect(raceFields()).toEqual([]);
  });

  it('rides the stylised world for a race when Settings chose the realistic one (D-10)', async () => {
    writeRealisticWorldChoice(localStorage, true);
    const realistic = { asked: 0 };
    await rideTheTrace({ race: RACE, frames: 4, realistic });
    expect(raceFields().length).toBe(2);
    expect(realistic.asked).toBe(0);
    mounted?.unmount();
    mounted = undefined;
    // The control: an ordinary ride with the same choice asks for the realistic world.
    pending = [];
    nowMs = START_MS;
    await rideTheTrace({ race: undefined, frames: 4, realistic });
    expect(realistic.asked).toBe(1);
  });
});

// ---------------------------------------------------------------------------

/** What the store gave back for a recorded ride. */
interface Recorded {
  readonly power: readonly (number | undefined)[];
  readonly cadence: readonly (number | undefined)[];
  readonly heartRate: readonly (number | undefined)[];
  readonly speed: readonly (number | undefined)[];
  readonly distance: number;
  readonly movingSeconds: number;
  readonly laps: readonly unknown[];
}

describe('the recorded ride is unchanged by a lap race — #1906 (D-2.4)', () => {
  /** The scripted ride, recorded by the real ride controller against the #44 simulator, and saved. */
  async function recordedRide(race: LapRaceChoice | undefined): Promise<{
    readonly recorded: Recorded;
    readonly fields: readonly string[];
  }> {
    pending = [];
    nowMs = START_MS;
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
        newActivityId: () => activityId('the-ride'),
        newLapId: () => lapId(`lap-${String((laps += 1))}`),
        timeZone: 'Europe/London',
        store: {
          putFinishedRide: (ride) => harness.write(async (store) => store.putFinishedRide(ride)),
        },
      },
    });
    await controller.pair('trainer');
    await controller.start();
    await rideTheTrace({
      race,
      trainer: gameTrainerPortOver(controller),
      // The bench keeps whole seconds, so it runs one a frame: twice the
      // game's clock, which both rides share, and fine enough that a lap line
      // crossed a frame later is a lap a second longer (the race offset's
      // mutation in the pull request).
      onFrame: async () => {
        await act(async () => {
          bench.advance(seconds(1));
          await controller.tick(bench.now);
        });
      },
    });
    const fields = raceFields();
    await act(async () => {
      controller.armStop();
      await controller.confirmStop();
    });
    for (let index = 0; index < 10; index += 1) await settle();
    expect(controller.getSnapshot().saveState).toBe('saved');
    const [activity, streams, lapRows] = await harness.read(async (store) => [
      await store.getActivity(ATHLETE_A, activityId('the-ride')),
      await store.getStreamSet(ATHLETE_A, activityId('the-ride')),
      await store.listLaps(ATHLETE_A, activityId('the-ride')),
    ]);
    controller.dispose();
    await harness.destroy();
    mounted?.unmount();
    mounted = undefined;
    if (activity === undefined || streams === undefined) throw new Error('the ride was not saved');
    const { channels } = streams;
    return {
      fields,
      recorded: {
        power: [...(channels.power ?? [])],
        cadence: [...(channels.cadence ?? [])],
        heartRate: [...(channels.heartRate ?? [])],
        speed: [...(channels.speed ?? [])],
        distance: activity.distance,
        movingSeconds: activity.movingTime,
        laps: lapRows,
      },
    };
  }

  it(
    'stores the same power, cadence, heart rate, speed, distance, moving time and laps with the race as without it',
    // Two recorded rides: 596 ms on the same Mac without coverage.
    SHARED_RIDE,
    async () => {
      const without = await recordedRide(undefined);
      const raced = await recordedRide(RACE);
      // Non-vacuity: a ride was recorded with power, distance and both laps of
      // the loop in it, and the second ran its race to the line while it was.
      expect(without.recorded.power.length).toBeGreaterThan(30);
      expect(without.recorded.distance).toBeGreaterThan(0);
      expect(without.recorded.movingSeconds).toBeGreaterThan(30);
      expect(without.recorded.laps.length).toBeGreaterThanOrEqual(2);
      expect(without.fields).toEqual([]);
      expect(raced.fields.some((text) => text.includes('Finished'))).toBe(true);
      expect(raced.recorded).toStrictEqual(without.recorded);
    },
  );
});
