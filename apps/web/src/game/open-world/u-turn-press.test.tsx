// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A U-turn press, through the real game screen** — #3066.
 *
 * A U-turn (ADR 0088 D-1.6: the prompt's button, ArrowDown, a pad's face
 * button 3, OpenBikeControl's Navigate Down) changes the road under the rider
 * at once. Measured before #3066 on this grid at 30 fps, reading the frames
 * the renderer was handed: on the frame of the press the drawn rider's move
 * changed by 4.9 m and the camera's by 4.0 m (`junction-corner.test.tsx`'s
 * control, #3051). This file rides the real `GameView` up the grid's major
 * road, presses ArrowDown, and reads back what the renderer was handed each
 * frame: the camera's place (`SceneFrame.camera`, the point it turns about)
 * and the drawn rider's place and heading.
 *
 * What it holds, frame by frame from just before the press to well after it:
 *
 * - **No jump.** The change in the drawn rider's and the camera's move from
 *   one frame to the next stays under {@link JUMP_METRES}, the bound
 *   `junction-corner.test.tsx` holds a junction's turn to.
 * - **A turn round.** The drawn rider ends up facing back down the road, and
 *   is drawn on the half-turn for more than a few metres (no cut).
 * - **Drawn only.** The grade the trainer is asked for walks to the road back
 *   at no more than 1 % a second (ADR 0087 D-6.4, `gradient.ts` §`follow`).
 * - **Reduced motion.** The drawn rider is not teleported.
 *
 * The session is a double that hands over a rolling route on
 * `@onyourleft/domain/rolling-testing`'s grid; the game, the simulation, the
 * road, the turn input, the scene, the camera's damping and the trainer port
 * are the product's.
 *
 * ## On the ride's own clock — #3141
 *
 * The game screen makes its view a few event-loop turns after the ride
 * starts, and the loop rides on the test's clock meanwhile with nothing drawn.
 * The busier the machine, the more turns, so the first drawn frame stood
 * further up the road: with the view held 300 ms, a press meant for 70 m was
 * taken at 1 021 m, which is the shape CI read beside another suite (136 m,
 * nightly run 45532616508). The clock now stands still until the first frame
 * is drawn, and the press is checked on the frame it was handled on.
 *
 * Each press is one ride its cases share, in order (#3141): through the
 * half-turn to {@link WATCH_SPLIT_METRES} past the press, then on to
 * {@link WATCH_AFTER_METRES}. A case riding all of it ran past a test's 5 s
 * under coverage on CI, and a case that times out leaves its ride pumping
 * the next case's frames: the 0.7 s failures beside each timeout.
 */

import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  RollingRoute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  watts,
  type RollingEdge,
} from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { CORRECTION_GRADE_STEP_PERCENT_PER_SECOND } from '../../net/correction';
import { GameView, type GamePort } from '../GameView';
import type { GameRenderer, SceneFrame } from '../port';
import type { SceneInput } from '../scene';
import { corridorOrigin, localGroundPosition, type CorridorOrigin } from '../terrain';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from '../trainer-port';
import { fixtureStart, START_COLUMN, START_ROW } from './fixture-testing';
import { OPEN_WORLD_ROUTE_ID, type OpenWorldSessions } from './ride';
import { OpenWorldRoad } from './road';

const inputs: SceneInput[] = [];

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

/** `junction-wiring.test.tsx`'s grid: the first junction is 180 m on. */
const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510];

/**
 * Where the U-turn is pressed, metres ridden: on the major road, clear of the
 * first junction, at places across a 10 m sample and over the straight, so
 * that no one place the half-turn is tuned to stands for every press.
 */
const PRESS_AT_METRES = [64, 70, 72, 75, 77, 79, 99, 109, 118, 125, 131, 138, 157] as const;

/** Watched at the frame rate from this far before the press, and to this far after it. */
const WATCH_BEFORE_METRES = 5;
const WATCH_AFTER_METRES = 70;

/**
 * Where a press's ride is split between its two cases, metres past the press:
 * **20**, past the half-turn (measured on 2026-11-25, the rider faces more
 * than 170° round by 13 to 14.3 m past every press), so the first case rides
 * the approach, the press and the half-turn, and the second the 50 m on. The
 * largest jumps are in both: measured the same day, at 15 to 39 m past most
 * presses and 69 m past the one at 64 m.
 */
const WATCH_SPLIT_METRES = 20;

/** The frame rate the press is watched at. */
const FPS = 30;

/** The frames before the watch: long, so the ride gets there inside a test's time. */
const APPROACH_FRAME_MS = 500;

/**
 * The most the drawn rider's or the camera's move may change from one frame
 * to the next, metres: **0.05**, `junction-corner.test.tsx` §`JUMP_METRES`.
 * Measured before #3066 at the press: 4.9 m and 4.0 m.
 */
const JUMP_METRES = 0.05;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let frameMs = APPROACH_FRAME_MS;
let mounted: Mounted | undefined;
const drawn: { readonly frame: SceneFrame; readonly input: SceneInput }[] = [];

/** A ride from nothing: no frame drawn or asked for, the clock at nought. */
function freshRide(): void {
  inputs.length = 0;
  drawn.length = 0;
  pending = [];
  nowMs = 0;
  frameMs = APPROACH_FRAME_MS;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
}

function endRide(): void {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
}

async function pump(): Promise<void> {
  const next = pending.shift();
  if (next === undefined) return;
  nowMs += frameMs;
  await act(async () => {
    next(nowMs);
    await Promise.resolve();
  });
}

/** A renderer that keeps each frame it was handed, with the scene input it was built from. */
function capturingRenderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        const input = inputs[inputs.length - 1];
        if (input !== undefined) drawn.push({ frame, input });
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** The grid, ridden east from its corner along row 3, the major road. */
function gridRoute(): RollingRoute {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, roughGround, 3);
  return new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
}

function sessions(): OpenWorldSessions {
  let start = fixtureStart(START_COLUMN, START_ROW) as ReturnType<typeof fixtureStart> | undefined;
  return {
    take: () => {
      const taken = start;
      start = undefined;
      return taken;
    },
    open: () => ({
      ready: Promise.resolve({
        kind: 'ready' as const,
        route: {
          id: OPEN_WORLD_ROUTE_ID,
          name: 'Open world',
          profile: gridRoute().view(),
          attempts: 0,
        },
        road: () => new OpenWorldRoad(gridRoute()),
      }),
      stop: () => undefined,
    }),
  };
}

/** A trainer that takes the road, and keeps every grade it was asked for, and when. */
function trainer(written: { readonly grade: number; readonly atMs: number }[]): GameTrainerPort {
  const facts = { paired: true, controllable: true, canSimulate: true, hasControl: true };
  const control: GradientTrainer = {
    setSimulationParameters: (parameters: SimulationParameters) => {
      written.push({ grade: parameters.grade, atMs: nowMs });
      return Promise.resolve();
    },
    letGo: () => Promise.resolve({ kind: 'stopped' as const }),
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({ trainer: facts, workout: undefined }),
    simulationControl: () => control,
    requestTrainerControl: () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

function port(): GamePort {
  return {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: sessions(),
  };
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

/** The odometer on the last frame built. */
const odometer = (): number => (inputs[inputs.length - 1]?.state.ride.distance as number) ?? 0;

/** `terrain.ts` §`localGroundPosition`'s metres per degree of latitude. */
const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Local metres in `from`'s frame, in `to`'s: a view's frame is its first sample's. */
function reframed(
  from: CorridorOrigin,
  to: CorridorOrigin,
  point: { readonly x: number; readonly z: number },
): { readonly x: number; readonly z: number } {
  const perDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  return localGroundPosition(
    to,
    geographicPosition(
      degreesLatitude(from.latitude + point.z / METRES_PER_DEGREE_LATITUDE),
      degreesLongitude(from.longitude - point.x / perDegreeLongitude),
    ),
  );
}

/** One watched frame, in the first watched frame's local metres. */
interface Watched {
  readonly odometer: number;
  readonly camera: { readonly x: number; readonly z: number };
  readonly rider: { readonly x: number; readonly z: number };
  /** The drawn rider's heading, radians from north. */
  readonly riderYaw: number;
}

/** One press's ride, which its cases share in order — #3141. */
interface PressRide {
  readonly pressAt: number;
  /** Every grade the trainer was asked for, and when. */
  readonly written: { grade: number; atMs: number }[];
  /** The clock when ArrowDown was pressed. */
  pressedAtMs: number;
  /** The first frame {@link watched} reads, and the first drawn after the press. */
  watchedFrom: number;
  pressedFrame: number;
  /** How many of its two stretches the cases have ridden. */
  ridden: number;
}

/**
 * Rides the real game screen up the major road, presses ArrowDown at
 * `pressAt` metres, and rides on to {@link WATCH_SPLIT_METRES} past it, every
 * frame from {@link WATCH_BEFORE_METRES} before it drawn at {@link FPS}.
 */
async function rideToThePress(
  pressAt: number,
  written: { grade: number; atMs: number }[] = [],
): Promise<PressRide> {
  mounted = await mount(
    <GameView
      port={port()}
      trainer={trainer(written)}
      renderer={() => Promise.resolve(capturingRenderer())}
      now={() => nowMs}
    />,
  );
  for (let tries = 0; tries < 50 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
    await settle();
  }
  expect(rideButton()?.textContent).toBe('Ride Open world');
  await act(async () => {
    rideButton()?.click();
    await Promise.resolve();
  });
  await settle();
  // #3141: the clock stands still until the first frame is drawn, however
  // many event-loop turns the view takes to be made.
  frameMs = 0;
  for (let tries = 0; tries < 1_000 && drawn.length === 0; tries += 1) {
    await pump();
    if (drawn.length === 0) await settle();
  }
  expect(drawn.length).toBe(1);
  frameMs = APPROACH_FRAME_MS;
  let watchedFrom: number | undefined;
  const watchFrom = (): void => {
    if (watchedFrom !== undefined || odometer() < pressAt - WATCH_BEFORE_METRES) return;
    watchedFrom = drawn.length;
    frameMs = 1000 / FPS;
  };
  for (let frame = 0; frame < 600 && odometer() < pressAt; frame += 1) {
    await pump();
    watchFrom();
  }
  const pressedFrame = drawn.length;
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }),
    );
    await Promise.resolve();
  });
  const ride: PressRide = {
    pressAt,
    written,
    pressedAtMs: nowMs,
    watchedFrom: watchedFrom ?? drawn.length,
    pressedFrame,
    ridden: 0,
  };
  await rideOn(ride, WATCH_SPLIT_METRES);
  // The press was taken where it was meant to be, read off the frames: the
  // last drawn before it and the first after it, the frame it was handled
  // on, at or past `pressAt` by less than a metre.
  const pressedAt = (at: number): number =>
    (drawn[at] as (typeof drawn)[number]).input.state.ride.distance;
  for (const at of [pressedFrame - 1, pressedFrame]) {
    expect(pressedAt(at)).toBeGreaterThanOrEqual(pressAt);
    expect(pressedAt(at)).toBeLessThan(pressAt + 1);
  }
  ride.ridden = 1;
  return ride;
}

/** Rides `ride` on at {@link FPS} to `metres` past its press, as the last frame drawn reads it. */
async function rideOn(ride: PressRide, metres: number): Promise<void> {
  const from = drawn[ride.pressedFrame - 1]?.input.state.ride.distance as number;
  const until = from + metres;
  for (let frame = 0; frame < 1_200 && odometer() < until; frame += 1) {
    await pump();
  }
  expect(odometer()).toBeGreaterThanOrEqual(until);
}

/**
 * The second stretch of `ride`, on from {@link WATCH_SPLIT_METRES} to
 * {@link WATCH_AFTER_METRES} past the press. A case that finds the ride
 * elsewhere says so, rather than read another stretch's frames: the case
 * before it failed.
 */
async function rideOnFromThePress(ride: PressRide | undefined): Promise<PressRide> {
  if (ride?.ridden !== 1) {
    throw new Error('the case before this one did not ride to the press and through the half-turn');
  }
  await rideOn(ride, WATCH_AFTER_METRES);
  ride.ridden = 2;
  return ride;
}

/** Every frame of `ride` the renderer was handed from `from`, in the first watched frame's local metres. */
function watched(ride: PressRide, from: number = ride.watchedFrom): readonly Watched[] {
  const common = corridorOrigin((drawn[ride.watchedFrom] as (typeof drawn)[number]).input.profile);
  return drawn.slice(from).map(({ frame, input }) => {
    const origin = corridorOrigin(input.profile);
    const rider = frame.markers.find((marker) => marker.kind === 'rider');
    if (rider === undefined) throw new Error('no rider drawn');
    return {
      odometer: input.state.ride.distance,
      camera: reframed(origin, common, frame.camera),
      rider: reframed(origin, common, rider),
      riderYaw: Math.atan2(rider.headingX, rider.headingZ),
    };
  });
}

/** The most a place's move changed from one frame to the next, metres. */
function mostJump(places: readonly { readonly x: number; readonly z: number }[]): number {
  let most = 0;
  for (let index = 2; index < places.length; index += 1) {
    const a = places[index - 2] as { readonly x: number; readonly z: number };
    const b = places[index - 1] as { readonly x: number; readonly z: number };
    const c = places[index] as { readonly x: number; readonly z: number };
    most = Math.max(most, Math.hypot(c.x - 2 * b.x + a.x, c.z - 2 * b.z + a.z));
  }
  return most;
}

const turnBetween = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * The frames of the second stretch of a ride, from the two frames before it,
 * so that every frame's change from the one before is read by one of the two
 * cases.
 */
const SECOND_STRETCH_OVERLAP = 2;

describe('a U-turn press in an open-world ride, frame by frame — #3066', () => {
  describe.each(PRESS_AT_METRES)('pressed at %i m', (pressAt) => {
    let ride: PressRide | undefined;
    let split = 0;
    beforeAll(freshRide);
    afterAll(endRide);

    it('moves neither the drawn rider nor the camera by a jump through the half-turn', async () => {
      ride = await rideToThePress(pressAt);
      const frames = watched(ride);
      split = ride.watchedFrom + frames.length - SECOND_STRETCH_OVERLAP;
      const rider = mostJump(frames.map((frame) => frame.rider));
      const camera = mostJump(frames.map((frame) => frame.camera));
      const facts = JSON.stringify({ pressAt, rider, camera });
      expect(rider, facts).toBeLessThan(JUMP_METRES);
      expect(camera, facts).toBeLessThan(JUMP_METRES);
    });

    it('moves neither by a jump on the way back, and turns the rider round', async () => {
      const ridden = await rideOnFromThePress(ride);
      const later = watched(ridden, split);
      const rider = mostJump(later.map((frame) => frame.rider));
      const camera = mostJump(later.map((frame) => frame.camera));
      const facts = JSON.stringify({ pressAt, rider, camera });
      expect(rider, facts).toBeLessThan(JUMP_METRES);
      expect(camera, facts).toBeLessThan(JUMP_METRES);
      // The rider was turned round, and round a half-turn: facing back down the
      // road at the end, and still facing more than a quarter of the way round
      // from where they started for more than a few metres of the ride.
      const frames = watched(ridden);
      const first = frames[0] as Watched;
      const last = frames[frames.length - 1] as Watched;
      expect(Math.abs(turnBetween(first.riderYaw, last.riderYaw))).toBeGreaterThan(
        (170 * Math.PI) / 180,
      );
      const turning = frames.filter((frame) => {
        const turned = Math.abs(turnBetween(first.riderYaw, frame.riderYaw));
        return turned > Math.PI / 4 && turned < (3 * Math.PI) / 4;
      });
      const across = turning.map((frame) => frame.odometer);
      expect(Math.max(...across) - Math.min(...across), facts).toBeGreaterThan(3);
    });
  });

  describe.each(PRESS_AT_METRES)('pressed at %i m under reduced motion', (pressAt) => {
    let ride: PressRide | undefined;
    let split = 0;
    beforeAll(() => {
      freshRide();
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    });
    afterAll(endRide);

    it('does not teleport the drawn rider through the half-turn', async () => {
      ride = await rideToThePress(pressAt);
      const frames = watched(ride);
      split = ride.watchedFrom + frames.length - SECOND_STRETCH_OVERLAP;
      expect(mostJump(frames.map((frame) => frame.rider))).toBeLessThan(JUMP_METRES);
    });

    it('does not teleport the drawn rider on the way back', async () => {
      const ridden = await rideOnFromThePress(ride);
      expect(mostJump(watched(ridden, split).map((frame) => frame.rider))).toBeLessThan(
        JUMP_METRES,
      );
    });
  });

  describe('the grade', () => {
    let ride: PressRide | undefined;
    let checked = 0;
    beforeAll(freshRide);
    afterAll(endRide);

    /** Holds every write from the `checked`th after the press to 1 % a second from the one before. */
    function expectWalked(walked: PressRide): void {
      const after = walked.written.filter((write) => write.atMs >= walked.pressedAtMs);
      const before = walked.written.filter((write) => write.atMs < walked.pressedAtMs).at(-1);
      expect(before).toBeDefined();
      let previous = (checked === 0 ? before : after[checked - 1]) as {
        grade: number;
        atMs: number;
      };
      for (const write of after.slice(checked)) {
        const seconds = (write.atMs - previous.atMs) / 1000;
        expect(
          Math.abs(write.grade - previous.grade),
          `the write at ${String(write.atMs)} ms`,
        ).toBeLessThanOrEqual(CORRECTION_GRADE_STEP_PERCENT_PER_SECOND * seconds + 1e-9);
        previous = write;
      }
      checked = after.length;
    }

    it('walks the grade to the road back at 1 % a second through the half-turn: drawn only', async () => {
      ride = await rideToThePress(70, []);
      const after = ride.written.filter((write) => write.atMs >= (ride as PressRide).pressedAtMs);
      // Non-vacuity: the trainer was written to through the turn, and the
      // grade it was asked for changed.
      expect(after.length).toBeGreaterThan(3);
      const before = ride.written.filter((write) => write.atMs < (ride as PressRide).pressedAtMs);
      expect(after.some((write) => write.grade !== before.at(-1)?.grade)).toBe(true);
      expectWalked(ride);
    });

    it('walks it on at 1 % a second on the way back', async () => {
      const ridden = await rideOnFromThePress(ride);
      const written = checked;
      expectWalked(ridden);
      // Non-vacuity: the trainer was written to on this stretch too.
      expect(checked).toBeGreaterThan(written);
    });
  });
});
