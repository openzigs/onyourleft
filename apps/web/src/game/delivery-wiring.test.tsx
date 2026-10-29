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

import { DELIVERY_PROGRESS_STORAGE_KEY, readDeliveryProgress } from './delivery/delivery-progress';
import { deliveryTown } from './delivery/delivery-town-testing';
import { startDeliveryRide, stepDeliveryRide, type DeliveryRide } from './delivery/ride-round';
import { roundTally, type WeekProgress } from './delivery/round';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  type ThrowSide,
} from './delivery/throw';
import { FOOTPRINT_MAX_VERTICES, footprintPlans } from './footprint-buildings';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import type { GameRenderer, SceneFrame } from './port';
import { lineOffsetAt, racingLine } from './racing-line';
import { DELIVERY_VILLAGE_DRAW_CALLS, villageDrawCallCeiling } from './realistic-budget';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { GameSimulation, type RiderInput } from './simulation';
import { corridorOrigin } from './terrain';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';
import { urbanClassMap } from './urban-class';

/** What `GameView` offered the announcer, kind by kind — `trainer-wiring.test.tsx`'s seam. */
const offered = vi.hoisted((): string[] => []);
vi.mock('./hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hud/announce')>();
  return {
    ...actual,
    announce: (...args: Parameters<typeof actual.announce>) => {
      for (const event of args[1].events ?? []) offered.push(event.kind);
      return actual.announce(...args);
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

/** How much wall clock one pumped frame covers: two simulation steps. */
const FRAME_MS = 100;
const START_MS = 1_000_000;

/** The scripted power trace: a function of the ride's clock alone, the same in every ride. */
function powerAt(nowMs: number): number {
  return 290 + 70 * Math.sin((nowMs - START_MS) / 6_000);
}

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

function port(): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    loadWorldCorridor: () => Promise.resolve({ kind: 'ready', corridor: town.corridor }),
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

async function pump(): Promise<void> {
  const next = pending.shift();
  if (next === undefined) throw new Error('the ride asked for no frame');
  nowMs += FRAME_MS;
  await act(async () => {
    next(nowMs);
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

/** The ride's frames: through the round's last house and a little past it. */
const FRAMES = 520;

interface Script {
  readonly seed: number;
  /** The throw pressed after each frame's tick, by frame index. */
  readonly throws: ReadonlyMap<number, ThrowSide>;
  /** What the shadow round came to. */
  readonly ride: DeliveryRide;
  readonly crashes: number;
}

/**
 * Ride the shadow's round under `seed`: a throw after the frame on which the
 * rider reaches the place a parcel lands on each house from, but the
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
    storage: { getItem: (key) => store.get(key) ?? null, setItem: () => undefined },
  });
  vi.restoreAllMocks();
  if (ride === undefined) return undefined;
  const line = racingLine(town.profile);
  const throws = new Map<number, ThrowSide>();
  const aimedAt = new Set<number>();
  let crashes = 0;
  let asked: ThrowSide | undefined;
  shadow.forEach((frame, index) => {
    if (ride === undefined) return;
    if (frame.steps > 0) {
      const stepped = stepDeliveryRide(ride, {
        ticks: frame.steps,
        along: frame.along,
        speed: frame.speed,
        lateral: (along) => lineOffsetAt(line, along),
        throwTo: asked,
      });
      asked = undefined;
      ride = stepped.ride;
      crashes += stepped.crashes;
    }
    // One throw at each house but the skipped one, from where its parcel lands on the step.
    for (const target of ride.throwTargets) {
      if (target.position === SKIPPED || aimedAt.has(target.position)) continue;
      const across = CARRIAGEWAY_HALF_WIDTH_METRES + target.clear;
      const from = target.along - frame.speed * (across / PARCEL_THROW_SPEED_METRES_PER_SECOND);
      if (frame.along < from) continue;
      aimedAt.add(target.position);
      throws.set(index, target.side);
      asked = target.side;
      break;
    }
  });
  return { seed, throws, ride, crashes };
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
  for (let index = 0; index < FRAMES; index += 1) {
    await pump();
    await options.onFrame?.(index);
    const side = options.delivery ? script.throws.get(index) : undefined;
    if (side !== undefined) await pressThrow(side);
  }
  await settle();
}

// ---------------------------------------------------------------------------

describe('a Delivery round inside a game ride — #1816', () => {
  it('runs the round the script predicts: every house settled, a delivery, a miss and a crash', async () => {
    const drawn: SceneFrame[] = [];
    await rideTheTrace({ delivery: true, drawn });
    const tally = roundTally(script.ride.round);
    // The real ride's HUD shows what the shadow's pure round came to.
    expect(field('Houses')).toEqual({
      value: '0',
      detail: `${String(tally.delivered)}\u00a0delivered, ${String(tally.missed)}\u00a0missed`,
    });
    expect(field('Score')).toEqual({
      value: String(script.ride.score),
      detail: `Day ${String(WEEK.day)} of 7`,
    });
    // The crash is in the score: fewer points than deliveries.
    expect(script.crashes).toBeGreaterThan(0);
    expect(script.ride.score).toBeLessThan(tally.delivered);
    // The throw control is on the HUD, and the round was said through the one region.
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).not.toBeNull();
    for (const kind of [
      'delivery-delivered',
      'delivery-missed',
      'delivery-crash',
      'delivery-round-over',
    ]) {
      expect(offered, kind).toContain(kind);
    }
    // Every frame drawn carried the round, and so was held to Delivery's ceiling (DL6b).
    expect(drawn.length).toBeGreaterThan(100);
    for (const frame of drawn) {
      expect(frame.delivery).toBeDefined();
      expect(villageDrawCallCeiling(frame)).toBe(DELIVERY_VILLAGE_DRAW_CALLS);
    }
    // Markers stood on the houses at the start, and were gone once each was settled.
    expect(drawn[0]?.delivery?.markers.length).toBeGreaterThan(0);
    expect(drawn.at(-1)?.delivery?.markers).toEqual([]);
    expect(drawn.some((frame) => (frame.delivery?.parcels.length ?? 0) > 0)).toBe(true);
    expect(drawn.some((frame) => (frame.delivery?.obstacles.length ?? 0) > 0)).toBe(true);
  });

  it('sends the trainer the same writes, each grade at the same time, with the round as without it (DL5)', async () => {
    const without: Write[] = [];
    await rideTheTrace({ delivery: false, trainer: trainerPort(without) });
    mounted?.unmount();
    mounted = undefined;
    pending = [];
    nowMs = START_MS;
    const withRound: Write[] = [];
    await rideTheTrace({ delivery: true, trainer: trainerPort(withRound) });
    // Non-vacuity: the round really ran, with a crash, and the road climbs and falls.
    expect(field('Houses')?.value).toBe('0');
    expect(script.crashes).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(20);
    const grades = without.map((each) => each.parameters.grade);
    expect(Math.max(...grades)).toBeGreaterThan(1);
    expect(withRound).toStrictEqual(without);
  });

  it('keeps the week’s counts at the ride’s end: a fresh reader returns the next day', async () => {
    await rideTheTrace({ delivery: true });
    await clickThrough(buttonStarting('End ride'));
    const kept = readDeliveryProgress(localStorage);
    const tally = roundTally(script.ride.round);
    expect(kept).toEqual({
      day: WEEK.day + 1,
      houses: WEEK.houses - tally.missed,
      score: WEEK.score + tally.delivered,
    });
    // Counts only (DL11): the stored value is the three numbers.
    const stored = JSON.parse(
      localStorage.getItem(DELIVERY_PROGRESS_STORAGE_KEY) ?? '{}',
    ) as object;
    expect(Object.keys(stored)).toEqual(['day', 'houses', 'score']);
  });

  it('runs nothing of Delivery without the option: no round, no field, no throw, no frame, nothing kept', async () => {
    const drawn: SceneFrame[] = [];
    await rideTheTrace({ delivery: false, drawn });
    expect(drawn.length).toBeGreaterThan(100);
    expect(drawn.every((frame) => frame.delivery === undefined)).toBe(true);
    expect(field('Houses')).toBeUndefined();
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).toBeNull();
    expect(offered.filter((kind) => kind.startsWith('delivery-'))).toEqual([]);
    await clickThrough(buttonStarting('End ride'));
    expect(localStorage.getItem(DELIVERY_PROGRESS_STORAGE_KEY)).toBe(JSON.stringify(WEEK));
  });

  it('runs no round on a ride in a room, which is solo’s alone (DL9)', async () => {
    const clock = new ManualClock();
    const room = new ScriptedRoom();
    const drawn: SceneFrame[] = [];
    await rideTheTrace({
      delivery: true,
      drawn,
      room: {
        room: roomPortOver(() => room.link(), { timers: clock, now: () => nowMs }),
        roomId: 'room-1',
      },
    });
    expect(drawn.length).toBeGreaterThan(100);
    expect(drawn.every((frame) => frame.delivery === undefined)).toBe(true);
    expect(field('Houses')).toBeUndefined();
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).toBeNull();
    await clickThrough(buttonStarting('End ride'));
    expect(localStorage.getItem(DELIVERY_PROGRESS_STORAGE_KEY)).toBe(JSON.stringify(WEEK));
  });

  it('takes no throw while the ride is paused', async () => {
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
    await clickThrough(buttonStarting('Pause'));
    await pressThrow('left');
    await pressThrow('right');
    await clickThrough(buttonStarting('Resume'));
    for (let index = 0; index < 30; index += 1) await pump();
    // No parcel was thrown: the flight would have landed by now, wasted, and none is in the air.
    expect(offered.filter((kind) => kind.startsWith('delivery-'))).toEqual([]);
    expect(field('Houses')?.detail).toBe('0\u00a0delivered, 0\u00a0missed');
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
  async function recordedRide(
    delivery: boolean,
  ): Promise<{ readonly recorded: Recorded; readonly houses: string | undefined }> {
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
      delivery,
      trainer: gameTrainerPortOver(controller),
      // The bench keeps whole seconds; ten of the game's frames are one.
      onFrame: async (index) => {
        if (index % 10 === 9) {
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
    return {
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

  it('stores the same power, cadence, heart rate, distance and moving time with the round as without it', async () => {
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
  });
});
