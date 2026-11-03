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
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import type { FrameRider, HeldItem, ItemEvent } from '@onyourleft/protocol';

import { roomPortOver } from '../net/room-port';
import { lapFrameRider, ManualClock, ScriptedRoom } from '../net/testing';
import { BACKOFF_BASE_MS } from '../net/room-session';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { LANE_OFFSETS_METRES } from './lanes';
import type { LapRaceChoice } from './lap-race/choice';
import type { GameRenderer, SceneFrame } from './port';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { ROOM_LOST_TEXT } from './room-ride';
import { circuitRoute } from './route-fixtures-testing';
import { GameSimulation, type RiderInput } from './simulation';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

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

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () =>
      Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
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

interface Write {
  readonly parameters: SimulationParameters;
  readonly atMs: number;
}

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

/** The shadow: the rider's odometer and speed after each frame, as `GameView` advances it. */
function shadowRide(frames: number): { along: number; speed: number }[] {
  const simulation = new GameSimulation({
    profile: CIRCUIT,
    conditions: rideConditionsFor(MASS, DEFAULT_RIDING_POSITION),
  });
  const out: { along: number; speed: number }[] = [];
  for (let frame = 1; frame <= frames; frame += 1) {
    const at = START_MS + frame * FRAME_MS;
    const input: RiderInput = { power: watts(powerAt(at)), live: true };
    simulation.advanceTo(at, input);
    out.push({ along: simulation.state.ride.distance, speed: simulation.state.ride.speed });
  }
  return out;
}

const SHADOW = shadowRide(FRAMES + 10);

/** What the scripted room says of THIS rider on a frame. */
interface OwnSlots {
  readonly held: HeldItem;
  readonly offsetMetres: number;
  readonly lane: number;
}

/** The room's frame after `frame` frames: the rider where the shadow is, a second rider behind. */
function roomFrame(
  room: ScriptedRoom,
  tick: number,
  frame: number,
  own: OwnSlots,
  events: readonly ItemEvent[] = [],
): void {
  const at = frame === 0 ? { along: 0, speed: 0 } : (SHADOW[frame - 1] ?? { along: 0, speed: 0 });
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
}): Promise<void> {
  mounted = await mount(
    <GameView
      port={port()}
      {...(options.writes === undefined ? {} : { trainer: trainerPort(options.writes) })}
      renderer={() => Promise.resolve(capturingRenderer(options.drawn ?? []))}
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

describe('a lap race in a room, inside a game ride — #1911', () => {
  it(
    'sends the trainer the same grades at the same times as a solo race with items off, while the room overrules three predicted outcomes (D-2.1)',
    { timeout: 20_000 },
    async () => {
      // The solo race with items off, on the same power trace.
      const solo: Write[] = [];
      await mountRide({ lapRace: SOLO_ITEMS_OFF, writes: solo });
      for (let index = 0; index < FRAMES; index += 1) await pump();
      await clickThrough(buttonStarting('End ride'));
      mounted?.unmount();
      mounted = undefined;

      // The room's race: three presses of *Use item*, each predicted, each overruled.
      pending = [];
      nowMs = START_MS;
      clock = new ManualClock();
      inputs.length = 0;
      const room = new ScriptedRoom();
      const inRoom: Write[] = [];
      await mountRide({ room, writes: inRoom });
      await joinedLapRace(room, HOLDING_TAILWIND);
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
            roomFrame(room, (index + 1) / 2, index + 1, own, events);
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
    },
  );

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
