// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2546's wiring: a lap race counts down ten seconds on its line before Go,
 * solo and in a room, through the real `GameView`, `GameSimulation`, gradient
 * driver and writer, room session and port, HUD and announcer.
 *
 * What is read is what a rider and a trainer get: the HUD's *Race* notice and
 * its one live region's text (never the event list), the frames the renderer
 * was handed, what the trainer was written and when, and the simulation's own
 * hold and advance as `GameView` calls them. The one thing read inside the
 * race is {@link stepped}: every call `GameView` makes to `stepLapRaceRide`,
 * with the race's clock as it stood, which is how "no bot moves before Go"
 * is asked of the module that moves them.
 *
 * The trainer half of the countdown, ridden at a non-zero power against an
 * ordinary ride standing still on the line for the same seconds, is
 * `lap-race-wiring.test.tsx` §"(D-2.1)", whose ordinary twin #2546 gave the
 * countdown; the recording half is the same file's §"(D-2.4)".
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import type { RoomRaceFact } from '@onyourleft/store';

import { riderMassFor } from '../athlete/mass';
import { roomPortOver } from '../net/room-port';
import { lapFrameRider, ManualClock, ScriptedRoom } from '../net/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { endRideAnswer } from './end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { LapRaceChoice } from './lap-race/choice';
import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES, PACK_MOST_ABREAST } from './lap-race/pack-layout';
import { LAP_RACE_COUNTDOWN_MS } from './lap-race/ride-race';
import type { GameRenderer } from './port';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { RACE_GO_SHOWN_MS, RACE_TEXT } from './room-ride';
import { circuitRoute } from './route-fixtures-testing';
import { GameSimulation, SIMULATION_STEP_SECONDS } from './simulation';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

/** Every call `GameView` made to `stepLapRaceRide`: when, how many ticks, and the race's clock before it. */
interface Stepped {
  readonly atMs: number;
  readonly ticks: number;
  readonly raceAtMs: number;
}
const stepped = vi.hoisted((): Stepped[] => []);
/** The clock `stepped` reads, set by the test. */
const clockNow = vi.hoisted(() => ({ ms: 0 }));
vi.mock('./lap-race/ride-race', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lap-race/ride-race')>();
  return {
    ...actual,
    stepLapRaceRide: (...args: Parameters<typeof actual.stepLapRaceRide>) => {
      stepped.push({ atMs: clockNow.ms, ticks: args[1].ticks, raceAtMs: args[0].race.atMs });
      return actual.stepLapRaceRide(...args);
    },
  };
});

/** What each drawn frame's input said of the rider and the bots, in order. */
interface DrawnInput {
  readonly atMs: number;
  readonly odometer: number;
  readonly riderDistance: number;
  readonly bots: readonly number[];
  /** Each bot's place across the road, metres, in the same order (#2544). */
  readonly across: readonly number[];
  /** The rider's place across the road, metres. */
  readonly riderAcross: number;
}
const inputs = vi.hoisted((): DrawnInput[] => []);
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      const input = args[0];
      inputs.push({
        atMs: clockNow.ms,
        odometer: input.state.ride.distance,
        riderDistance: input.riderDistance ?? Number.NaN,
        bots: (input.raceBots ?? []).map((bot) => bot.distanceMetres),
        across: (input.raceBots ?? []).map((bot) => bot.lateralMetres),
        riderAcross: input.steeredLateral ?? Number.NaN,
      });
      return actual.sceneFrame(...args);
    },
  };
});

/** A loop of about 250 m that climbs and falls. */
const CIRCUIT = circuitRoute(
  40,
  (along) => 2.5 * Math.sin((along / (2 * Math.PI * 40)) * 2 * Math.PI),
);
const ROUTE: RidableRoute = { id: 'lap-race', name: 'Race loop', profile: CIRCUIT, attempts: 0 };
const RACE: LapRaceChoice = { laps: 2, bots: 3, tier: 'hard', itemsOn: false };
/** The weight the rider declared: a room tickets only a declared one (#782, N5). */
const MASS = kilograms(72);

const FRAME_MS = 500;
const START_MS = 1_000_000;
/** The countdown's frames: Go is the last of them, ten seconds after the press. */
const COUNTDOWN_FRAMES = LAP_RACE_COUNTDOWN_MS / FRAME_MS;
/** What the rider pedals throughout: the issue's 250 W. */
const RIDING_WATTS = 250;

let nowMs = START_MS;
let nextFrame = 1;
const frames = new Map<number, FrameRequestCallback>();
const mounted: Mounted[] = [];
let clock = new ManualClock();

function port(power: () => number = () => RIDING_WATTS): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(power()), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function renderer(): GameRenderer {
  return {
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
}

/** One thing a trainer was handed, and when. */
type Handed =
  | { readonly kind: 'grade'; readonly parameters: SimulationParameters; readonly atMs: number }
  | { readonly kind: 'let-go'; readonly atMs: number };

function trainerPort(handed: Handed[], races: RoomRaceFact[]): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      handed.push({ kind: 'grade', parameters, atMs: nowMs });
      return Promise.resolve();
    },
    letGo: async () => {
      handed.push({ kind: 'let-go', atMs: nowMs });
      return Promise.resolve({ kind: 'stopped' as const });
    },
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
      workout: undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: async () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    noteRoomRace: (race) => {
      races.push(race);
    },
    subscribe: () => () => undefined,
  });
}

function announcements(enabled: boolean): void {
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    // Power and distance never, so the region carries only what this file is about.
    JSON.stringify({
      ...DEFAULT_ANNOUNCEMENTS,
      enabled,
      powerEverySeconds: 'never',
      distanceEvery: 'never',
    }),
  );
}

beforeEach(() => {
  nowMs = START_MS;
  clockNow.ms = START_MS;
  clock = new ManualClock();
  frames.clear();
  stepped.length = 0;
  inputs.length = 0;
  localStorage.clear();
  // A cancelled frame is not run, as a browser's is not: a pause's cleanup cancels the next.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame;
    nextFrame += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
});

afterEach(() => {
  for (const each of mounted) each.unmount();
  mounted.length = 0;
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

function buttonStarting(root: ParentNode, words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(root, 'button').find((button) =>
    (button.textContent ?? '').startsWith(words),
  );
}

/** One animation frame for every ride on the page; the sessions' timers move with the clock. */
async function pump(ms = FRAME_MS): Promise<void> {
  const due = [...frames.values()];
  if (due.length === 0) throw new Error('no ride asked for a frame');
  frames.clear();
  nowMs += ms;
  clockNow.ms = nowMs;
  await clock.advance(ms);
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** What the HUD's *Race* notice says, or `''` with none on it. */
function raceNotice(root: ParentNode): string {
  return root.querySelector('.oyl-hud__race')?.textContent ?? '';
}

/** What the HUD's one live region says now. */
function region(root: ParentNode): string {
  return root.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';
}

/** What the HUD's *Power* field reads, as a rider reads it. */
function powerShown(root: ParentNode): string {
  const row = queryAll(root, '.oyl-hud__field').find((each) =>
    /^Power/u.test(each.querySelector('dt')?.textContent ?? ''),
  );
  return row?.querySelector('dd')?.textContent ?? '';
}

/** Mount a game ride and press *Ride*: a solo race with `race`, or a room's ride. */
async function rideOn(options: {
  readonly race?: LapRaceChoice | undefined;
  readonly room?: ScriptedRoom | undefined;
  readonly skewMs?: number | undefined;
  readonly power?: (() => number) | undefined;
  readonly handed?: Handed[] | undefined;
  readonly races?: RoomRaceFact[] | undefined;
}): Promise<HTMLElement> {
  const skew = options.skewMs ?? 0;
  const local = (): number => nowMs + skew;
  const view = await mount(
    <GameView
      port={port(options.power)}
      renderer={() => Promise.resolve(renderer())}
      now={local}
      riderMass={MASS}
      {...(options.handed === undefined
        ? {}
        : { trainer: trainerPort(options.handed, options.races ?? []) })}
      {...(options.race === undefined ? {} : { lapRace: options.race })}
      {...(options.room === undefined
        ? {}
        : {
            room: roomPortOver((mass) => options.room!.link(mass), { timers: clock, now: local }),
            roomId: 'room-1',
          })}
    />,
  );
  mounted.push(view);
  await settle();
  await clickThrough(buttonStarting(view.container, 'Ride '));
  return view.container;
}

/** The room lets the rider in to a two-lap race and starts its countdown. */
async function countingRoom(room: ScriptedRoom, riderId = 0): Promise<void> {
  await act(async () => {
    room.accept();
    room.welcome(riderId, 'race', 'off', { laps: 2, items: 'off' });
    room.send({ type: 'countdown', startsInMs: LAP_RACE_COUNTDOWN_MS });
    await Promise.resolve();
  });
}

/** The countdown's whole seconds left after `frame` frames of it, as the notice says them. */
function secondsAfter(frame: number): number {
  return Math.ceil((LAP_RACE_COUNTDOWN_MS - frame * FRAME_MS) / 1000);
}

describe('a solo lap race counts down ten seconds on its line before Go — #2546', () => {
  it('shows 10 down to 1 and then Go, holds the rider on the line and every bot in its place on the grid, and starts the race’s clock at nought at Go', async () => {
    const root = await rideOn({ race: RACE });
    const notices: string[] = [];
    const placeShown: string[] = [];
    // The countdown, and ten frames (5 s) of rolling off the line after Go.
    for (let frame = 1; frame <= COUNTDOWN_FRAMES + 10; frame += 1) {
      await pump();
      notices.push(raceNotice(root));
      if (frame <= COUNTDOWN_FRAMES) {
        placeShown.push(root.querySelector('.oyl-hud__field--lap-race')?.textContent ?? '');
      }
    }
    // The notice: the room's words, ten down to one, then "Go.".
    for (let frame = 1; frame < COUNTDOWN_FRAMES; frame += 1) {
      expect(notices[frame - 1], `frame ${String(frame)}`).toContain(
        RACE_TEXT.counting(secondsAfter(frame)),
      );
    }
    expect(notices[0]).toContain(RACE_TEXT.counting(10));
    expect(notices[COUNTDOWN_FRAMES - 2]).toContain(RACE_TEXT.counting(1));
    expect(notices[COUNTDOWN_FRAMES - 1]).toContain(RACE_TEXT.go);
    // The place on the line, the whole countdown long.
    expect(placeShown[0]).toMatch(/^Place/u);
    expect(new Set(placeShown).size).toBe(1);
    // Nothing of the race was stepped before Go: no bot moved, spent or decided.
    const goAt = START_MS + LAP_RACE_COUNTDOWN_MS;
    expect(stepped.filter((each) => each.atMs <= goAt)).toEqual([]);
    // The first step is the frame after Go's, and the race's clock read nought at it.
    expect(stepped[0]).toEqual({ atMs: goAt + FRAME_MS, ticks: 10, raceAtMs: 0 });
    // Drawn: every frame of the countdown has the rider on the line and the
    // three bots standing in their places on the grid (the owner's ruling of
    // 2026-11-13 on #2544), the same places on every frame.
    const held = inputs.filter((each) => each.atMs <= goAt);
    expect(held.length).toBeGreaterThan(COUNTDOWN_FRAMES / 2);
    const grid = held[0];
    for (const each of held) {
      expect(each.odometer).toBe(0);
      expect(each.riderDistance).toBe(0);
      expect(each.bots).toEqual(grid?.bots);
      expect(each.across).toEqual(grid?.across);
    }
    // The grid: the rider's the back row, on the line, and every bot a whole
    // number of bike lengths up the road from it, no more abreast in a row than
    // a row holds, and no two racers inside one another.
    const racers = [
      { along: 0, across: grid?.riderAcross ?? Number.NaN },
      ...(grid?.bots ?? []).map((along, at) => ({ along, across: grid?.across[at] ?? Number.NaN })),
    ];
    expect(racers).toHaveLength(RACE.bots + 1);
    const rows = new Map<number, number>();
    for (const { along } of racers) {
      const row = Math.round(along / BIKE_LENGTH_METRES);
      expect(along).toBeCloseTo(row * BIKE_LENGTH_METRES, 9);
      expect(row).toBeGreaterThanOrEqual(0);
      rows.set(row, (rows.get(row) ?? 0) + 1);
    }
    expect(Math.max(...rows.values())).toBeLessThanOrEqual(PACK_MOST_ABREAST);
    expect(rows.size).toBeGreaterThan(1);
    // Every row ahead of the rider leaves them a way through: no bot on the
    // rider's line, so the rider rolls off between them at Go.
    for (const { along, across } of racers.slice(1)) {
      if (along === 0) continue;
      expect(Math.abs(across - (grid?.riderAcross ?? Number.NaN))).toBeGreaterThanOrEqual(
        PACK_ABREAST_METRES - 1e-9,
      );
    }
    for (const [at, one] of racers.entries()) {
      for (const other of racers.slice(at + 1)) {
        const apart =
          Math.abs(one.along - other.along) >= BIKE_LENGTH_METRES - 1e-9 ||
          Math.abs(one.across - other.across) >= PACK_ABREAST_METRES - 1e-9;
        expect(apart).toBe(true);
      }
    }
    // From Go on, the whole field rolls off together: on every frame after
    // Go's, the rider and every bot are drawn further up the road than on the
    // frame before. Nobody stands still waiting for their place.
    const rolling = inputs.filter((each) => each.atMs >= goAt);
    expect(rolling.length).toBeGreaterThanOrEqual(10);
    for (const [at, each] of rolling.entries()) {
      const before = rolling[at - 1];
      if (before === undefined) continue;
      expect(each.odometer, `frame ${String(at)} after Go`).toBeGreaterThan(before.odometer);
      each.bots.forEach((along, bot) => {
        expect(along, `bot ${String(bot)}, frame ${String(at)} after Go`).toBeGreaterThan(
          before.bots[bot] ?? Number.POSITIVE_INFINITY,
        );
      });
    }
  });

  it('never rides the wait: one step after Go, the rider has ridden one step from rest at the line', async () => {
    const root = await rideOn({ race: RACE });
    for (let frame = 1; frame < COUNTDOWN_FRAMES; frame += 1) await pump();
    // The frame Go falls in runs one step past it.
    await pump(FRAME_MS + SIMULATION_STEP_SECONDS * 1000);
    expect(raceNotice(root)).toContain(RACE_TEXT.go);
    // A rider at rest on the line, one step at the same power, as `GameView` builds one.
    const fresh = new GameSimulation({
      profile: CIRCUIT,
      conditions: rideConditionsFor(riderMassFor(MASS).mass, DEFAULT_RIDING_POSITION),
    });
    const input = { power: watts(RIDING_WATTS), live: true } as const;
    fresh.advanceTo(0, input);
    fresh.advanceTo(SIMULATION_STEP_SECONDS * 1000, input);
    expect(fresh.state.ride.distance).toBeGreaterThan(0);
    expect(inputs.at(-1)?.odometer).toBe(fresh.state.ride.distance);
    // And the race took that one step, from nought.
    expect(stepped).toEqual([{ atMs: nowMs, ticks: 1, raceAtMs: 0 }]);
  });

  it('freezes while paused and resumes from the second it stopped at, with no bot moving meanwhile', async () => {
    const root = await rideOn({ race: RACE });
    for (let frame = 1; frame <= 6; frame += 1) await pump();
    expect(raceNotice(root)).toContain(RACE_TEXT.counting(7));
    await clickThrough(buttonStarting(root, 'Pause'));
    // Paused, the notice says the countdown waits for the rider.
    expect(raceNotice(root)).toContain(RACE_TEXT.pausedCounting(7));
    nowMs += 30_000;
    clockNow.ms = nowMs;
    expect(raceNotice(root)).toContain(RACE_TEXT.pausedCounting(7));
    await clickThrough(buttonStarting(root, 'Resume'));
    const resumedAt = nowMs;
    // From seven, not from ten, and seven seconds of riding to Go.
    await pump();
    expect(raceNotice(root)).toContain(RACE_TEXT.counting(7));
    let goFrame: number | undefined;
    for (let frame = 2; frame <= 16 && goFrame === undefined; frame += 1) {
      await pump();
      if (raceNotice(root).includes(RACE_TEXT.go)) goFrame = frame;
    }
    expect(goFrame).toBe(7_000 / FRAME_MS);
    // Nothing was stepped before Go, and every drawn frame before it had the
    // rider on the line and the field in its places on the grid, unmoved.
    const goAt = resumedAt + 7_000;
    expect(stepped.filter((each) => each.atMs <= goAt)).toEqual([]);
    const grid = inputs[0];
    expect(grid?.bots).toHaveLength(RACE.bots);
    for (const each of inputs.filter((input) => input.atMs <= goAt)) {
      expect(each.bots).toEqual(grid?.bots);
      expect(each.across).toEqual(grid?.across);
      expect(each.odometer).toBe(0);
    }
    await pump();
    expect(stepped[0]).toEqual({ atMs: goAt + FRAME_MS, ticks: 10, raceAtMs: 0 });
  });

  it('ends cleanly during the countdown: the race dropped with nothing kept, and the trainer let go as an ordinary ride at the line is', async () => {
    /** A ride ended four seconds into the countdown, and what the trainer and the device kept. */
    async function endedOnTheLine(race: LapRaceChoice | undefined): Promise<{
      readonly handed: readonly Handed[];
      readonly races: readonly RoomRaceFact[];
    }> {
      nowMs = START_MS;
      const handed: Handed[] = [];
      const races: RoomRaceFact[] = [];
      // The ordinary ride's rider stands still: the race's is held whatever they pedal.
      const root = await rideOn({
        race,
        handed,
        races,
        ...(race === undefined ? { power: () => 0 } : {}),
      });
      for (let frame = 1; frame <= 8; frame += 1) await pump();
      await clickThrough(buttonStarting(root, 'End ride'));
      await clickThrough(endRideAnswer(document, 'End ride'));
      for (let index = 0; index < 5; index += 1) await settle();
      // Back on the picker, with no race on it.
      expect(buttonStarting(root, 'Ride ')).toBeDefined();
      expect(raceNotice(root)).toBe('');
      mounted.pop()?.unmount();
      return { handed, races };
    }
    const raced = await endedOnTheLine(RACE);
    const ordinary = await endedOnTheLine(undefined);
    // Non-vacuity: the line's grade was written, and the trainer let go once.
    expect(ordinary.handed.filter((each) => each.kind === 'grade').length).toBeGreaterThan(0);
    expect(ordinary.handed.filter((each) => each.kind === 'let-go')).toHaveLength(1);
    expect(raced.handed).toStrictEqual(ordinary.handed);
    // No race fact: a solo race keeps nothing (ADR 0060 D-12.2), a dropped one least of all.
    expect(raced.races).toEqual([]);
    expect(stepped).toEqual([]);
  });

  it('says the countdown and Go once each through the HUD’s one region with announcements on — Go at Go — and neither with them off', async () => {
    /** The region's text and the notice after each frame of a solo race's start. */
    async function heard(on: boolean): Promise<{ said: string[]; shown: string[] }> {
      nowMs = START_MS;
      announcements(on);
      const root = await rideOn({ race: RACE });
      const said: string[] = [];
      const shown: string[] = [];
      for (let frame = 1; frame <= COUNTDOWN_FRAMES + 8; frame += 1) {
        await pump();
        said.push(region(root));
        shown.push(raceNotice(root));
      }
      mounted.pop()?.unmount();
      return { said, shown };
    }
    const on = await heard(true);
    // Said: each sentence the region changed to, in order.
    const spoken = on.said.filter((text, index) => text !== '' && text !== on.said[index - 1]);
    expect(spoken.filter((text) => text === RACE_TEXT.counting(10))).toHaveLength(1);
    expect(spoken.filter((text) => text === RACE_TEXT.go)).toHaveLength(1);
    // The countdown on its first frame, and "Go." on Go's frame, not a window later.
    expect(on.said[0]).toBe(RACE_TEXT.counting(10));
    expect(on.said[COUNTDOWN_FRAMES - 1]).toBe(RACE_TEXT.go);
    // The digits are on the screen only.
    expect(spoken.filter((text) => /starts in [1-9] /u.test(text))).toEqual([]);
    const off = await heard(false);
    expect(
      off.said.filter((text) => text === RACE_TEXT.counting(10) || text === RACE_TEXT.go),
    ).toEqual([]);
    // And the notice counts down as it does with them on.
    expect(off.shown).toEqual(on.shown);
    expect(off.shown[COUNTDOWN_FRAMES - 2]).toContain(RACE_TEXT.counting(1));
    // "Go." stands on the notice for a moment, then goes.
    const goneAfter = RACE_GO_SHOWN_MS / FRAME_MS;
    expect(on.shown[COUNTDOWN_FRAMES - 1 + goneAfter - 1]).toContain(RACE_TEXT.go);
    expect(on.shown[COUNTDOWN_FRAMES - 1 + goneAfter]).toBe('');
  });

  it('shows the rider’s live power on the HUD while they warm up on the line, from the countdown’s first frame', async () => {
    const root = await rideOn({ race: RACE });
    const shown: string[] = [];
    for (let frame = 1; frame < COUNTDOWN_FRAMES; frame += 1) {
      await pump();
      expect(raceNotice(root), `frame ${String(frame)}`).toContain(
        RACE_TEXT.counting(secondsAfter(frame)),
      );
      shown.push(powerShown(root));
    }
    // Held the whole time, and the power the rider pedals on every frame of it.
    expect(inputs.every((each) => each.odometer === 0)).toBe(true);
    expect(shown).toEqual(shown.map(() => `${String(RIDING_WATTS)} W`));
  });

  it('renders the solo and the room countdown from one text: a change to it is a change to both', async () => {
    const text = RACE_TEXT as { counting: (seconds: number) => string };
    const was = text.counting;
    text.counting = (seconds) => `Changed ${String(seconds)}.`;
    try {
      const solo = await rideOn({ race: RACE });
      await pump();
      expect(raceNotice(solo)).toContain('Changed 10.');
      mounted.pop()?.unmount();
      const room = new ScriptedRoom();
      const inRoom = await rideOn({ room });
      await countingRoom(room);
      await pump();
      expect(raceNotice(inRoom)).toContain('Changed 10.');
    } finally {
      text.counting = was;
    }
  });
});

describe('a room’s lap race counts down on the room’s word — #2546', () => {
  /** Whether each device's simulation was held or advanced on each frame, by its skew. */
  interface Moves {
    readonly held: number[];
    readonly ran: number[];
  }

  it('starts two riders on the same room frame, whatever their clocks say, and on no frame before it', async () => {
    // Each call names its device by the skew its clock carries: one +5 s, one −5 s.
    const bySkew = new Map<number, Moves>([
      [5_000, { held: [], ran: [] }],
      [-5_000, { held: [], ran: [] }],
    ]);
    // The real methods, read off the prototype as values, to call through to.
    const holdAt = Object.getOwnPropertyDescriptor(GameSimulation.prototype, 'holdAt')?.value as (
      this: GameSimulation,
      at: number,
    ) => void;
    const advanceTo = Object.getOwnPropertyDescriptor(GameSimulation.prototype, 'advanceTo')
      ?.value as (
      this: GameSimulation,
      ...args: Parameters<GameSimulation['advanceTo']>
    ) => ReturnType<GameSimulation['advanceTo']>;
    vi.spyOn(GameSimulation.prototype, 'holdAt').mockImplementation(function (
      this: GameSimulation,
      at: number,
    ) {
      bySkew.get(at - nowMs)?.held.push(nowMs);
      holdAt.call(this, at);
    });
    vi.spyOn(GameSimulation.prototype, 'advanceTo').mockImplementation(function (
      this: GameSimulation,
      at: number,
      input,
    ) {
      const tick = advanceTo.call(this, at, input);
      if (tick.steps > 0) bySkew.get(at - nowMs)?.ran.push(nowMs);
      return tick;
    });
    const ahead = new ScriptedRoom();
    const behind = new ScriptedRoom();
    const aheadRoot = await rideOn({ room: ahead, skewMs: 5_000 });
    const behindRoot = await rideOn({ room: behind, skewMs: -5_000 });
    // One room, two links, both seated: its countdown reaches one device at
    // once and the other 2 s later, slower by that much on the way.
    await countingRoom(ahead, 0);
    await act(async () => {
      behind.accept();
      behind.welcome(1, 'race', 'off', { laps: 2, items: 'off' });
      await Promise.resolve();
    });
    for (let frame = 1; frame <= 4; frame += 1) await pump();
    await act(async () => {
      behind.send({ type: 'countdown', startsInMs: LAP_RACE_COUNTDOWN_MS });
      await Promise.resolve();
    });
    // 12.5 s in: both devices' own countdowns ran out, 10 s and 12 s in, before the room's first tick.
    for (let frame = 5; frame <= 25; frame += 1) await pump();
    expect(raceNotice(aheadRoot)).toContain(RACE_TEXT.counting(0));
    expect(raceNotice(behindRoot)).toContain(RACE_TEXT.counting(0));
    const before = nowMs;
    // The room's first tick, to both.
    await act(async () => {
      ahead.frame(0, [lapFrameRider(0, 0), lapFrameRider(1, 0)]);
      behind.frame(0, [lapFrameRider(0, 0), lapFrameRider(1, 0)]);
      await Promise.resolve();
    });
    await pump();
    const goFrame = nowMs;
    await pump();
    for (const [skew, moves] of bySkew) {
      // Held on every frame before the room's first, and ridden from the one after it.
      expect(moves.held.length, `skew ${String(skew)}`).toBeGreaterThan(20);
      expect(Math.max(...moves.held), `skew ${String(skew)}`).toBe(before);
      expect(moves.ran[0], `skew ${String(skew)}`).toBe(goFrame);
    }
    expect(raceNotice(aheadRoot)).toContain(RACE_TEXT.go);
    expect(raceNotice(behindRoot)).toContain(RACE_TEXT.go);
  });

  it('says the countdown and Go once each with announcements on — Go at the room’s first frame — and neither with them off', async () => {
    async function heard(on: boolean): Promise<{ said: string[]; shown: string[] }> {
      nowMs = START_MS;
      announcements(on);
      const room = new ScriptedRoom();
      const root = await rideOn({ room });
      await countingRoom(room);
      const said: string[] = [];
      const shown: string[] = [];
      for (let frame = 1; frame <= COUNTDOWN_FRAMES + 4; frame += 1) {
        if (frame === COUNTDOWN_FRAMES + 1) {
          await act(async () => {
            room.frame(0, [lapFrameRider(0, 0)]);
            await Promise.resolve();
          });
        }
        await pump();
        said.push(region(root));
        shown.push(raceNotice(root));
      }
      mounted.pop()?.unmount();
      return { said, shown };
    }
    const on = await heard(true);
    const spoken = on.said.filter((text, index) => text !== '' && text !== on.said[index - 1]);
    expect(spoken.filter((text) => text === RACE_TEXT.counting(10))).toHaveLength(1);
    expect(spoken.filter((text) => text === RACE_TEXT.go)).toHaveLength(1);
    expect(on.said[0]).toBe(RACE_TEXT.counting(10));
    expect(on.said[COUNTDOWN_FRAMES]).toBe(RACE_TEXT.go);
    const off = await heard(false);
    expect(
      off.said.filter((text) => text === RACE_TEXT.counting(10) || text === RACE_TEXT.go),
    ).toEqual([]);
    expect(off.shown).toEqual(on.shown);
    expect(off.shown[COUNTDOWN_FRAMES - 2]).toContain(RACE_TEXT.counting(1));
    expect(off.shown[COUNTDOWN_FRAMES]).toContain(RACE_TEXT.go);
  });

  it('does not wait for a rider who pauses: the race the room started meanwhile is running on resume', async () => {
    announcements(true);
    const room = new ScriptedRoom();
    const root = await rideOn({ room });
    await countingRoom(room);
    for (let frame = 1; frame <= 6; frame += 1) await pump();
    await clickThrough(buttonStarting(root, 'Pause'));
    // A room's countdown does not wait for one rider: no "after you resume".
    expect(raceNotice(root)).not.toContain('after you resume');
    // The room's countdown runs out, and its first frame comes, while they are paused.
    nowMs += LAP_RACE_COUNTDOWN_MS;
    clockNow.ms = nowMs;
    await clock.advance(LAP_RACE_COUNTDOWN_MS);
    await act(async () => {
      room.frame(0, [lapFrameRider(0, 0)]);
      await Promise.resolve();
    });
    const odometer = inputs.at(-1)?.odometer;
    await clickThrough(buttonStarting(root, 'Resume'));
    await pump();
    // Running at once on resume, as a pause in a running room is: not held, and "Go." said.
    expect(raceNotice(root)).toContain(RACE_TEXT.go);
    expect(region(root)).toBe(RACE_TEXT.go);
    expect(odometer).toBe(0);
    expect(inputs.at(-1)?.odometer).toBeGreaterThan(0);
  });

  /** Announcements on, with power said every 15 s, the shortest cadence a rider can pick. */
  function powerEveryFifteen(): void {
    localStorage.setItem(
      ANNOUNCEMENTS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_ANNOUNCEMENTS,
        enabled: true,
        powerEverySeconds: 15,
        distanceEvery: 'never',
      }),
    );
  }

  /** What the region said, each time it changed, against the seconds since *Ride*. */
  function spokenWith(said: readonly { readonly at: number; readonly text: string }[]) {
    return said.filter((each, index) => each.text !== '' && each.text !== said[index - 1]?.text);
  }

  it('says no power reading on its cadence while the rider waits in the lobby or counts down, and says power on its cadence again after Go', async () => {
    powerEveryFifteen();
    const room = new ScriptedRoom();
    const root = await rideOn({ room });
    // In the lobby of a race, with no countdown yet: 40 s, over two cadences.
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off', { laps: 2, items: 'off' });
      await Promise.resolve();
    });
    const said: { at: number; text: string }[] = [];
    const lobbyFrames = 80;
    for (let frame = 1; frame <= lobbyFrames + COUNTDOWN_FRAMES + 40; frame += 1) {
      if (frame === lobbyFrames + 1) {
        await act(async () => {
          room.send({ type: 'countdown', startsInMs: LAP_RACE_COUNTDOWN_MS });
          await Promise.resolve();
        });
      }
      if (frame === lobbyFrames + COUNTDOWN_FRAMES + 1) {
        await act(async () => {
          room.frame(0, [lapFrameRider(0, 0)]);
          await Promise.resolve();
        });
      }
      await pump();
      said.push({ at: (frame * FRAME_MS) / 1000, text: region(root) });
    }
    const goAt = ((lobbyFrames + COUNTDOWN_FRAMES + 1) * FRAME_MS) / 1000;
    const spoken = spokenWith(said);
    // Held, in the lobby and the countdown: the countdown's sentence and nothing on a cadence.
    expect(spoken.filter((each) => each.at < goAt).map((each) => each.text)).toEqual([
      RACE_TEXT.counting(10),
    ]);
    // Riding: "Go." at Go, and power on its cadence once more, within 15 s of it.
    expect(spoken.find((each) => each.at >= goAt)).toEqual({ at: goAt, text: RACE_TEXT.go });
    const reading = spoken.find((each) => each.at > goAt);
    expect(reading?.text).toBe(`Power ${String(RIDING_WATTS)} watts`);
    expect(reading?.at).toBeLessThanOrEqual(goAt + 15);
  });

  it('says Go on the room’s first frame though a power reading fell due 1.5 s before it', async () => {
    powerEveryFifteen();
    const room = new ScriptedRoom();
    const root = await rideOn({ room });
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off', { laps: 2, items: 'off' });
      await Promise.resolve();
    });
    // The countdown from 6.5 s, and the room's first frame at 16.5 s: power
    // fell due at 15 s, inside the 3 s window before Go, had it been said.
    const lobbyFrames = 13;
    const goFrame = lobbyFrames + COUNTDOWN_FRAMES + 1;
    expect(goFrame * FRAME_MS).toBeGreaterThan(15_000);
    expect(goFrame * FRAME_MS - 15_000).toBeLessThan(3_000);
    const said: string[] = [];
    for (let frame = 1; frame <= goFrame + 2; frame += 1) {
      if (frame === lobbyFrames + 1) {
        await act(async () => {
          room.send({ type: 'countdown', startsInMs: LAP_RACE_COUNTDOWN_MS });
          await Promise.resolve();
        });
      }
      if (frame === goFrame) {
        await act(async () => {
          room.frame(0, [lapFrameRider(0, 0)]);
          await Promise.resolve();
        });
      }
      await pump();
      said.push(region(root));
    }
    expect(said[goFrame - 1]).toBe(RACE_TEXT.go);
    expect(said[lobbyFrames]).toBe(RACE_TEXT.counting(10));
    expect(said[goFrame - 2]).toBe(RACE_TEXT.counting(10));
  });

  it('shows "Go." to a rider who waited in the lobby for a race the room started with no countdown', async () => {
    const room = new ScriptedRoom();
    const root = await rideOn({ room });
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off', { laps: 2, items: 'off' });
      await Promise.resolve();
    });
    for (let frame = 1; frame <= 4; frame += 1) await pump();
    await act(async () => {
      room.frame(0, [lapFrameRider(0, 0)]);
      await Promise.resolve();
    });
    await pump();
    expect(raceNotice(root)).toContain(RACE_TEXT.go);
  });

  it('shows the rider’s live power on the HUD while they wait in the lobby and count down', async () => {
    const room = new ScriptedRoom();
    const root = await rideOn({ room });
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off', { laps: 2, items: 'off' });
      await Promise.resolve();
    });
    const shown: string[] = [];
    for (let frame = 1; frame <= 4 + COUNTDOWN_FRAMES; frame += 1) {
      if (frame === 5) {
        await act(async () => {
          room.send({ type: 'countdown', startsInMs: LAP_RACE_COUNTDOWN_MS });
          await Promise.resolve();
        });
      }
      await pump();
      shown.push(powerShown(root));
    }
    // Held: the countdown is on the notice, and nobody has moved.
    expect(raceNotice(root)).toContain(RACE_TEXT.counting(0));
    expect(inputs.every((each) => each.odometer === 0)).toBe(true);
    expect(shown).toEqual(shown.map(() => `${String(RIDING_WATTS)} W`));
  });

  it('shows and says to a rider who joins a room whose race is already running no "Go."', async () => {
    announcements(true);
    const room = new ScriptedRoom();
    const root = await rideOn({ room });
    // The room's race was running before this rider's first frame: no countdown, no lobby.
    await act(async () => {
      room.accept();
      room.welcome(0, 'race', 'off', { laps: 2, items: 'off' });
      room.frame(40, [lapFrameRider(0, 0), lapFrameRider(1, 120)]);
      await Promise.resolve();
    });
    const shown: string[] = [];
    const said: string[] = [];
    for (let frame = 1; frame <= 8; frame += 1) {
      await pump();
      shown.push(raceNotice(root));
      said.push(region(root));
    }
    // The control: the race is running for this rider, who is riding it.
    expect(inputs.at(-1)?.odometer).toBeGreaterThan(0);
    expect(shown.filter((text) => text.includes(RACE_TEXT.go))).toEqual([]);
    // Nor heard: with announcements on, no "Go." is said to a rider already racing.
    expect(said.filter((text) => text.includes(RACE_TEXT.go))).toEqual([]);
  });
});
