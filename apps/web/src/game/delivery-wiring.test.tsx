// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1816's wiring: a Delivery round run inside a real game ride, and **the
 * trainer sent exactly what the same ride without it is sent** — the
 * behavioural half of the owner's ruling DL5 (ADR 0059 D-2), which
 * `delivery/delivery-cannot-reach-trainer.test.ts` (#1807) says no import walk
 * can see.
 *
 * Built in the style of `trainer-wiring.test.tsx` (#362): the real
 * `GameView`, the real picker, the real `GameSimulation`, the real gradient
 * driver and writer, the real round, throw, obstacles, HUD and announcer, and
 * what is read is what a **trainer** was handed, what the **store** kept and
 * what the **device** kept. The only doubles are the store behind
 * `GamePort`, the GL context, the clock and the platform's random source,
 * which is stubbed so the round's seed is known.
 *
 * ## The scripted ride
 *
 * One power trace, a function of the ride's clock alone, ridden twice: once
 * as an ordinary ride and once with a round on. The round's throws are
 * scripted against a **shadow** of the ride — a `GameSimulation` built as
 * `GameView` builds one and advanced on the same clock with the same power —
 * so the test knows where the rider is on each frame and presses a throw key
 * where a parcel lands on a doorstep. One house is passed with no throw, so it
 * is missed, and the seed is the first whose obstacles the rider rides into,
 * so there is a crash. The shadow runs the same pure round
 * (`delivery/ride-round.ts`), and the HUD of the real ride is held to what it
 * predicts: a wiring that dropped a step, a throw or a crash is red there.
 *
 * Since #1853 the script also presses the lane keys ({@link STEERS}), so every
 * case that rides it — DL5's writes and the stored ride among them — rides
 * with steering in it, and each drawn frame's `steeredLateral` is read back
 * off the input `sceneFrame` was handed and held to the shadow's.
 *
 * ## Offered in the chooser — #1818
 *
 * The last block mounts the game with no `delivery` prop, as a rider reaches
 * it, chooses *Ride a Delivery round* in the real chooser with the realistic
 * world chosen, and reads what the ride did from the rendered HUD and the
 * device's storage: a round where the town holds one; where it has too few
 * houses, or none in reach, or no corridor at all, a notice in words, an
 * ordinary ride and the week as it was; and the assist setting reaching it.
 */

import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { seconds, watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { activityId, lapId, recordingSessionId } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { riderMassFor } from '../athlete/mass';
import { roomPortOver } from '../net/room-port';
import { ManualClock, ScriptedRoom } from '../net/testing';
import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { DELIVERY_ASSIST_STORAGE_KEY, type DeliveryAssist } from './delivery/assist-preference';
import { DELIVERY_PROGRESS_STORAGE_KEY, readDeliveryProgress } from './delivery/delivery-progress';
import { deliveryTown } from './delivery/delivery-town-testing';
import { pickRoundTargets } from './delivery/targets';
import { startDeliveryRide, stepDeliveryRide, type DeliveryRide } from './delivery/ride-round';
import { FEWEST_DELIVERY_HOUSES, roundTally, type WeekProgress } from './delivery/round';
import { LANE_OFFSETS_METRES, startSteer, steerToward, type SteerIntent } from './delivery/steer';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  type ThrowSide,
} from './delivery/throw';
import { FOOTPRINT_MAX_VERTICES, footprintPlans } from './footprint-buildings';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import { HOUSES_NOT_READY_TEXT, TOO_FEW_HOUSES_TEXT } from './hud/delivery-announce';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import type { GameRenderer, SceneFrame } from './port';
import { lineOffsetAt, racingLine } from './racing-line';
import { DELIVERY_VILLAGE_DRAW_CALLS, villageDrawCallCeiling } from './realistic-budget';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { GameSimulation, type RiderInput } from './simulation';
import { corridorOrigin } from './terrain';
import { DELIVERY_CHOICE_TEXT } from './StageChooser';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';
import { urbanClassMap } from './urban-class';
import type { CorridorState, WorldCorridor } from './world-data/corridor';
import { writeRealisticWorldChoice } from './world-preference';

/**
 * What `GameView` offered the announcer, kind by kind — `trainer-wiring.test.tsx`'s
 * seam — and every sentence the real announcer said, in order.
 */
const offered = vi.hoisted((): string[] => []);
const said = vi.hoisted((): string[] => []);
vi.mock('./hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hud/announce')>();
  return {
    ...actual,
    announce: (...args: Parameters<typeof actual.announce>) => {
      for (const event of args[1].events ?? []) offered.push(event.kind);
      const heard = actual.announce(...args);
      if (heard.sentence !== undefined) said.push(heard.sentence);
      return heard;
    },
  };
});

/** Set by one case: the round's step then faults, as a RangeError guard in it would. */
const roundFaults = vi.hoisted(() => ({ on: false }));
/** Every round `GameView` started, as `startDeliveryRide` returned it (#1853). */
const startedRounds = vi.hoisted((): unknown[] => []);
vi.mock('./delivery/ride-round', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./delivery/ride-round')>();
  return {
    ...actual,
    startDeliveryRide: (...args: Parameters<typeof actual.startDeliveryRide>) => {
      const started = actual.startDeliveryRide(...args);
      startedRounds.push(started);
      return started;
    },
    stepDeliveryRide: (...args: Parameters<typeof actual.stepDeliveryRide>) => {
      if (roundFaults.on) throw new RangeError('the round faulted');
      return actual.stepDeliveryRide(...args);
    },
  };
});

/**
 * The `steeredLateral` of every input `GameView` built a frame from, in order
 * — #1853. `scene.ts` §`SceneInput.steeredLateral` is optional the unsafe way
 * round, so it is read back off the input the drawn frame was made from.
 */
const steeredInputs = vi.hoisted((): (number | undefined)[] => []);
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      steeredInputs.push(args[0].steeredLateral);
      return actual.sceneFrame(...args);
    },
  };
});

const town = deliveryTown('delivery-wiring');
const ROUTE: RidableRoute = {
  id: 'delivery-wiring',
  name: 'Delivery town',
  profile: town.profile,
  attempts: 0,
};

/** A short week's round, so a test rides it whole: three houses, on day 2. */
const WEEK: WeekProgress = { day: 2, houses: 3, score: 4 };

/**
 * How much wall clock one pumped frame covers: four simulation steps, which
 * is a slow frame on the tablet, so every frame here runs `ride-round.ts`'
 * several-steps path. Four rather than one keeps the ride's cost down: a
 * frame is a React render.
 */
const FRAME_MS = 200;
const START_MS = 1_000_000;

/** The scripted power trace: a function of the ride's clock alone, the same in every ride. */
function powerAt(nowMs: number): number {
  return 290 + 70 * Math.sin((nowMs - START_MS) / 6_000);
}

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

function port(): GamePort {
  return portWith(town.corridor);
}

/** The game's port over `corridor` for {@link ROUTE}'s road; `undefined` reads no corridor at all. */
function portWith(corridor: WorldCorridor | undefined): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    ...(corridor === undefined
      ? {}
      : { loadWorldCorridor: () => Promise.resolve({ kind: 'ready' as const, corridor }) }),
    readSensors: () => ({
      rider: { power: watts(powerAt(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
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

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  offered.length = 0;
  said.length = 0;
  localStorage.clear();
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
  );
  localStorage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK));
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

/** The round's seed, as `drawRoundSeed` will draw it. */
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

/**
 * One animation frame, as a browser runs it: every callback asked for before
 * the frame runs in it, with the one timestamp, and a callback asked for
 * during it waits for the next. The clock moves once a frame, not once a
 * callback, so another `requestAnimationFrame` consumer (the HUD's gamepad
 * poll, #1821) cannot spend one of the ride's frames.
 */
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

/** The key the HUD's throw control maps to a side (`throw-input.ts` §`THROW_KEYS`). */
async function pressThrow(side: ThrowSide): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: side === 'left' ? 'ArrowLeft' : 'ArrowRight',
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

/** The key the HUD's lane keys map to a lane change (`steer.ts` §`STEER_KEYS`). */
async function pressSteer(intent: SteerIntent): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: intent === 'lane-left' ? 'a' : 'd',
        code: intent === 'lane-left' ? 'KeyA' : 'KeyD',
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

/** A HUD field's value and the phrase under it, by its key's label. */
function field(label: string): { readonly value: string; readonly detail: string } | undefined {
  const items = queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-hud__field--delivery');
  const found = items.find((each) => (each.textContent ?? '').startsWith(label));
  if (found === undefined) return undefined;
  return {
    // The value is the `dd`'s own text, before its unit and its phrase.
    value: found.querySelector('.oyl-hud__value')?.firstChild?.textContent ?? '',
    detail: (found.querySelector('.oyl-hud__detail')?.textContent ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------
// The shadow of the ride, and the script.
// ---------------------------------------------------------------------------

/** Where the shadow ride was after each frame's tick, as `GameView`'s own simulation is. */
interface ShadowFrame {
  readonly steps: number;
  readonly along: number;
  readonly speed: number;
}

/** `frames` frames of the scripted ride, advanced as `GameView`'s tick advances its simulation. */
function shadowRide(frames: number): ShadowFrame[] {
  const simulation = new GameSimulation({
    profile: town.profile,
    conditions: rideConditionsFor(riderMassFor(undefined).mass, DEFAULT_RIDING_POSITION),
  });
  const out: ShadowFrame[] = [];
  for (let frame = 1; frame <= frames; frame += 1) {
    const at = START_MS + frame * FRAME_MS;
    const input: RiderInput = { power: watts(powerAt(at)), live: true };
    const { steps } = simulation.advanceTo(at, input);
    out.push({ steps, along: simulation.state.ride.distance, speed: simulation.state.ride.speed });
  }
  return out;
}

/** `GameView`'s own plans of the town, as it makes them at the press. */
const BUILDINGS = (() => {
  const mask = landClassMask(town.corridor);
  const urban = urbanClassMap(town.corridor, mask, town.profile);
  const { plans } = footprintPlans(
    town.corridor,
    mask,
    town.profile,
    corridorOrigin(town.profile),
    FOOTPRINT_MAX_VERTICES,
    urban,
  );
  return mappedBuildingsOf(plans);
})();

/** The house passed with no throw, so it is missed. */
const SKIPPED = 1;

/**
 * The ride's frames, 66 s of it: through the round's last house, and on long
 * enough for every owed sentence to be said, one each `announce.ts`
 * §`ANNOUNCE_WINDOW_SECONDS`.
 */
const FRAMES = 330;

/**
 * The lane keys pressed after each frame's tick, by frame index — #1853: from
 * the lane the line starts in, two to the left, then back across the road and
 * once past its edge, so the ride is steered into every lane and through the
 * moves between them, and DL5's case rides with steering presses in it.
 */
const STEERS: ReadonlyMap<number, SteerIntent> = new Map([
  [30, 'lane-left'],
  [31, 'lane-left'],
  [100, 'lane-right'],
  [170, 'lane-right'],
  [171, 'lane-right'],
  [172, 'lane-right'],
  [240, 'lane-left'],
]);

interface Script {
  readonly seed: number;
  /** The throw pressed after each frame's tick, by frame index. */
  readonly throws: ReadonlyMap<number, ThrowSide>;
  /** What the shadow round came to. */
  readonly ride: DeliveryRide;
  readonly crashes: number;
  /** Where the shadow round had steered the rider after each frame's tick, by frame index. */
  readonly steered: readonly number[];
}

/**
 * Ride the shadow's round under `seed`: a throw after the frame on which the
 * rider is nearest the place a parcel lands on each house from, but the
 * {@link SKIPPED} one.
 */
function scriptFor(seed: number, shadow: readonly ShadowFrame[]): Script | undefined {
  stubSeed(seed);
  const store = new Map([[DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK)]]);
  let ride = startDeliveryRide({
    buildings: BUILDINGS,
    profile: town.profile,
    origin: corridorOrigin(town.profile),
    riderDistance: 0,
    lineOffset: lineOffsetAt(racingLine(town.profile), 0),
    storage: { getItem: (key) => store.get(key) ?? null, setItem: () => undefined },
  });
  vi.restoreAllMocks();
  if (ride === undefined) return undefined;
  const throws = new Map<number, ThrowSide>();
  const aimedAt = new Set<number>();
  const steered: number[] = [];
  let crashes = 0;
  let asked: ThrowSide | undefined;
  shadow.forEach((frame, index) => {
    if (ride === undefined) return;
    if (frame.steps > 0) {
      const stepped = stepDeliveryRide(ride, {
        ticks: frame.steps,
        along: frame.along,
        speed: frame.speed,
        throwTo: asked,
      });
      asked = undefined;
      ride = stepped.ride;
      crashes += stepped.crashes;
    }
    steered.push(ride.steer.offset);
    // The lane key pressed after this frame, as `GameView`'s port takes it.
    const intent = STEERS.get(index);
    if (intent !== undefined) ride = { ...ride, steer: steerToward(ride.steer, intent) };
    // One throw at each house but the skipped one, from where its parcel lands on the step.
    for (const target of ride.throwTargets) {
      if (target.position === SKIPPED || aimedAt.has(target.position)) continue;
      const across = CARRIAGEWAY_HALF_WIDTH_METRES + target.clear;
      const from = target.along - frame.speed * (across / PARCEL_THROW_SPEED_METRES_PER_SECOND);
      const next = shadow[index + 1]?.along ?? Infinity;
      // This frame, unless the next is nearer the place: a frame is metres of road.
      if (frame.along < from && next - from <= from - frame.along) continue;
      aimedAt.add(target.position);
      throws.set(index, target.side);
      asked = target.side;
      break;
    }
  });
  return { seed, throws, ride, crashes, steered };
}

let script: Script;

beforeAll(() => {
  const shadow = shadowRide(FRAMES);
  for (let seed = 1; seed < 400; seed += 1) {
    const found = scriptFor(seed, shadow);
    if (found === undefined) continue;
    const tally = roundTally(found.ride.round);
    if (found.crashes > 0 && tally.delivered > 0 && tally.missed > 0 && tally.expecting === 0) {
      script = found;
      return;
    }
  }
  throw new Error('no seed gave the scripted ride a delivery, a miss and a crash');
});

/** Mount the game, press Ride, and ride the scripted trace; throw as the script says when `delivery`. */
async function rideTheTrace(options: {
  readonly delivery: boolean;
  readonly trainer?: GameTrainerPort | undefined;
  readonly drawn?: SceneFrame[] | undefined;
  readonly onFrame?: ((index: number) => Promise<void>) | undefined;
  readonly room?: Pick<Parameters<typeof GameView>[0], 'room' | 'roomId'> | undefined;
  /** How many frames to ride: the whole trace unless given. */
  readonly frames?: number | undefined;
  /** Filled with the `steeredLateral` each drawn frame's input carried, by frame index. */
  readonly steered?: Map<number, number | undefined> | undefined;
}): Promise<void> {
  stubSeed(script.seed);
  mounted = await mount(
    <GameView
      port={port()}
      {...(options.trainer === undefined ? {} : { trainer: options.trainer })}
      renderer={() => Promise.resolve(capturingRenderer(options.drawn ?? []))}
      now={() => nowMs}
      delivery={options.delivery}
      {...(options.room ?? {})}
    />,
  );
  await settle();
  await clickThrough(buttonStarting('Ride '));
  for (let index = 0; index < (options.frames ?? FRAMES); index += 1) {
    const built = steeredInputs.length;
    await pump();
    if (steeredInputs.length > built) options.steered?.set(index, steeredInputs.at(-1));
    await options.onFrame?.(index);
    const side = options.delivery ? script.throws.get(index) : undefined;
    if (side !== undefined) await pressThrow(side);
    const intent = options.delivery ? STEERS.get(index) : undefined;
    if (intent !== undefined) await pressSteer(intent);
  }
  await settle();
}

// ---------------------------------------------------------------------------

/** What one scripted ride left: what the trainer, the frames, the HUD, the announcer and the device were handed. */
interface RideResult {
  readonly writes: readonly Write[];
  readonly drawn: readonly SceneFrame[];
  readonly houses: ReturnType<typeof field>;
  readonly score: ReturnType<typeof field>;
  readonly throwControl: boolean;
  readonly offered: readonly string[];
  readonly said: readonly string[];
  /** The week the device kept with the ride still going, and after *End ride*. */
  readonly keptRiding: WeekProgress;
  readonly keptEnded: WeekProgress;
  readonly storedKeys: readonly string[];
  /** The `steeredLateral` each drawn frame's input carried, by frame index (#1853). */
  readonly steered: ReadonlyMap<number, number | undefined>;
  /** Every round `GameView` started on the ride. */
  readonly started: readonly unknown[];
}

/** The scripted ride, start to *End ride*, read and unmounted. */
async function rideOnce(delivery: boolean): Promise<RideResult> {
  pending = [];
  nowMs = START_MS;
  offered.length = 0;
  said.length = 0;
  localStorage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK));
  const writes: Write[] = [];
  const drawn: SceneFrame[] = [];
  const steered = new Map<number, number | undefined>();
  startedRounds.length = 0;
  await rideTheTrace({ delivery, trainer: trainerPort(writes), drawn, steered });
  const read = {
    steered,
    started: [...startedRounds],
    houses: field('Houses'),
    score: field('Score'),
    throwControl: mounted?.container.querySelector('[aria-label="Throw a parcel"]') !== null,
    offered: [...offered],
    said: [...said],
    keptRiding: readDeliveryProgress(localStorage),
  };
  await clickThrough(buttonStarting('End ride'));
  const stored = JSON.parse(localStorage.getItem(DELIVERY_PROGRESS_STORAGE_KEY) ?? '{}') as object;
  const result: RideResult = {
    ...read,
    writes,
    drawn,
    keptEnded: readDeliveryProgress(localStorage),
    storedKeys: Object.keys(stored),
  };
  mounted?.unmount();
  mounted = undefined;
  return result;
}

/**
 * The two scripted rides several cases read — with a round and without —
 * each ridden once, by the first case that asks, so the file pays for two
 * rides rather than one a case.
 */
let withRoundRide: Promise<RideResult> | undefined;
let withoutRide: Promise<RideResult> | undefined;
const withRound = (): Promise<RideResult> => (withRoundRide ??= rideOnce(true));
const without = (): Promise<RideResult> => (withoutRide ??= rideOnce(false));

/**
 * A case that may ride the two shared rides, which the first to ask pays
 * for: about three times both rides together, as `docs/agents/ci.md` §4c
 * asks of a case slow under coverage. The figures, 2026-10-29, the first case
 * paying the round's ride and the DL5 case the plain one: 2 987 ms and
 * 2 252 ms under coverage (nightly 40888263731, AMD EPYC 9V45), 2 347 ms and
 * 1 775 ms without it (`Tests`, 40888263759, AMD EPYC 7763). A filtered run
 * of one of them rides both, 5.2 s.
 */
const SHARED_RIDE = { timeout: 16_000 } as const;

describe('a Delivery round inside a game ride — #1816', () => {
  it(
    'runs the round the script predicts: every house settled, a delivery, a miss and a crash',
    SHARED_RIDE,
    async () => {
      const ride = await withRound();
      const tally = roundTally(script.ride.round);
      // The real ride's HUD shows what the shadow's pure round came to.
      expect(ride.houses).toEqual({
        value: '0',
        detail: `${String(tally.delivered)}\u00a0delivered, ${String(tally.missed)}\u00a0missed`,
      });
      expect(ride.score).toEqual({
        value: String(script.ride.score),
        detail: `Day ${String(WEEK.day)} of 7`,
      });
      // The crash is in the score: fewer points than deliveries.
      expect(script.crashes).toBeGreaterThan(0);
      expect(script.ride.score).toBeLessThan(tally.delivered);
      // The throw control is on the HUD, and the round was said through the one region.
      expect(ride.throwControl).toBe(true);
      for (const kind of [
        'delivery-delivered',
        'delivery-missed',
        'delivery-crash',
        'delivery-round-over',
      ]) {
        expect(ride.offered, kind).toContain(kind);
      }
      // Each said once, never again (#647's owed rule, `hud/delivery-announce.ts`).
      const round = ride.said.filter((text) => /^(Delivered|Missed|Crashed|Round over)/.test(text));
      expect(round.some((text) => text.startsWith('Delivered to the 1st house'))).toBe(true);
      expect(round.some((text) => text.startsWith('Crashed into'))).toBe(true);
      expect(round.filter((text) => text.includes('Round over'))).toHaveLength(1);
      expect(new Set(round).size).toBe(round.length);
      // Every frame drawn carried the round, and so was held to Delivery's ceiling (DL6b).
      expect(ride.drawn.length).toBeGreaterThan(100);
      for (const frame of ride.drawn) {
        expect(frame.delivery).toBeDefined();
        expect(villageDrawCallCeiling(frame)).toBe(DELIVERY_VILLAGE_DRAW_CALLS);
      }
      // Markers stood on the houses at the start, and were gone once each was settled.
      expect(ride.drawn[0]?.delivery?.markers.length).toBeGreaterThan(0);
      expect(ride.drawn.at(-1)?.delivery?.markers).toEqual([]);
      expect(ride.drawn.some((frame) => (frame.delivery?.parcels.length ?? 0) > 0)).toBe(true);
      expect(ride.drawn.some((frame) => (frame.delivery?.obstacles.length ?? 0) > 0)).toBe(true);
    },
  );

  it(
    'sends the trainer the same writes, each grade at the same time, with the round as without it (DL5)',
    SHARED_RIDE,
    async () => {
      const plain = await without();
      const round = await withRound();
      // Non-vacuity: the round really ran, with a crash, and the road climbs and falls.
      expect(round.houses?.value).toBe('0');
      expect(script.crashes).toBeGreaterThan(0);
      expect(plain.writes.length).toBeGreaterThan(20);
      const grades = plain.writes.map((each) => each.parameters.grade);
      expect(Math.max(...grades)).toBeGreaterThan(1);
      expect(round.writes).toStrictEqual(plain.writes);
    },
  );

  it(
    'sends the grade the plain ride sends on a frame, even when the round’s step faults on it (DL5)',
    SHARED_RIDE,
    async () => {
      // A frame the plain ride writes on, after the first (which writes on the press).
      const plain = (await without()).writes;
      const second = plain[1];
      if (second === undefined) throw new Error('the plain ride wrote once or never');
      const frame = (second.atMs - START_MS) / FRAME_MS;
      expect(Number.isInteger(frame)).toBe(true);
      pending = [];
      nowMs = START_MS;
      stubSeed(script.seed);
      const writes: Write[] = [];
      mounted = await mount(
        <GameView
          port={port()}
          trainer={trainerPort(writes)}
          renderer={() => Promise.resolve(capturingRenderer([]))}
          now={() => nowMs}
          delivery
        />,
      );
      await settle();
      await clickThrough(buttonStarting('Ride '));
      for (let index = 1; index < frame; index += 1) await pump();
      roundFaults.on = true;
      try {
        await expect(pump()).rejects.toThrow('the round faulted');
      } finally {
        roundFaults.on = false;
      }
      await settle();
      // The fault stopped the loop, but not before this frame's write.
      expect(writes).toStrictEqual(plain.slice(0, 2));
    },
  );

  it(
    'keeps the week’s counts when the round ends: a fresh reader returns the next day',
    SHARED_RIDE,
    async () => {
      const ride = await withRound();
      const tally = roundTally(script.ride.round);
      const next = {
        day: WEEK.day + 1,
        houses: WEEK.houses - tally.missed,
        score: WEEK.score + tally.delivered,
      };
      // Kept the moment the round ended, with the ride still going, and as it was after End ride.
      expect(ride.keptRiding).toEqual(next);
      expect(ride.keptEnded).toEqual(next);
      // Counts only (DL11): the stored value is the three numbers.
      expect(ride.storedKeys).toEqual(['day', 'houses', 'score']);
    },
  );

  it(
    'runs nothing of Delivery without the option: no round, no field, no throw, no frame, nothing kept',
    SHARED_RIDE,
    async () => {
      const ride = await without();
      expect(ride.drawn.length).toBeGreaterThan(100);
      expect(ride.drawn.every((frame) => frame.delivery === undefined)).toBe(true);
      expect(ride.houses).toBeUndefined();
      expect(ride.throwControl).toBe(false);
      expect(ride.offered.filter((kind) => kind.startsWith('delivery-'))).toEqual([]);
      expect(ride.keptEnded).toEqual(WEEK);
    },
  );

  it('keeps the week as it was when End ride comes before any house is reached (#1857)', async () => {
    stubSeed(script.seed);
    mounted = await mount(
      <GameView
        port={port()}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        delivery
      />,
    );
    await settle();
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < 20; index += 1) await pump();
    expect(field('Houses')?.value).toBe(String(WEEK.houses));
    expect(readDeliveryProgress(localStorage)).toEqual(WEEK);
    await clickThrough(buttonStarting('End ride'));
    // No house passed, so none is delivered or missed, and a mis-pressed End
    // ride does not reset the week to a fresh one (`round.ts` §`endRound`).
    expect(readDeliveryProgress(localStorage)).toEqual(WEEK);
  });

  it('keeps the week with the houses passed counted missed when End ride comes mid-round (#1857)', async () => {
    stubSeed(script.seed);
    mounted = await mount(
      <GameView
        port={port()}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        delivery
      />,
    );
    await settle();
    await clickThrough(buttonStarting('Ride '));
    // Ride on without a throw until the first house's window has closed behind the rider.
    for (let index = 0; index < FRAMES; index += 1) {
      await pump();
      if (field('Houses')?.detail.includes('1\u00a0missed')) break;
    }
    const houses = field('Houses');
    expect(houses?.detail).toBe('0\u00a0delivered, 1\u00a0missed');
    // The round is still going: houses are still to come, and nothing is kept yet.
    expect(Number(houses?.value)).toBeGreaterThan(0);
    expect(readDeliveryProgress(localStorage)).toEqual(WEEK);
    await clickThrough(buttonStarting('End ride'));
    // The week the device keeps differs from the one it held: the passed house is missed.
    expect(readDeliveryProgress(localStorage)).toEqual({
      day: WEEK.day + 1,
      houses: WEEK.houses - 1,
      score: WEEK.score,
    });
  });

  it('runs no round on a ride in a room, which is solo’s alone, and never steers (DL9)', async () => {
    const clock = new ManualClock();
    const room = new ScriptedRoom();
    const drawn: SceneFrame[] = [];
    const steered = new Map<number, number | undefined>();
    startedRounds.length = 0;
    await rideTheTrace({
      delivery: true,
      drawn,
      // Past the script's first two lane presses, which `rideTheTrace` makes.
      frames: 40,
      steered,
      room: {
        room: roomPortOver(() => room.link(), { timers: clock, now: () => nowMs }),
        roomId: 'room-1',
      },
    });
    expect(drawn.length).toBeGreaterThan(30);
    expect(drawn.every((frame) => frame.delivery === undefined)).toBe(true);
    // #1853: no round was started, and no frame was handed a steered offset.
    expect(startedRounds).toEqual([]);
    // One more than were rendered: the first frame is the one the view is prepared with.
    expect(steered.size).toBe(drawn.length + 1);
    expect([...steered.values()].every((each) => each === undefined)).toBe(true);
    expect(field('Houses')).toBeUndefined();
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).toBeNull();
    // DL9: a ride in a room says nothing of Delivery, not even a no-round notice.
    for (const text of [TOO_FEW_HOUSES_TEXT, HOUSES_NOT_READY_TEXT]) {
      expect(
        mounted?.container.querySelector('.oyl-hud__notices')?.textContent ?? '',
      ).not.toContain(text);
      expect(said).not.toContain(text);
    }
    await clickThrough(buttonStarting('End ride'));
    expect(localStorage.getItem(DELIVERY_PROGRESS_STORAGE_KEY)).toBe(JSON.stringify(WEEK));
  });

  it('takes no throw while the ride is paused, and the next one once it rides again', async () => {
    stubSeed(script.seed);
    const drawn: SceneFrame[] = [];
    mounted = await mount(
      <GameView
        port={port()}
        renderer={() => Promise.resolve(capturingRenderer(drawn))}
        now={() => nowMs}
        delivery
      />,
    );
    await settle();
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < 20; index += 1) await pump();
    await clickThrough(buttonStarting('Pause'));
    await pressThrow('left');
    await pressThrow('right');
    await clickThrough(buttonStarting('Resume'));
    for (let index = 0; index < 30; index += 1) await pump();
    // No parcel was drawn in the air after the pause: neither throw was taken.
    expect(drawn.length).toBeGreaterThan(30);
    expect(drawn.every((frame) => frame.delivery?.parcels.length === 0)).toBe(true);
    // The control: the same key, riding, throws.
    await pressThrow('left');
    for (let index = 0; index < 3; index += 1) await pump();
    expect(drawn.at(-1)?.delivery?.parcels).toHaveLength(1);
  });
});

describe('lane steering inside a game ride — #1853', () => {
  it(
    'hands every frame of the round the offset the shadow round steered to, on the steps that ran',
    SHARED_RIDE,
    async () => {
      const ride = await withRound();
      // One more than were rendered: the first frame is the one the view is prepared with.
      expect(ride.steered.size).toBe(ride.drawn.length + 1);
      expect(ride.steered.size).toBeGreaterThan(100);
      for (const [index, offset] of ride.steered) {
        expect(offset, `frame ${String(index)}`).toBe(script.steered[index]);
      }
      // Non-vacuity: the ride was drawn in every lane, and part-way between them.
      const drawnAt = new Set(ride.steered.values());
      for (const lane of LANE_OFFSETS_METRES) expect(drawnAt).toContain(lane);
      expect(
        [...drawnAt].some(
          (offset) => offset !== undefined && !LANE_OFFSETS_METRES.includes(offset),
        ),
      ).toBe(true);
    },
  );

  it(
    'starts the round with obstacles placed for a rider who can steer: some stand in a lane',
    SHARED_RIDE,
    async () => {
      const ride = await withRound();
      expect(ride.started).toHaveLength(1);
      const [started] = ride.started as DeliveryRide[];
      expect(started?.obstacles.some((obstacle) => obstacle.stands !== undefined)).toBe(true);
      // And from the racing line at the press, as the shadow round was.
      expect(started?.steer).toEqual(startSteer(lineOffsetAt(racingLine(town.profile), 0)));
    },
  );

  it('hands no steered offset to any frame of a ride with no round', SHARED_RIDE, async () => {
    const ride = await without();
    expect(ride.steered.size).toBeGreaterThan(100);
    expect([...ride.steered.values()].every((each) => each === undefined)).toBe(true);
  });

  it('takes no lane press while the ride is paused, and the next one once it rides again', async () => {
    stubSeed(script.seed);
    mounted = await mount(
      <GameView
        port={port()}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        delivery
      />,
    );
    await settle();
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < 20; index += 1) await pump();
    const before = steeredInputs.at(-1);
    expect(before).toBeDefined();
    await clickThrough(buttonStarting('Pause'));
    await pressSteer('lane-left');
    await pressSteer('lane-left');
    await clickThrough(buttonStarting('Resume'));
    const resumed = steeredInputs.length;
    for (let index = 0; index < 30; index += 1) await pump();
    // Every frame after the pause was drawn where the rider was before it.
    expect(steeredInputs.length - resumed).toBeGreaterThan(10);
    expect(steeredInputs.slice(resumed).every((each) => each === before)).toBe(true);
    // The control: the same key, riding, steers.
    await pressSteer('lane-left');
    for (let index = 0; index < 5; index += 1) await pump();
    expect(steeredInputs.at(-1)).toBeLessThan(before as number);
  });
});

/** The ride's stored channels, read back from the store on a fresh connection. */
interface Recorded {
  readonly power: readonly (number | undefined)[];
  readonly cadence: readonly (number | undefined)[];
  readonly heartRate: readonly (number | undefined)[];
  /** The speed channel, which the distance is the sum of. */
  readonly speed: readonly (number | undefined)[];
  readonly distance: number;
  readonly movingSeconds: number;
}

describe('the recorded ride is unchanged by a Delivery round — #1816', () => {
  /** The scripted ride, recorded by the real ride controller against the #44 simulator, and saved. */
  async function recordedRide(delivery: boolean): Promise<{
    readonly recorded: Recorded;
    readonly houses: string | undefined;
    /** Every field name of the stored activity and its streams. */
    readonly names: readonly string[];
    /** How many distinct steered offsets the ride's frames were handed. */
    readonly steered: number;
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
    const steered = new Map<number, number | undefined>();
    await rideTheTrace({
      delivery,
      steered,
      trainer: gameTrainerPortOver(controller),
      // The bench keeps whole seconds; five of the game's frames are one.
      onFrame: async (index) => {
        if (index % 5 === 4) {
          await act(async () => {
            bench.advance(seconds(1));
            await controller.tick(bench.now);
          });
        }
      },
    });
    const houses = field('Houses')?.detail;
    await act(async () => {
      controller.armStop();
      await controller.confirmStop();
    });
    for (let index = 0; index < 10; index += 1) await settle();
    expect(controller.getSnapshot().saveState).toBe('saved');
    const [activity, streams] = await harness.read(async (store) => [
      await store.getActivity(ATHLETE_A, activityId('the-ride')),
      await store.getStreamSet(ATHLETE_A, activityId('the-ride')),
    ]);
    controller.dispose();
    await harness.destroy();
    mounted?.unmount();
    mounted = undefined;
    if (activity === undefined || streams === undefined) throw new Error('the ride was not saved');
    const { channels } = streams;
    // Every field name the store gave back, at any depth: what a stored ride carries.
    const names: string[] = [];
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
      if (Array.isArray(value)) {
        for (const each of value) walk(each);
        return;
      }
      for (const [name, inner] of Object.entries(value)) {
        names.push(name);
        walk(inner);
      }
    };
    walk(activity);
    walk(streams);
    return {
      names,
      steered: new Set(steered.values()).size,
      recorded: {
        power: [...(channels.power ?? [])],
        cadence: [...(channels.cadence ?? [])],
        heartRate: [...(channels.heartRate ?? [])],
        speed: [...(channels.speed ?? [])],
        distance: activity.distance,
        movingSeconds: activity.movingTime,
      },
      houses,
    };
  }

  // Two recorded rides: 5 393 ms under coverage (nightly 40888263731, AMD EPYC
  // 9V45) and 3 951 ms without it (`Tests`, 40888263759), so about three times
  // the slower, as `SHARED_RIDE`.
  it(
    'stores the same power, cadence, heart rate, distance and moving time with the round as without it',
    { timeout: 16_000 },
    async () => {
      const without = await recordedRide(false);
      const withRound = await recordedRide(true);
      // Non-vacuity: a ride was recorded, with power and distance in it, and
      // the second ran its round to the end while it was.
      expect(without.recorded.power.length).toBeGreaterThan(20);
      expect(without.recorded.distance).toBeGreaterThan(0);
      expect(without.recorded.movingSeconds).toBeGreaterThan(20);
      expect(without.houses).toBeUndefined();
      const tally = roundTally(script.ride.round);
      expect(withRound.houses).toBe(
        `${String(tally.delivered)}\u00a0delivered, ${String(tally.missed)}\u00a0missed`,
      );
      expect(withRound.recorded).toStrictEqual(without.recorded);
      // #1853, not recorded: the round was steered across the road, and the
      // stored ride has no field for where across it the rider was.
      expect(withRound.steered).toBeGreaterThan(3);
      expect(withRound.names.length).toBeGreaterThan(10);
      expect(withRound.names.filter((name) => /lateral|lane|steer|across/i.test(name))).toEqual([]);
      expect([...withRound.names].sort()).toEqual([...without.names].sort());
    },
  );
});

describe('offered in the chooser, with the short round and the no-round fallback — #1818', () => {
  /** A renderer for a ride that chose the realistic world, which does not load here. */
  function realisticNotLoaded(): GameRenderer {
    return {
      ...capturingRenderer([]),
      loadRealisticWorld: () =>
        Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
    };
  }

  it('fixture: the short towns have houses to pick, one fewer than the fewest and one as many', () => {
    const pickIn = (lastAlong: number, houses: number) =>
      pickRoundTargets(
        { ...deliveryTown(ROUTE.id, { lastAlong }), riderDistance: 0, houses },
        script.seed,
      );
    const two = pickIn(220, WEEK.houses);
    expect(two.targets.length).toBeGreaterThan(0);
    expect(two.targets.length).toBeLessThan(FEWEST_DELIVERY_HOUSES);
    expect(pickIn(300, 8).targets).toHaveLength(FEWEST_DELIVERY_HOUSES);
  });

  /** The chooser's switch, by its label. */
  function deliverySwitch(): HTMLInputElement | undefined {
    return queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[role="switch"]').find(
      (box) => (box.closest('label')?.textContent ?? '').includes(DELIVERY_CHOICE_TEXT.label),
    );
  }

  /** The HUD's notices, as text. */
  function notices(): string {
    return mounted?.container.querySelector('.oyl-hud__notices')?.textContent ?? '';
  }

  /**
   * Mount the game as a rider reaches it — no `delivery` prop — with the
   * realistic world chosen unless `world` is false, switch the round on when
   * `choose`, press *Ride* and ride `frames` frames with no throw. Returns the
   * chooser's progress line as the rider read it, before the press (#1878).
   */
  async function chooseAndRide(options: {
    readonly corridor?: WorldCorridor | undefined;
    /** The corridor's read as the port gives it, in place of `corridor`'s. */
    readonly load?: GamePort['loadWorldCorridor'];
    readonly choose: boolean;
    readonly frames: number;
  }): Promise<string> {
    writeRealisticWorldChoice(localStorage, true);
    stubSeed(script.seed);
    const base = portWith('corridor' in options ? options.corridor : town.corridor);
    mounted = await mount(
      <GameView
        port={options.load === undefined ? base : { ...base, loadWorldCorridor: options.load }}
        renderer={() => Promise.resolve(realisticNotLoaded())}
        now={() => nowMs}
      />,
    );
    await settle();
    // The line the rider read in the chooser, before they pressed Ride.
    const chooserLine = document.getElementById('oyl-game-delivery-week')?.textContent ?? '';
    if (options.choose) await clickThrough(deliverySwitch());
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < options.frames; index += 1) await pump();
    await settle();
    return chooserLine;
  }

  it('offers the round only with the realistic world chosen, the week’s progress beside it', async () => {
    mounted = await mount(
      <GameView port={port()} renderer={() => Promise.resolve(capturingRenderer([]))} />,
    );
    await settle();
    expect(deliverySwitch()).toBeUndefined();
    mounted.unmount();
    writeRealisticWorldChoice(localStorage, true);
    mounted = await mount(
      <GameView port={port()} renderer={() => Promise.resolve(capturingRenderer([]))} />,
    );
    await settle();
    expect(deliverySwitch()?.checked).toBe(false);
    // The week the device kept, read through the real reader.
    expect(mounted.container.textContent).toContain('Day 2 of 7 · up to 3 houses on the round');
  });

  it('starts a ride with the round on once it is chosen: its houses on the HUD', async () => {
    await chooseAndRide({ choose: true, frames: 5 });
    expect(field('Houses')).toEqual({ value: '3', detail: '0\u00a0delivered, 0\u00a0missed' });
    expect(field('Score')?.detail).toBe(`Day ${String(WEEK.day)} of 7`);
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).not.toBeNull();
    for (const text of [TOO_FEW_HOUSES_TEXT, HOUSES_NOT_READY_TEXT]) {
      expect(notices()).not.toContain(text);
    }
  });

  it('starts an ordinary ride, saying nothing of Delivery, when it is not chosen', async () => {
    await chooseAndRide({ choose: false, frames: 5 });
    expect(field('Houses')).toBeUndefined();
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).toBeNull();
    for (const text of [TOO_FEW_HOUSES_TEXT, HOUSES_NOT_READY_TEXT]) {
      expect(notices()).not.toContain(text);
      expect(said).not.toContain(text);
    }
  });

  it(
    'rides a shorter round on a route with fewer houses than the day’s, and keeps the day’s count',
    { timeout: 16_000 },
    async () => {
      // A week of eight, and a route with three houses in reach: a round of three.
      const eight: WeekProgress = { day: 2, houses: 8, score: 4 };
      localStorage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(eight));
      await chooseAndRide({
        corridor: deliveryTown(ROUTE.id, { lastAlong: 300 }).corridor,
        choose: true,
        frames: FRAMES,
      });
      for (const text of [TOO_FEW_HOUSES_TEXT, HOUSES_NOT_READY_TEXT]) {
        expect(said).not.toContain(text);
      }
      // Every house passed with no throw, so each of the three missed, as the HUD says.
      expect(field('Houses')).toEqual({ value: '0', detail: '0\u00a0delivered, 3\u00a0missed' });
      await clickThrough(buttonStarting('End ride'));
      // Tomorrow: the day's eight less the three missed, not the round's three less three,
      // which would have left none and ended the week. Read back by the real reader.
      expect(readDeliveryProgress(localStorage)).toEqual({ day: 3, houses: 5, score: 4 });
    },
  );

  it.each([
    // #1878: three houses in reach of a week of eight, so the HUD shows 3.
    { cause: 'a route with fewer houses than the day’s', lastAlong: 300, houses: 8 },
    // A route that holds the day's whole round: the line and the HUD give one number.
    { cause: 'a route that holds the day’s whole round', lastAlong: undefined, houses: 3 },
  ])(
    'the chooser’s line and the HUD’s Houses agree, or the line says the round may be shorter: $cause',
    { timeout: 16_000 },
    async ({ lastAlong, houses }) => {
      localStorage.setItem(
        DELIVERY_PROGRESS_STORAGE_KEY,
        JSON.stringify({ day: 2, houses, score: 4 } satisfies WeekProgress),
      );
      const line = await chooseAndRide({
        corridor: deliveryTown(ROUTE.id, lastAlong === undefined ? {} : { lastAlong }).corridor,
        choose: true,
        frames: 5,
      });
      const hud = field('Houses')?.value;
      expect(hud).toBe('3');
      // The line states a count: read it back, as a rider does, from the words.
      const stated = /(\d+) houses? on the round/.exec(line)?.[1];
      expect(stated).toBe(String(houses));
      // The HUD never shows more than the line allows ...
      expect(Number(hud)).toBeLessThanOrEqual(Number(stated));
      // ... and where it shows fewer, the line has said the round may be shorter.
      if (Number(hud) !== Number(stated)) expect(line).toContain('up to');
    },
  );

  /** A corridor read that has told the chooser `state` and goes no further. */
  const stopsAt =
    (state: CorridorState): GamePort['loadWorldCorridor'] =>
    (_route, _signal, shown) => {
      shown?.(state);
      return new Promise<CorridorState>(() => undefined);
    };

  it.each([
    // Houses for the first 220 m only: two to pick, fewer than FEWEST_DELIVERY_HOUSES.
    // Ridden past them, so a round would have missed them and moved the week.
    {
      cause: 'two houses in reach, fewer than the fewest',
      corridor: deliveryTown(ROUTE.id, { lastAlong: 220 }).corridor,
      frames: 330,
      text: TOO_FEW_HOUSES_TEXT,
    },
    // #1856: every front step past a parcel's reach, so the pick finds none.
    {
      cause: 'no house in reach',
      corridor: deliveryTown(ROUTE.id, { lateral: 30 }).corridor,
      frames: 20,
      text: TOO_FEW_HOUSES_TEXT,
    },
    // No houses read at all, so none counted: never "too few".
    {
      cause: 'no corridor to read',
      corridor: undefined,
      frames: 20,
      text: HOUSES_NOT_READY_TEXT,
    },
    {
      cause: 'the map still being read at the press',
      load: stopsAt({ kind: 'reading', done: 1, of: 4 }),
      frames: 20,
      text: HOUSES_NOT_READY_TEXT,
    },
    {
      cause: 'the device offline',
      load: stopsAt({ kind: 'unavailable', why: 'offline' }),
      frames: 20,
      text: HOUSES_NOT_READY_TEXT,
    },
    {
      cause: 'the map tiles off',
      load: stopsAt({ kind: 'off', why: 'map-tiles-off' }),
      frames: 20,
      text: HOUSES_NOT_READY_TEXT,
    },
    {
      cause: 'a read the map refused',
      load: () => Promise.resolve<CorridorState>({ kind: 'unavailable', why: 'refused' }),
      frames: 20,
      text: HOUSES_NOT_READY_TEXT,
    },
  ])(
    'says so in words with $cause, rides an ordinary ride, and keeps the week',
    { timeout: 16_000 },
    async ({ frames, text, ...source }) => {
      await chooseAndRide({ ...source, choose: true, frames });
      // An ordinary ride: no field, no throw control.
      expect(field('Houses')).toBeUndefined();
      expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).toBeNull();
      // Told in words: on the HUD's notices only while it stands, and said once through the region.
      if (frames <= 20) expect(notices()).toContain(text);
      expect(said.filter((each) => each === text)).toHaveLength(1);
      // And never the other cause's sentence.
      const other = text === TOO_FEW_HOUSES_TEXT ? HOUSES_NOT_READY_TEXT : TOO_FEW_HOUSES_TEXT;
      expect(notices()).not.toContain(other);
      expect(said).not.toContain(other);
      await clickThrough(buttonStarting('End ride'));
      // The week as it was, read back from the device by the real reader.
      expect(readDeliveryProgress(localStorage)).toEqual(WEEK);
    },
  );

  it('takes the notice down once it has stood its time', { timeout: 16_000 }, async () => {
    await chooseAndRide({ corridor: undefined, choose: true, frames: 20 });
    expect(notices()).toContain(HOUSES_NOT_READY_TEXT);
    // 15 s of ride, at four steps a frame: 75 frames, and a few over.
    for (let index = 0; index < 80; index += 1) await pump();
    await settle();
    expect(notices()).not.toContain(HOUSES_NOT_READY_TEXT);
  });

  it(
    'carries the assist setting into the ride: a round of misses keeps its count (#1813)',
    { timeout: 16_000 },
    async () => {
      const assist: DeliveryAssist = { widerWindows: false, obstacles: 'none', noFail: true };
      localStorage.setItem(DELIVERY_ASSIST_STORAGE_KEY, JSON.stringify(assist));
      await chooseAndRide({ choose: true, frames: FRAMES });
      // Every house passed with no throw, so every one missed, as the HUD says.
      expect(field('Houses')).toEqual({
        value: '0',
        detail: `0\u00a0delivered, ${String(WEEK.houses)}\u00a0missed`,
      });
      await clickThrough(buttonStarting('End ride'));
      // No fail: tomorrow's round keeps all three houses. Without the assist,
      // three misses of three would leave none, and end the week.
      expect(readDeliveryProgress(localStorage)).toEqual({
        day: WEEK.day + 1,
        houses: WEEK.houses,
        score: WEEK.score,
      });
    },
  );
});
