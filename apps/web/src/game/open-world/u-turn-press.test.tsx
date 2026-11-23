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
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Where the U-turn is pressed: on the major road, clear of the first junction. */
const PRESS_AT_METRES = 70;

/** Watched at the frame rate from this far before the press, and to this far after it. */
const WATCH_BEFORE_METRES = 5;
const WATCH_AFTER_METRES = 40;

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
/** The clock when ArrowDown was pressed, for the trainer's writes. */
let pressedAtMs = 0;
let nowMs = 0;
let frameMs = APPROACH_FRAME_MS;
let mounted: Mounted | undefined;
const drawn: { readonly frame: SceneFrame; readonly input: SceneInput }[] = [];

beforeEach(() => {
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
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

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

/**
 * Rides the real game screen up the major road, presses ArrowDown at
 * {@link PRESS_AT_METRES}, and watches every frame the renderer was handed
 * at {@link FPS} around it.
 */
async function rideThePress(
  written: { grade: number; atMs: number }[] = [],
): Promise<readonly Watched[]> {
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
  let watchedFrom: number | undefined;
  const watchFrom = (): void => {
    if (watchedFrom !== undefined || odometer() < PRESS_AT_METRES - WATCH_BEFORE_METRES) return;
    watchedFrom = drawn.length;
    frameMs = 1000 / FPS;
  };
  for (let frame = 0; frame < 600 && odometer() < PRESS_AT_METRES; frame += 1) {
    await pump();
    watchFrom();
  }
  expect(odometer()).toBeLessThan(PRESS_AT_METRES + 1);
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }),
    );
    await Promise.resolve();
  });
  pressedAtMs = nowMs;
  const until = odometer() + WATCH_AFTER_METRES;
  for (let frame = 0; frame < 1_200 && odometer() < until; frame += 1) {
    await pump();
  }
  expect(odometer()).toBeGreaterThanOrEqual(until);
  const frames = drawn.slice(watchedFrom ?? drawn.length);
  const common = corridorOrigin((frames[0] as (typeof frames)[number]).input.profile);
  return frames.map(({ frame, input }) => {
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

describe('a U-turn press in an open-world ride, frame by frame — #3066', () => {
  it('moves neither the drawn rider nor the camera by a jump, and turns the rider round', async () => {
    const frames = await rideThePress();
    const rider = mostJump(frames.map((frame) => frame.rider));
    const camera = mostJump(frames.map((frame) => frame.camera));
    const facts = JSON.stringify({ rider, camera });
    expect(rider, facts).toBeLessThan(JUMP_METRES);
    expect(camera, facts).toBeLessThan(JUMP_METRES);
    // The rider was turned round, and round a half-turn: facing back down the
    // road at the end, and still facing more than a quarter of the way round
    // from where they started for more than a few metres of the ride.
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
    expect(Math.max(...across) - Math.min(...across)).toBeGreaterThan(3);
  });

  it('does not teleport the drawn rider under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const frames = await rideThePress();
    expect(mostJump(frames.map((frame) => frame.rider))).toBeLessThan(JUMP_METRES);
  });

  it('walks the grade to the road back at 1 % a second: the half-turn is drawn only', async () => {
    const written: { grade: number; atMs: number }[] = [];
    await rideThePress(written);
    const after = written.filter((write) => write.atMs >= pressedAtMs);
    // Non-vacuity: the trainer was written to through the turn, and the
    // grade it was asked for changed.
    expect(after.length).toBeGreaterThan(3);
    const before = written.filter((write) => write.atMs < pressedAtMs).at(-1);
    expect(before).toBeDefined();
    expect(after.some((write) => write.grade !== before?.grade)).toBe(true);
    let previous = before as { grade: number; atMs: number };
    for (const write of after) {
      const seconds = (write.atMs - previous.atMs) / 1000;
      expect(
        Math.abs(write.grade - previous.grade),
        `the write at ${String(write.atMs)} ms`,
      ).toBeLessThanOrEqual(CORRECTION_GRADE_STEP_PERCENT_PER_SECOND * seconds + 1e-9);
      previous = write;
    }
  });
});
