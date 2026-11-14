// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1911's wiring: a lap race in a ROOM, inside a real game ride — the
 * rider's inputs sent, their outcome predicted and then the room's, and
 * **the trainer sent exactly what a solo race with items off is sent** on the
 * same power trace, however the room overrules what this device predicted
 * (ADR 0060 D-2.1, D-5.4).
 *
 * The real `GameView`, `GameSimulation`, gradient driver and writer, room
 * session and port, HUD; the room is `net/testing.ts`'s scripted one, which
 * plays the room's half of the wire by hand. A **shadow** simulation, advanced
 * on the same clock with the same power, gives the room the rider's own
 * effort distance for each frame, as a real room re-simulating the same
 * physics would (`apps/instance` §`room.ts`), so the rider is never corrected
 * and any difference in what the trainer is sent is the race's alone.
 *
 * Since #2546 a solo race counts down {@link COUNTDOWN_FRAMES} frames on its
 * line before Go, so the room's race #1911 holds equal to it is given the
 * room's own countdown of the same length first, and its shadow is held on
 * the line for it.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import {
  FLAG_FINISHED,
  type FrameRider,
  type HeldItem,
  type ItemEvent,
} from '@onyourleft/protocol';
import type { RoomRaceFact } from '@onyourleft/store';

import { roomPortOver } from '../net/room-port';
import { lapFrameRider, ManualClock, ScriptedRoom, standingsRider } from '../net/testing';
import { BACKOFF_BASE_MS } from '../net/room-session';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { LANE_OFFSETS_METRES } from './lanes';
import { LAP_RACE_COUNTDOWN_MS } from './lap-race/ride-race';
import type { LapRaceChoice } from './lap-race/choice';
import type { GameRenderer, SceneFrame } from './port';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { ROOM_LAP_RACE_TEXT } from '../rooms/RoomPanel';
import { ROOM_LOST_TEXT } from './room-ride';
import { LAP_RACE_CHOICE_TEXT } from './StageChooser';
import { circuitRoute } from './route-fixtures-testing';
import { GameSimulation, type RiderInput } from './simulation';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';
import { endRideAnswer } from './end-ride-testing';

/** What each drawn frame's input said of the rider, in order. */
interface DrawnInput {
  readonly riderDistance: number;
  readonly odometer: number;
  readonly steeredLateral: number | undefined;
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

/** The solo race the room ride is held against: items off, so nothing moves the rider. */
const SOLO_ITEMS_OFF: LapRaceChoice = { laps: 2, bots: 3, tier: 'hard', itemsOn: false };

/** The weight the rider declared: a room tickets only a declared one (#782, N5). */
const MASS = kilograms(72);

const FRAME_MS = 500;
const START_MS = 1_000_000;
const FRAMES = 80;
/** A race's countdown in frames (#2546): a solo race's, and the one the room is given to match it. */
const COUNTDOWN_FRAMES = LAP_RACE_COUNTDOWN_MS / FRAME_MS;

function powerAt(nowMs: number): number {
  return 290 + 70 * Math.sin((nowMs - START_MS) / 6_000);
}

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;
let clock = new ManualClock();

function port(): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(powerAt(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

/**
 * A view that keeps every frame it is handed. `blind` makes it a view with no
 * drawing context, which `GameView` prepares with one frame and hands no more
 * (#2524): for a ride whose case reads no frame and no frame's input.
 */
function capturingRenderer(frames: SceneFrame[], blind = false): GameRenderer {
  return {
    loadRealisticWorld: () =>
      Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
    create: () => ({
      hasContext: !blind,
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

interface Write {
  readonly parameters: SimulationParameters;
  readonly atMs: number;
}

function trainerPort(written: Write[], races: RoomRaceFact[] = []): GameTrainerPort {
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
    // #1912: the race the ride was in, as the device keeps it.
    noteRoomRace: (race) => {
      races.push(race);
    },
    subscribe: () => () => undefined,
  });
}

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  clock = new ManualClock();
  inputs.length = 0;
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

/** One animation frame; the session's timers move with the ride's clock. */
async function pump(): Promise<void> {
  const due = pending;
  if (due.length === 0) throw new Error('the ride asked for no frame');
  pending = [];
  nowMs += FRAME_MS;
  await clock.advance(FRAME_MS);
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function press(what: 'item' | 'lane-left'): Promise<void> {
  const [key, code] = what === 'item' ? ['w', 'KeyW'] : ['a', 'KeyA'];
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, cancelable: true }));
    await Promise.resolve();
  });
}

/** The HUD's lap-race fields' text: *Place* and *Item*. */
function raceFields(): string[] {
  return queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-hud__field--lap-race').map(
    (each) => (each.textContent ?? '').trim(),
  );
}

/** What the HUD's *Item* field says the rider holds. */
function itemShown(): string | undefined {
  return raceFields().find((text) => text.startsWith('Item'));
}

/**
 * The shadow: the rider's odometer and speed after each frame, as `GameView`
 * advances it — held on the line for its first `held` frames (#2546).
 */
function shadowRide(frames: number, held = 0): { along: number; speed: number }[] {
  const simulation = new GameSimulation({
    profile: CIRCUIT,
    conditions: rideConditionsFor(MASS, DEFAULT_RIDING_POSITION),
  });
  const out: { along: number; speed: number }[] = [];
  for (let frame = 1; frame <= frames; frame += 1) {
    const at = START_MS + frame * FRAME_MS;
    const input: RiderInput = { power: watts(powerAt(at)), live: true };
    if (frame <= held) simulation.holdAt(at);
    else simulation.advanceTo(at, input);
    out.push({ along: simulation.state.ride.distance, speed: simulation.state.ride.speed });
  }
  return out;
}

const SHADOW = shadowRide(FRAMES + 10);
/** The shadow of a ride held through a countdown first (#2546). */
const HELD_SHADOW = shadowRide(COUNTDOWN_FRAMES + FRAMES + 10, COUNTDOWN_FRAMES);

/** What the scripted room says of THIS rider on a frame. */
interface OwnSlots {
  readonly held: HeldItem;
  readonly offsetMetres: number;
  readonly lane: number;
}

/**
 * The room's frame after `frame` frames: the rider where the shadow is, a
 * second rider behind. `held` frames of countdown came first (#2546), and the
 * shadow is then the one held through them.
 */
function roomFrame(
  room: ScriptedRoom,
  tick: number,
  frame: number,
  own: OwnSlots,
  events: readonly ItemEvent[] = [],
  held = 0,
): void {
  const shadow = held === 0 ? SHADOW : HELD_SHADOW;
  const at =
    frame === 0 ? { along: 0, speed: 0 } : (shadow[held + frame - 1] ?? { along: 0, speed: 0 });
  const riders: FrameRider[] = [
    lapFrameRider(0, at.along, own, at.speed),
    lapFrameRider(1, Math.max(0, at.along - 40), { held: 'none' }, at.speed),
  ];
  // The room had every report this client sent before now (`ackSequence`).
  const reports = room.socket.sent.flatMap((m) => (m.type === 'report' ? [m.sequence] : []));
  room.frame(tick, riders, {
    ...(reports.length === 0 ? {} : { ackSequence: Math.max(...reports) }),
    ...(events.length === 0 ? {} : { itemEvents: events }),
  });
}

async function mountRide(options: {
  readonly room?: ScriptedRoom | undefined;
  readonly lapRace?: LapRaceChoice | undefined;
  readonly writes?: Write[] | undefined;
  readonly drawn?: SceneFrame[] | undefined;
  readonly races?: RoomRaceFact[] | undefined;
  /** A view with no drawing context, so no frame is built: for a ride no case reads a frame of (#2524). */
  readonly blind?: boolean | undefined;
}): Promise<void> {
  mounted = await mount(
    <GameView
      port={port()}
      {...(options.writes === undefined && options.races === undefined
        ? {}
        : { trainer: trainerPort(options.writes ?? [], options.races) })}
      renderer={() => Promise.resolve(capturingRenderer(options.drawn ?? [], options.blind))}
      now={() => nowMs}
      riderMass={MASS}
      {...(options.lapRace === undefined ? {} : { lapRace: options.lapRace })}
      {...(options.room === undefined
        ? {}
        : {
            room: roomPortOver((mass) => options.room!.link(mass), {
              timers: clock,
              now: () => nowMs,
            }),
            roomId: 'room-1',
          })}
    />,
  );
  await settle();
  await clickThrough(buttonStarting('Ride '));
}

/** The room accepts, welcomes the rider to a two-lap race with items, and its race begins. */
async function joinedLapRace(room: ScriptedRoom, own: OwnSlots): Promise<void> {
  await act(async () => {
    room.accept();
    // Drafting off, so the second rider shelters nobody: the shadow's physics is the room's.
    room.welcome(0, 'race', 'off', { laps: 2, items: 'on' });
    roomFrame(room, 0, 0, own);
    await Promise.resolve();
  });
}

const HOLDING_TAILWIND: OwnSlots = { held: 'tailwind', offsetMetres: 0, lane: 1 };

/**
 * The solo race with items off, on the same power trace: ridden once, by the
 * first case that asks, so the room's case below pays for its own ride alone
 * (#2524, #1688's ruling: a slow case is made cheaper, never given a longer
 * timeout). The two rides were one case of 1.8 s, and 2.4 s under
 * --coverage, locally on an Apple M4 Pro at a load average of 13 to 23;
 * after, at 10 to 15, 1.2 s and 0.47 s, and 1.4 s and 1.0 s under --coverage.
 */
let soloRide: Promise<readonly Write[]> | undefined;
const soloWrites = (): Promise<readonly Write[]> =>
  (soloRide ??= (async () => {
    const solo: Write[] = [];
    await mountRide({ lapRace: SOLO_ITEMS_OFF, writes: solo, blind: true });
    // Its countdown (#2546), then the race.
    for (let index = 0; index < COUNTDOWN_FRAMES + FRAMES; index += 1) await pump();
    await clickThrough(buttonStarting('End ride'));
    await clickThrough(endRideAnswer(document, 'End ride'));
    mounted?.unmount();
    mounted = undefined;
    return solo;
  })());

describe('a lap race in a room, inside a game ride — #1911', () => {
  it('writes the road’s grades to the trainer in a solo race with items off, on the same power trace', async () => {
    const solo = await soloWrites();
    // The road climbs and falls, and is written many times.
    expect(solo.length).toBeGreaterThan(20);
    expect(Math.max(...solo.map((each) => each.parameters.grade))).toBeGreaterThan(1);
  });

  it('sends the trainer the same grades at the same times as a solo race with items off, while the room overrules three predicted outcomes (D-2.1)', async () => {
    const solo = await soloWrites();

    // The room's race: three presses of *Use item*, each predicted, each overruled.
    pending = [];
    nowMs = START_MS;
    clock = new ManualClock();
    inputs.length = 0;
    const room = new ScriptedRoom();
    const inRoom: Write[] = [];
    await mountRide({ room, writes: inRoom });
    // #2546: the room counts down as long as the solo race does, and its
    // first frame comes after the frame its countdown ends on, as Go's.
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off', { laps: 2, items: 'on' });
      room.send({ type: 'countdown', startsInMs: LAP_RACE_COUNTDOWN_MS });
      await Promise.resolve();
    });
    for (let index = 0; index < COUNTDOWN_FRAMES; index += 1) await pump();
    await act(async () => {
      roomFrame(room, 0, 0, HOLDING_TAILWIND, [], COUNTDOWN_FRAMES);
      await Promise.resolve();
    });
    // The room's word on the rider, frame by frame: what it overrules each use with.
    const script = (frame: number): { own: OwnSlots; events: ItemEvent[] } => {
      // 1st use at frame 10: the room never makes it — the tailwind is still held.
      if (frame < 32) return { own: HOLDING_TAILWIND, events: [] };
      // 2nd use at frame 30: made, and a gust the client did not see coming took them back.
      if (frame < 52) {
        return {
          own: { held: 'tailwind', offsetMetres: -3, lane: 1 },
          events:
            frame === 34
              ? [
                  { riderId: 0, event: 'use', item: 'tailwind' },
                  { riderId: 0, event: 'hit', item: 'crosswind-gust' },
                ]
              : [],
        };
      }
      // 3rd use at frame 50: made, and a puddle ridden through — further back still.
      return { own: { held: 'none', offsetMetres: -7.5, lane: 1 }, events: [] };
    };
    const predicted: number[] = [];
    for (let index = 0; index < FRAMES; index += 1) {
      await pump();
      // A frame from the room every second: every second pump.
      if (index % 2 === 1) {
        const { own, events } = script(index + 1);
        await act(async () => {
          roomFrame(room, (index + 1) / 2, index + 1, own, events, COUNTDOWN_FRAMES);
          await Promise.resolve();
        });
      }
      const drawn = inputs.at(-1);
      if (drawn !== undefined) predicted.push(drawn.riderDistance - drawn.odometer);
      if (index === 10 || index === 30 || index === 50) await press('item');
    }
    // Non-vacuity: the three uses were sent as inputs, and nothing else was.
    const sent = room.socket.sent.map((m) => m.type);
    expect(sent.filter((type) => type === 'item-use')).toHaveLength(3);
    expect(new Set(sent)).toEqual(new Set(['hello', 'report', 'item-use']));
    // A tailwind was predicted (drawn ahead of the odometer) and then overruled
    // (drawn behind it, at the room's offset).
    expect(Math.max(...predicted)).toBeGreaterThan(0.5);
    expect(Math.min(...predicted)).toBeLessThan(-7);
    // The road climbs and falls, and is written many times.
    expect(solo.length).toBeGreaterThan(20);
    expect(Math.max(...solo.map((each) => each.parameters.grade))).toBeGreaterThan(1);
    // And the trainer felt none of it.
    expect(inRoom).toStrictEqual(solo);
  });

  it('rolls a use the room never made back to the room’s item within one frame interval after the next frame, on the HUD', async () => {
    const room = new ScriptedRoom();
    await mountRide({ room });
    await joinedLapRace(room, HOLDING_TAILWIND);
    for (let index = 0; index < 4; index += 1) await pump();
    expect(itemShown()).toBe('ItemTailwind');
    await press('item');
    const pressedAt = nowMs;
    await pump();
    // Instant: the item is gone from the HUD before the room says anything.
    expect(itemShown()).toBe('ItemNone');
    expect(room.socket.sent.filter((m) => m.type === 'item-use')).toHaveLength(1);
    // The room never makes the use: every frame says the tailwind is still held.
    let restoredAt: number | undefined;
    let nextFrameAt: number | undefined;
    for (let index = 0; index < 6 && restoredAt === undefined; index += 1) {
      if (index % 2 === 0) {
        await act(async () => {
          roomFrame(room, 10 + index, 6 + index, HOLDING_TAILWIND);
          await Promise.resolve();
        });
        nextFrameAt ??= nowMs;
      }
      await pump();
      if (itemShown() === 'ItemTailwind') restoredAt = nowMs;
    }
    expect(restoredAt).toBeDefined();
    expect(nextFrameAt).toBeDefined();
    // Within one frame interval (1 s) after the next frame after the press.
    expect((restoredAt ?? Infinity) - (nextFrameAt ?? 0)).toBeLessThanOrEqual(1_000 + FRAME_MS);
    expect((restoredAt ?? Infinity) - pressedAt).toBeLessThanOrEqual(2_000 + FRAME_MS);
  });

  it('shows the rejoin state when the socket goes mid-race, and the room’s item and lane once back', async () => {
    const room = new ScriptedRoom();
    const drawn: SceneFrame[] = [];
    await mountRide({ room, drawn });
    const leftHolding: OwnSlots = { held: 'tow', offsetMetres: 0, lane: 0 };
    await joinedLapRace(room, { ...leftHolding, lane: 1 });
    await pump();
    await press('lane-left');
    await pump();
    expect(room.socket.sent.filter((m) => m.type === 'lane')).toEqual([
      expect.objectContaining({ lane: 0 }),
    ]);
    // The room takes the lane.
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        roomFrame(room, 2 + index, 2 + index, leftHolding);
        await Promise.resolve();
      });
      await pump();
    }
    expect(itemShown()).toBe('ItemTow');
    // The edge drops the socket mid-race: the rider is told the room is lost.
    await act(async () => {
      room.closeFromServer(1006);
      await Promise.resolve();
    });
    await pump();
    expect(mounted?.container.textContent).toContain(ROOM_LOST_TEXT);
    // Back by itself, on a fresh ticket, to the same seat: the room's item and lane.
    for (let index = 0; index * FRAME_MS < BACKOFF_BASE_MS * 2; index += 1) await pump();
    expect(room.tickets).toHaveLength(2);
    const lanesBefore = room.socket.sent.length;
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off', { laps: 2, items: 'on' });
      await Promise.resolve();
    });
    // The realistic gap: the ride steps with the welcome in and no frame yet.
    await pump();
    await pump();
    await act(async () => {
      roomFrame(room, 9, 9, leftHolding);
      await Promise.resolve();
    });
    for (let index = 0; index < 4; index += 1) await pump();
    expect(mounted?.container.textContent).not.toContain(ROOM_LOST_TEXT);
    expect(itemShown()).toBe('ItemTow');
    // Drawn in the room's lane, the left one — and no lane was sent to put it there.
    expect(drawn.length).toBeGreaterThan(0);
    expect(inputs.at(-1)?.steeredLateral).toBeCloseTo(LANE_OFFSETS_METRES[0] ?? Number.NaN, 1);
    expect(room.socket.sent.slice(lanesBefore).filter((m) => m.type === 'lane')).toEqual([]);
  });

  it('offers a rider with no instance the solo lap race, and says the networked one needs an instance — #1912', async () => {
    mounted = await mount(
      <GameView
        port={port()}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        riderMass={MASS}
      />,
    );
    await settle();
    const text = mounted.container.textContent ?? '';
    // The solo race (#1907), on this loop, with nothing missing …
    expect(text).toContain(LAP_RACE_CHOICE_TEXT.label);
    expect(text).not.toContain(LAP_RACE_CHOICE_TEXT.notALoop);
    // … and the race against others, which says what it needs.
    expect(text).toContain(ROOM_LAP_RACE_TEXT.noInstance);
    // A solo race rides with no instance at all.
    const offer = queryAll<HTMLInputElement>(mounted.container, 'input').find((each) =>
      (each.closest('label')?.textContent ?? '').includes(LAP_RACE_CHOICE_TEXT.label),
    );
    expect(offer).toBeDefined();
    await clickThrough(offer);
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < 4; index += 1) await pump();
    expect(raceFields()[0]).toMatch(/^Place/u);
  });

  it('keeps a lap race left on its last lap as not over the line, and one ridden to the end as over it, and nothing of the items — #1912', async () => {
    const LAP_WORDS =
      /item|offset|lane|held|hit|pick|lap(?!s?Done)|puddle|gust|tow|tailwind|cape/iu;
    const kept: RoomRaceFact[] = [];
    for (const lapsDone of [1, 2]) {
      pending = [];
      const room = new ScriptedRoom();
      await mountRide({ room, races: kept });
      await joinedLapRace(room, HOLDING_TAILWIND);
      for (let index = 0; index < 6; index += 1) await pump();
      // The room has the rider well past one lap of the route: lap 2 of 2, or over the line.
      await act(async () => {
        room.frame(9, [
          lapFrameRider(0, CIRCUIT.totalDistance * 1.6, { lapsDone, held: 'tow', lane: 2 }),
        ]);
        await Promise.resolve();
      });
      await pump();
      await clickThrough(buttonStarting('End ride'));
      await clickThrough(endRideAnswer(document, 'End ride'));
      mounted?.unmount();
      mounted = undefined;
    }
    expect(kept).toHaveLength(2);
    // Left on lap 2 of 2: not over the line, though one lap of the route is behind them.
    expect(kept[0]).toEqual({ roomId: 'room-1', place: null, finishers: null });
    // Ridden to the end: over the line, by the room's laps.
    expect(kept[1]).toMatchObject({ roomId: 'room-1', crossedTheLine: true });
    for (const fact of kept) {
      expect(Object.keys(fact).filter((key) => LAP_WORDS.test(key))).toEqual([]);
    }
  });

  it('counts a rider the room’s standings have across the line as across, whatever the lap frame says — #1912', async () => {
    const kept: RoomRaceFact[] = [];
    const room = new ScriptedRoom();
    await mountRide({ room, races: kept });
    await joinedLapRace(room, HOLDING_TAILWIND);
    for (let index = 0; index < 6; index += 1) await pump();
    // The lap frame says one lap of two (as a rejoin leaves it until the next frame), while
    // the standings, which the session keeps, have this rider across.
    await act(async () => {
      room.frame(9, [lapFrameRider(0, CIRCUIT.totalDistance * 1.6, { lapsDone: 1 })]);
      room.standings(9, [standingsRider(0, 0, 3, FLAG_FINISHED)]);
      await Promise.resolve();
    });
    await pump();
    await clickThrough(buttonStarting('End ride'));
    await clickThrough(endRideAnswer(document, 'End ride'));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      roomId: 'room-1',
      crossedTheLine: true,
      placeAcross: 1,
      across: 1,
    });
  });

  it('runs no lap race in a room that is not one: no field, no pick-ups, no input', async () => {
    const room = new ScriptedRoom();
    const drawn: SceneFrame[] = [];
    await mountRide({ room, drawn });
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off');
      room.frame(0, [lapFrameRider(0, 0)]);
      await Promise.resolve();
    });
    for (let index = 0; index < 4; index += 1) await pump();
    await press('item');
    await pump();
    expect(raceFields()).toEqual([]);
    expect(drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
    expect(room.socket.sent.filter((m) => m.type === 'item-use' || m.type === 'lane')).toEqual([]);
  });
});
