// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Round the corner at a junction, through the real game screen** — #3051.
 *
 * The owner's tablet ride of 2026-11-22 (build 1122, with #3044's junction
 * wiring) turned at junctions but read as "just flipping screens": the view
 * seemed to switch onto the new road rather than ride round a corner. This
 * file rides the real `GameView` through a left and a right junction on a
 * synthetic grid, frame by frame, and reads back **what the renderer was
 * handed** each frame: the chase camera's eye and heading, and the drawn
 * rider's place and heading. Nothing is read from the road or the route.
 *
 * What it holds, frame by frame through the turn:
 *
 * - **No jump.** The drawn rider and the camera's eye move each frame by about
 *   what was ridden, and the change in that move from one frame to the next is
 *   under {@link JUMP_METRES}: a switch onto another road is metres in one
 *   frame. The control is the one switch this ride has, a U-turn press (see
 *   "What this file does not hold"), which the same measure reads at 4.9 m
 *   for the rider and 4.0 m for the eye.
 * - **A heading that changes continuously.** The camera turns no faster than
 *   `camera.ts`' cap, never back against the turn by more than
 *   {@link BACK_TURN_RADIANS}, and its turn rate changes by under
 *   {@link YAW_RATE_STEP} from one frame to the next; the drawn rider's
 *   heading is held the same way.
 * - **A corner, not a cut.** The drawn rider's heading goes from a tenth of
 *   its turn to nine tenths over at least {@link LEAST_ARC_METRES} ridden,
 *   with reduced motion as without: the camera may turn at its gentler cap,
 *   and the drawn path still rides the corner.
 * - **Drawn only.** Every grade the trainer was asked for is the road's own
 *   at the rider's odometer on the view the frame read, the turn or no turn
 *   (ADR 0060 D-3's drawn-distance rule, ADR 0088 D-5).
 *
 * The session is a double that hands over a rolling route on
 * `@onyourleft/domain/rolling-testing`'s grid, as `junction-wiring.test.tsx`'s
 * does; the game, the simulation, the road, the junction choice, its prompt,
 * the scene, the camera's damping and the trainer port are the product's.
 *
 * ## The owner's ruling of 2026-11-23: the real session, three turns
 *
 * The cases above ride a session double with no street corridor and read
 * only the rider and the camera, which turned smoothly while the tablet
 * showed the screen flipping. The cause was what they did not read: every
 * view change (a press, an extension) re-seeded the whole scenery (#3055),
 * so on the frame of the press every tree and house round the rider was
 * replaced; and no side street was drawn (#2903). The second describe below
 * rides the product's own session (`session.ts`, its reader, graph and
 * rolling route) over {@link OPEN_WORLD_GRID_STREETS}, a town of
 * crossroads, through three turns, and holds on the frames the renderer was
 * handed:
 *
 * - each corner ridden round with the same bounds as above;
 * - **no frame replaces the scene**: the scenery and the ground within
 *   {@link SCENERY_NEAR_METRES} of the rider stay where they were from one
 *   frame to the next through every press and corner — on #2903's branch
 *   alone none of it survives the press;
 * - **nor the scene past the junction**: a press is made 110 m short of its
 *   junction, with everything past it in plain view, and what stands along
 *   every way out from there to {@link SCENERY_FAR_METRES} stays where it
 *   was in plan. With the scenery placed along the road alone, a press took
 *   it all off the road straight on and stood it along the street turned
 *   into: `road.ts` §`waysOut` places it along every way out before the
 *   press, and `ways-out.test.ts` holds that on its own;
 * - **nor the ground past the junction** (#3094): at every change of view
 *   the ground from {@link SCENERY_NEAR_METRES} to {@link SCENERY_FAR_METRES}
 *   stays where it was, to {@link FAR_GROUND_MOST_METRES} at any place, and
 *   what stands on it with it. A view's ground was its own road's
 *   (`landform.ts` §`terrainHeightAt`), so a press redrew the hills past the
 *   junction from the street turned into: half the ground from 60 m to 300 m
 *   moved by more than 25 cm, by up to 29 m, and the scenery standing on it
 *   by up to 18 m. An open-world view's relief is the place's now, levelled
 *   beside every street the ride holds (`street-levels.ts`), and
 *   `ground-of-place.test.ts` holds that on its own;
 * - **the junction is drawn before the rider reaches it, on every way out**,
 *   before the press and after it: the road or a side street runs out along
 *   each way the ride did not come in by.
 *
 * ## What this file does not hold
 *
 * - **A U-turn.** A U-turn press changes the road under the rider at once
 *   (ADR 0088 D-1.6) and its line is drawn at once (`line-ease.ts`), so the
 *   drawn rider and the eye jump. Drawing it round an arc is #3045's lane
 *   (the turnaround's arc), and the press's jump is #3066.
 * - **A street that ends.** Where the street turned into ends within the
 *   view, the route turns round there and comes back through the junction,
 *   and the junction's way out the route will come back along is drawn as
 *   neither the road nor a side street until the road reaches it. The grid
 *   closes every street on another for that reason. That is #3091.
 * - **The ground exactly.** Two views' meshes sample the one surface at
 *   their own vertices and are flat between them, so where their triangles
 *   differ the ground drawn differs by up to {@link FAR_GROUND_MOST_METRES}
 *   (#3094's residual, all of it past 200 m on these presses).
 * - **What is not scenery items, at these three junctions.** None stands
 *   near them. Since #3095 a village's streets and crossroads, the
 *   billboards, the people and the other cyclists are placed along every way
 *   out too: the last two describes below ride the real game screen past a
 *   village, its billboards, its people and the other cyclists on a level
 *   grid (the last in the realistic world, where people and cyclists are
 *   drawn), and `ways-out-villages.test.ts` holds all five through a press.
 *
 * ⚠️ **Every frame held here is a copy** (`frame-testing.ts`
 * §`retainedFrame`). A frame's ground is lent storage that the next build
 * writes over, so two frames held by reference share one ground, and a
 * comparison of the two passes whatever was drawn.
 */

import { Blob as NodeBlob } from 'node:buffer';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RollingRoute,
  degreesLatitude,
  distanceBetween,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  watts,
  type RollingEdge,
} from '@onyourleft/domain';
import {
  gridGraph,
  placeAt,
  roughGround,
  type SyntheticGround,
} from '@onyourleft/domain/rolling-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { countingSource, type CountingSource } from '../../world-data/archive-testing';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import { CAMERA_MAXIMUM_YAW_RATE, REDUCED_MOTION_MAXIMUM_YAW_RATE } from '../camera';
import { retainedFrame } from '../frame-testing';
import { GameView, type GamePort } from '../GameView';
import { standingOnGround } from '../landform';
import type { GameRenderer, SceneFrame } from '../port';
import type { ScatterItem } from '../scatter';
import { PEOPLE_FAR_METRES } from '../people';
import type { SceneInput } from '../scene';
import { REALISTIC_WORLD_STORAGE_KEY } from '../world-preference';
import { corridorOrigin, localGroundPosition, type CorridorOrigin } from '../terrain';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from '../trainer-port';
import { createOpenWorldEntry } from './entry';
import {
  fixturePosition,
  fixtureStart,
  GRID_COLUMNS,
  GRID_ROWS,
  MAIN_STREET_ROW,
  OPEN_WORLD_GRID_STREETS,
  openWorldFixtureArchive,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { OPEN_WORLD_ROUTE_ID, type OpenWorldSessions } from './ride';
import { OpenWorldRoad } from './road';
import { createOpenWorldSession } from './session';
import { lazyOpenWorldSessions } from './session-lazy';

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

/** `junction-wiring.test.tsx`'s grid: the first junction is 180 m on, at column 1, row 3. */
const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510];

/** The ride distance of the junction turned at. */
const JUNCTION_METRES = COLUMNS[1] as number;

/**
 * Where the press is made: 110 m before the junction, inside its 250 m
 * prompt and short of its 100 m lock, as a rider's would be.
 */
const PRESS_AT_METRES = JUNCTION_METRES - 110;

/** Where frames are drawn at the frame rate, from and to: the turn, and some way either side. */
const WATCH_FROM_METRES = JUNCTION_METRES - 40;
const WATCH_TO_METRES = JUNCTION_METRES + 30;

/** The frame rate the turn is watched at. The cap and the damping are by the wall clock. */
const FPS = 30;

/** The frames before the watch: long, so the ride gets there inside a test's time. */
const APPROACH_FRAME_MS = 500;

/**
 * The most the drawn rider's or the eye's move may change from one frame to
 * the next, metres: **0.05**. Measured on 2026-11-22 at 30 fps through either
 * turn: 1.1 mm for the rider and 3.6 mm for the eye. Drawn on `scene.ts`'
 * `uneased` line beside the road, which snapped round a junction before
 * #2422, the eye's is 0.11 m; a switch onto another road is metres.
 */
const JUMP_METRES = 0.05;

/**
 * The most the camera's heading may turn back against the turn in one frame,
 * radians: **0.2°**. Measured: none; on the `uneased` line, 0.49°.
 */
const BACK_TURN_RADIANS = (0.2 * Math.PI) / 180;

/**
 * The most the camera's or the drawn rider's turn rate may change from one
 * frame to the next, radians a second: **8°/s**. Measured at 30 fps: 1.6°/s
 * for the camera and 0.24°/s for the rider; on the `uneased` line, 16.7°/s
 * and 36.7°/s. A heading that snapped would be a whole turn's rate in one
 * frame.
 */
const YAW_RATE_STEP = (8 * Math.PI) / 180;

/**
 * The least distance ridden while the drawn rider's heading goes from a tenth
 * of its turn to nine tenths, metres: **8**. Measured: 35 m turning left and
 * 40 m turning right (22–24 m on the `uneased` line). A corner taken on the
 * road's radius, not a cut.
 */
const LEAST_ARC_METRES = 8;

/** A tolerance on a rate measured over one frame, radians a second. */
const RATE_ROUNDING = 1e-6;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let frameMs = APPROACH_FRAME_MS;
/**
 * #3095: a wall clock that a frame moves on by a 60 Hz frame whatever
 * {@link frameMs} is, for a ride that keeps the realistic world's top rung:
 * on {@link nowMs} the quality ladder reads a long approach frame as a hot
 * one and drops the people and the other cyclists.
 */
let wallMs = 0;
let mounted: Mounted | undefined;
const drawn: { readonly frame: SceneFrame; readonly input: SceneInput }[] = [];

beforeEach(() => {
  inputs.length = 0;
  drawn.length = 0;
  pending = [];
  nowMs = 0;
  wallMs = 0;
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
  wallMs += 1000 / 60;
  await act(async () => {
    next(nowMs);
    await Promise.resolve();
  });
}

/** A renderer that keeps each frame it was handed, with the scene input it was built from. */
function capturingRenderer(realistic = false): GameRenderer {
  return {
    // #3095: the realistic world, where people and the other cyclists are drawn, loads at once.
    loadRealisticWorld: () =>
      realistic
        ? Promise.resolve({ loaded: true })
        : Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        const input = inputs[inputs.length - 1];
        // #3051: a frame's ground is lent storage the next build writes over
        // (`landform.ts` §`TerrainMesh.lease`), so a frame held here is a copy.
        if (input !== undefined) drawn.push({ frame: retainedFrame(frame), input });
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** The grid, ridden east from its corner along row 3, the major road: straight on is its default. */
function gridRoute(
  ground: SyntheticGround = roughGround,
  rows: readonly number[] = ROWS,
  columns: readonly number[] = COLUMNS,
): RollingRoute {
  const { graph, edges } = gridGraph(columns, rows, ground, 3);
  return new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
}

function sessions(
  ground: SyntheticGround = roughGround,
  rows: readonly number[] = ROWS,
  columns: readonly number[] = COLUMNS,
): OpenWorldSessions {
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
          profile: gridRoute(ground, rows, columns).view(),
          attempts: 0,
        },
        road: () => new OpenWorldRoad(gridRoute(ground, rows, columns)),
      }),
      stop: () => undefined,
    }),
  };
}

/** A trainer that takes the road, and keeps every grade it was asked for with the frame it came on. */
function trainer(written: { readonly grade: number; readonly frame: number }[]): GameTrainerPort {
  const facts = { paired: true, controllable: true, canSimulate: true, hasControl: true };
  const control: GradientTrainer = {
    setSimulationParameters: (parameters: SimulationParameters) => {
      written.push({ grade: parameters.grade, frame: inputs.length });
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

/** Local metres in `from`'s frame, in `to`'s: a view's frame is its first sample's, and moves with it. */
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

const turnBetween = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** One watched frame, in the first watched frame's local metres. */
interface Watched {
  readonly odometer: number;
  readonly eye: { readonly x: number; readonly z: number };
  readonly rider: { readonly x: number; readonly z: number };
  /** The camera's heading, radians from north. */
  readonly yaw: number;
  /** The drawn rider's. */
  readonly riderYaw: number;
}

/**
 * Rides the real game screen to the junction, presses `key` there, and
 * watches the turn at {@link FPS}: every frame the renderer was handed
 * from {@link WATCH_FROM_METRES} to {@link WATCH_TO_METRES}.
 */
async function rideTheTurn(
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowDown',
  written: { grade: number; frame: number }[] = [],
  watch: { readonly from: number; readonly to: number } = {
    from: WATCH_FROM_METRES,
    to: WATCH_TO_METRES,
  },
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
    if (watchedFrom !== undefined || odometer() < watch.from) return;
    watchedFrom = drawn.length;
    frameMs = 1000 / FPS;
  };
  for (let frame = 0; frame < 200 && odometer() < PRESS_AT_METRES; frame += 1) {
    await pump();
    watchFrom();
  }
  expect(odometer()).toBeLessThan(JUNCTION_METRES - 100);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    await Promise.resolve();
  });
  for (let frame = 0; frame < 1_200 && odometer() < watch.to; frame += 1) {
    await pump();
    watchFrom();
  }
  expect(odometer()).toBeGreaterThanOrEqual(watch.to);
  const frames = drawn.slice(watchedFrom ?? drawn.length);
  const common = corridorOrigin((frames[0] as (typeof frames)[number]).input.profile);
  return frames.map(({ frame, input }) => {
    const origin = corridorOrigin(input.profile);
    const rider = frame.markers.find((marker) => marker.kind === 'rider');
    if (rider === undefined) throw new Error('no rider drawn');
    return {
      odometer: input.state.ride.distance,
      eye: reframed(origin, common, frame.camera),
      rider: reframed(origin, common, rider),
      yaw: Math.atan2(frame.camera.headingX, frame.camera.headingZ),
      riderYaw: Math.atan2(rider.headingX, rider.headingZ),
    };
  });
}

/** What the turn did, frame to frame. */
interface Turned {
  /** The most the rider's and the eye's move changed from one frame to the next. */
  readonly riderJump: number;
  readonly eyeJump: number;
  /** The camera's fastest turn, radians a second. */
  readonly yawRate: number;
  /** The most the camera turned back against the turn. */
  readonly backTurn: number;
  /** The most the camera's and the rider's turn rate changed from one frame to the next. */
  readonly yawRateStep: number;
  readonly riderYawRateStep: number;
  /** The camera's and the rider's whole turn, signed: positive is left. */
  readonly turn: number;
  readonly riderTurn: number;
  /** The distance ridden while the rider's heading went from a tenth of its turn to nine tenths. */
  readonly arc: number;
}

function turned(frames: readonly Watched[], fps: number = FPS): Turned {
  const seconds = 1 / fps;
  const first = frames[0] as Watched;
  const last = frames[frames.length - 1] as Watched;
  const turn = turnBetween(first.yaw, last.yaw);
  const riderTurn = turnBetween(first.riderYaw, last.riderYaw);
  let riderJump = 0;
  let eyeJump = 0;
  let yawRate = 0;
  let backTurn = 0;
  let yawRateStep = 0;
  let riderYawRateStep = 0;
  let tenth: number | undefined;
  let nineTenths: number | undefined;
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1] as Watched;
    const now = frames[index] as Watched;
    const yawStep = turnBetween(before.yaw, now.yaw);
    yawRate = Math.max(yawRate, Math.abs(yawStep) / seconds);
    backTurn = Math.max(backTurn, -Math.sign(turn) * yawStep);
    const share = turnBetween(first.riderYaw, now.riderYaw) / riderTurn;
    if (tenth === undefined && share >= 0.1) tenth = now.odometer;
    if (nineTenths === undefined && share >= 0.9) nineTenths = now.odometer;
    if (index < 2) continue;
    const earlier = frames[index - 2] as Watched;
    const change = (
      a: { readonly x: number; readonly z: number },
      b: { readonly x: number; readonly z: number },
      c: { readonly x: number; readonly z: number },
    ): number => Math.hypot(c.x - 2 * b.x + a.x, c.z - 2 * b.z + a.z);
    riderJump = Math.max(riderJump, change(earlier.rider, before.rider, now.rider));
    eyeJump = Math.max(eyeJump, change(earlier.eye, before.eye, now.eye));
    yawRateStep = Math.max(
      yawRateStep,
      Math.abs(yawStep - turnBetween(earlier.yaw, before.yaw)) / seconds,
    );
    riderYawRateStep = Math.max(
      riderYawRateStep,
      Math.abs(
        turnBetween(before.riderYaw, now.riderYaw) - turnBetween(earlier.riderYaw, before.riderYaw),
      ) / seconds,
    );
  }
  return {
    riderJump,
    eyeJump,
    yawRate,
    backTurn,
    yawRateStep,
    riderYawRateStep,
    turn,
    riderTurn,
    arc: (nineTenths ?? Infinity) - (tenth ?? -Infinity),
  };
}

/** The checks every turn is held to, with the camera's cap for the rider's motion setting. */
function expectRoundTheCorner(
  ridden: Turned,
  side: 'left' | 'right',
  cap: number = CAMERA_MAXIMUM_YAW_RATE,
  fps: number = FPS,
): void {
  const facts = JSON.stringify(ridden);
  // The whole quarter turn, the right way round, the camera and the rider both.
  const sign = side === 'left' ? 1 : -1;
  expect(sign * ridden.turn, facts).toBeGreaterThan((80 * Math.PI) / 180);
  expect(sign * ridden.turn, facts).toBeLessThan((100 * Math.PI) / 180);
  expect(sign * ridden.riderTurn, facts).toBeGreaterThan((80 * Math.PI) / 180);
  // No jump.
  expect(ridden.riderJump, facts).toBeLessThan(JUMP_METRES);
  expect(ridden.eyeJump, facts).toBeLessThan(JUMP_METRES);
  // A heading that changes continuously.
  expect(ridden.yawRate, facts).toBeLessThanOrEqual(cap + RATE_ROUNDING);
  expect(ridden.backTurn, facts).toBeLessThan(BACK_TURN_RADIANS);
  // A rate's change over one frame is its change a second over the frame's
  // time: the bound is stated at {@link FPS}, and scales with the frame's length.
  expect(ridden.yawRateStep, facts).toBeLessThan((YAW_RATE_STEP * FPS) / fps);
  expect(ridden.riderYawRateStep, facts).toBeLessThan((YAW_RATE_STEP * FPS) / fps);
  // A corner, not a cut.
  expect(ridden.arc, facts).toBeGreaterThanOrEqual(LEAST_ARC_METRES);
}

describe('an open-world ride turns round the corner at a junction, frame by frame — #3051', () => {
  it('turns left: the drawn rider and the camera ride round the corner, with no jump', async () => {
    expectRoundTheCorner(turned(await rideTheTurn('ArrowLeft')), 'left');
  });

  it('turns right: the drawn rider and the camera ride round the corner, with no jump', async () => {
    expectRoundTheCorner(turned(await rideTheTurn('ArrowRight')), 'right');
  });

  it('turns under reduced motion at the gentler cap, and the drawn path still rides the corner', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    expectRoundTheCorner(
      turned(await rideTheTurn('ArrowLeft')),
      'left',
      REDUCED_MOTION_MAXIMUM_YAW_RATE,
    );
  });

  it('sees a switch where there is one: a U-turn press jumps the drawn rider and the eye, the control', async () => {
    // The control for every bound above: the one switch this ride has. A
    // U-turn changes the road under the rider at once (ADR 0088 D-1.6), and
    // its line is drawn at once (`line-ease.ts`), so on the frame of the press
    // the drawn rider's and the eye's move change by metres. Measured on
    // 2026-11-22 at 30 fps: 4.9 m and 4.0 m. ⚠️ When the U-turn is drawn round an arc (#3066,
    // after #3045's arc), this control is replaced by that change's own: it
    // holds the measure, not the jump.
    const frames = await rideTheTurn('ArrowDown', [], {
      from: PRESS_AT_METRES - 5,
      to: PRESS_AT_METRES + 5,
    });
    const ridden = turned(frames);
    expect(ridden.riderJump).toBeGreaterThan(20 * JUMP_METRES);
    expect(ridden.eyeJump).toBeGreaterThan(20 * JUMP_METRES);
  });

  it('asks the trainer for the road’s own grade at the odometer through the turn: the corner is drawn only', async () => {
    const written: { grade: number; frame: number }[] = [];
    await rideTheTurn('ArrowRight', written);
    // The ride went round: the trainer was written to before and after the turn.
    const atTurn = inputs.findIndex(
      (input) => (input.state.ride.distance as number) >= JUNCTION_METRES,
    );
    expect(atTurn).toBeGreaterThan(0);
    expect(written.filter((write) => write.frame < atTurn).length).toBeGreaterThan(3);
    expect(written.filter((write) => write.frame > atTurn).length).toBeGreaterThan(3);
    // Each grade is the road's at the rider on the view drawn that frame or
    // the one before: never a grade read where the rider is DRAWN.
    for (const write of written) {
      const near = [inputs[write.frame - 1], inputs[write.frame]].filter(
        (input): input is SceneInput => input !== undefined,
      );
      const off = Math.min(
        ...near.map((input) =>
          Math.abs((gradeAt(input.profile, input.state.ride.distance) as number) - write.grade),
        ),
      );
      expect(off, `the write on frame ${String(write.frame)}`).toBeLessThan(1e-6);
    }
  });
});

// --- The owner's ruling of 2026-11-23: three turns through the real session ---

/**
 * The three junctions of {@link OPEN_WORLD_GRID_STREETS} the ride turns at, in
 * fixture pixels; the key pressed for each; and the way the ride came in, as
 * a step in pixels: left off Main street to go north, right to go east, right
 * to go south.
 */
const GRID_TURNS: readonly {
  readonly at: readonly [number, number];
  readonly key: 'ArrowLeft' | 'ArrowRight';
  readonly from: readonly [number, number];
}[] = [
  { at: [GRID_COLUMNS[1] as number, MAIN_STREET_ROW], key: 'ArrowLeft', from: [-1, 0] },
  { at: [GRID_COLUMNS[1] as number, GRID_ROWS[1] as number], key: 'ArrowRight', from: [0, 1] },
  { at: [GRID_COLUMNS[2] as number, GRID_ROWS[1] as number], key: 'ArrowRight', from: [-1, 0] },
];

/** The four ways out of a crossroads, as a step in fixture pixels. */
const WAYS_OUT: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** How far out along each way a junction must be drawn, metres: past a stub's 60 m. */
const DRAWN_OUT_METRES: readonly number[] = [15, 30, 60, 120];

/**
 * How near a point on a way out the road or a side road's centreline must
 * run for that way to count as drawn there, metres: **3**, inside the
 * narrowest street's 5.5 m.
 */
const DRAWN_WITHIN_METRES = 3;

/**
 * The frame rate the grid ride is drawn at where it is watched: **20**, the
 * lowest #3068 measured at, so each case below stays inside a test's time.
 * The cap and the damping are by the wall clock.
 */
const GRID_FPS = 20;

/** How far from the rider the scenery and the ground are compared frame to frame, metres: **60**. */
const SCENERY_NEAR_METRES = 60;

/**
 * The least share of the scenery within {@link SCENERY_NEAR_METRES} of the
 * rider that is still there, in place, on the next frame, wherever there are
 * at least {@link SCENERY_COUNTED} such items: **0.75**. Measured on
 * 2026-11-23 through the three presses and corners: never below 0.9 (an item
 * or two left behind the rider), and 1 on each press. On #2903's branch
 * without #3055's ride-keyed scenery it is **0** on the frame of every press:
 * the whole scene is replaced, which is what the owner saw as the screen
 * flipping.
 */
const SCENERY_KEPT_LEAST = 0.75;

/** The fewest items within {@link SCENERY_NEAR_METRES} a share is counted over. */
const SCENERY_COUNTED = 10;

/**
 * How far the ground at a place may be drawn higher or lower on the next
 * frame and still be the same ground, metres: **0.1**. Measured on 2026-11-23
 * through the three corners: 5 cm at most, but for a vertex or two a frame
 * where the mesh folds over itself on the inside of the corner.
 */
const GROUND_MOVED_METRES = 0.1;

/**
 * The most of the ground near the rider that may move by more than
 * {@link GROUND_MOVED_METRES} from one frame to the next, as a share of the
 * places compared: **0.02**. Measured on 2026-11-23: 0.001, 0.010 and 0.011
 * at the worst pair of each ride. The worst of all was the third press:
 * 9 of 797 places, 58 m and 59 m from the rider, drawn 1.5 m lower, the
 * nearest of the ground past the junction, which a choice redrew until
 * #3094; none since.
 */
const GROUND_MOVED_MOST = 0.02;

/**
 * The least of the ground near the rider the next frame still draws, as a
 * share: **0.95**. Measured: 0.959 at the least, the rows that fall off the
 * back of the view as the rider goes on.
 */
const GROUND_KEPT_LEAST = 0.95;

/** The ride distance of each of {@link GRID_TURNS}, from the start snapped onto Main street. */
function gridTurnDistances(): number[] {
  const out: number[] = [];
  let from = fixturePosition(START_COLUMN, MAIN_STREET_ROW);
  let ridden = 0;
  for (const turn of GRID_TURNS) {
    const here = fixturePosition(turn.at[0], turn.at[1]);
    ridden += distanceBetween(from, here) as number;
    out.push(ridden);
    from = here;
  }
  return out;
}

/** The product's open-world sessions over `source`: the session, its reader, graph and route are the real ones. */
function realSessions(source: CountingSource): OpenWorldSessions {
  const entry = createOpenWorldEntry();
  entry.hand(fixtureStart(START_COLUMN, START_ROW));
  return lazyOpenWorldSessions(
    {
      entry,
      basemap: () => ({ archiveUrl: 'https://tiles.example.invalid/a.pmtiles', attribution: '' }),
      mapTilesOn: () => true,
    },
    () =>
      Promise.resolve((start) =>
        createOpenWorldSession({
          start,
          archive: corridorArchiveFrom(source),
          mapTilesOn: () => true,
          yieldToIdle: () => Promise.resolve(),
        }),
      ),
  );
}

/** One frame the renderer was handed, and whether it followed the one before at {@link GRID_FPS}. */
interface GridFrame {
  readonly frame: SceneFrame;
  readonly input: SceneInput;
  readonly fine: boolean;
}

/**
 * The frames between the watched stretches of the grid ride, milliseconds
 * apart: **1000**. The simulation steps at its own rate whatever the frame's;
 * a long frame only draws less, and the earlier turns are pressed on them.
 */
const GRID_APPROACH_FRAME_MS = 1000;

/** One junction of the ride, as the renderer was handed it. */
interface RiddenJunction {
  /** Its ride distance. */
  readonly at: number;
  readonly turn: (typeof GRID_TURNS)[number];
  /** The last frame built before the press, and the first after it. */
  readonly beforePress: GridFrame;
  readonly afterPress: GridFrame;
  /** The frames from {@link WATCH_FROM_METRES} before it to {@link WATCH_TO_METRES} past it. */
  readonly round: readonly GridFrame[];
  /** Every frame from the start to the end of {@link round}. */
  readonly frames: readonly GridFrame[];
}

/**
 * Rides the real game screen, over the real session on
 * {@link OPEN_WORLD_GRID_STREETS}, through {@link GRID_TURNS} as far as the
 * one at `watched`, pressing each turn's key {@link JUNCTION_METRES} −
 * {@link PRESS_AT_METRES} before it. Frames are drawn at {@link GRID_FPS}
 * for five metres either side of that junction's press and from
 * {@link WATCH_FROM_METRES} before it to {@link WATCH_TO_METRES} past it, and
 * {@link GRID_APPROACH_FRAME_MS} apart everywhere else, so each case fits a
 * test's time: each watches one junction.
 */
async function rideTheGridTo(watched: number): Promise<RiddenJunction> {
  // jsdom's `Blob` has no `stream()`, which the fixture archive's gzip uses.
  vi.stubGlobal('Blob', NodeBlob);
  const source = countingSource(await openWorldFixtureArchive(OPEN_WORLD_GRID_STREETS));
  mounted = await mount(
    <GameView
      port={{ ...port(), openWorld: realSessions(source) }}
      renderer={() => Promise.resolve(capturingRenderer())}
      now={() => nowMs}
    />,
  );
  for (let tries = 0; tries < 400 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
    await settle();
  }
  expect(rideButton()?.textContent).toBe('Ride Open world');
  await act(async () => {
    rideButton()?.click();
    await Promise.resolve();
  });
  await settle();
  const distances = gridTurnDistances().slice(0, watched + 1);
  const at = distances[watched] as number;
  const pressAt = (junction: number): number => junction - (JUNCTION_METRES - PRESS_AT_METRES);
  const stretches = [
    { from: pressAt(at) - 5, to: pressAt(at) + 5 },
    {
      from: at - (JUNCTION_METRES - WATCH_FROM_METRES),
      to: at + (WATCH_TO_METRES - JUNCTION_METRES),
    },
  ];
  const frames: GridFrame[] = [];
  /** Draws one frame, at {@link GRID_FPS} inside a watched stretch or about to enter one. */
  const ride = async (): Promise<void> => {
    const here = odometer();
    const fine = stretches.some(({ from, to }) => here >= from - 10 && here <= to);
    frameMs = fine ? 1000 / GRID_FPS : GRID_APPROACH_FRAME_MS;
    const before = drawn.length;
    await pump();
    for (const each of drawn.slice(before)) frames.push({ ...each, fine });
  };
  let pressed = 0;
  for (const [index, junction] of distances.entries()) {
    const turn = GRID_TURNS[index] as (typeof GRID_TURNS)[number];
    for (let frame = 0; frame < 2_000 && odometer() < pressAt(junction); frame += 1) await ride();
    // Inside the prompt, short of the lock, as a rider's press would be.
    expect(odometer()).toBeLessThan(junction - 100);
    pressed = frames.length;
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: turn.key, code: turn.key, bubbles: true }),
      );
      await Promise.resolve();
    });
  }
  const end = at + (WATCH_TO_METRES - JUNCTION_METRES);
  for (let frame = 0; frame < 3_000 && odometer() < end; frame += 1) await ride();
  expect(odometer()).toBeGreaterThanOrEqual(end);
  const from = at - (JUNCTION_METRES - WATCH_FROM_METRES);
  return {
    at,
    turn: GRID_TURNS[watched] as (typeof GRID_TURNS)[number],
    beforePress: frames[pressed - 1] as GridFrame,
    afterPress: frames[pressed] as GridFrame,
    round: frames
      .slice(pressed)
      .filter(({ input }) => (input.state.ride.distance as number) >= from),
    frames,
  };
}

/** `frames` as {@link Watched}, in the ride's one frame (#2902): no view moves it. */
function watchedOn(frames: readonly GridFrame[]): Watched[] {
  const common = corridorOrigin((frames[0] as GridFrame).input.profile);
  return frames.map(({ frame, input }) => {
    expect(corridorOrigin(input.profile)).toStrictEqual(common);
    const rider = frame.markers.find((marker) => marker.kind === 'rider');
    if (rider === undefined) throw new Error('no rider drawn');
    return {
      odometer: input.state.ride.distance,
      eye: { x: frame.camera.x, z: frame.camera.z },
      rider: { x: rider.x, z: rider.z },
      yaw: Math.atan2(frame.camera.headingX, frame.camera.headingZ),
      riderYaw: Math.atan2(rider.headingX, rider.headingZ),
    };
  });
}

/**
 * How far past {@link SCENERY_NEAR_METRES} the scenery is compared across a
 * change of view, metres from the rider: **300**, where the fog has taken
 * four fifths of what stands there (`world.ts` §`fogFactor` at the view's
 * 400 m). A press is made 110 m short of its junction, so this is everything
 * that stands along every way out for 190 m past it.
 */
const SCENERY_FAR_METRES = 300;

/**
 * The most of the scenery from {@link SCENERY_NEAR_METRES} to
 * {@link SCENERY_FAR_METRES} that a change of view may add, as a share of
 * what stands there after it: **0.25**. Measured on 2026-11-23 on the three
 * presses: 0.04, 0.05 and 0.06 added, and 0.96, 0.98 and 0.96 kept. With no
 * scenery along the ways out (`open-world/road.ts` §`waysOut`) a press kept
 * 0.14, 0.04 and 0.14 of it and added 0.87, 0.95 and 0.89: every tree and
 * house past the junction left the road straight on and stood along the
 * street turned into, on the one frame.
 */
const SCENERY_ADDED_MOST = 0.25;

/**
 * How far the ground at a place from {@link SCENERY_NEAR_METRES} to
 * {@link SCENERY_FAR_METRES} may be drawn higher or lower across a change of
 * view and still count as unmoved, metres: **0.25** — #3094's own measure,
 * the verge's drop (`landform.ts` §`VERGE_DROP_METRES`), which the edge of a
 * street that stops being the road takes.
 */
const FAR_GROUND_MOVED_METRES = 0.25;

/**
 * The most of the ground from {@link SCENERY_NEAR_METRES} to
 * {@link SCENERY_FAR_METRES} that a change of view may move by more than
 * {@link FAR_GROUND_MOVED_METRES}, as a share of the places compared:
 * **0.2** — #3094. Measured on 2026-11-23 on the three presses: 0.47, 0.49
 * and 0.56 with each view's ground its own road's; 0.085, 0.106 and 0.068
 * with it the place's (`landform.ts` §`placeFields`), levelled beside every
 * street held (`street-levels.ts`). What is left is two meshes drawing one
 * surface: each samples it at its own vertices and is flat between them, and
 * past 200 m a triangle is 65 to 120 m across.
 */
const FAR_GROUND_MOVED_MOST = 0.2;

/**
 * The most the ground at any place from {@link SCENERY_NEAR_METRES} to
 * {@link SCENERY_FAR_METRES}, or an item standing there, may move on a change
 * of view, metres: **4** — #3094. Measured on 2026-11-23 on the three
 * presses: the ground 17, 27 and 29 m and the scenery 7.4, 14 and 18 m with
 * each view's ground its own road's; the ground 2.0, 2.6 and 1.5 m and the
 * scenery 0.5, 2.3 and 1.2 m with it the place's, all of it more than 200 m
 * from the rider, where the fog has taken half of what stands there.
 */
const FAR_GROUND_MOST_METRES = 4;

/** What changed in the scene round the rider between two frames drawn one after the other. */
interface SceneChange {
  /** How many scenery items stood within {@link SCENERY_NEAR_METRES} of the rider, and the share still there, in place. */
  readonly scenery: number;
  readonly sceneryKept: number;
  /**
   * How many stood from there to {@link SCENERY_FAR_METRES}, the share of
   * them still there in plan, and the share of what stands there after that
   * was not there before.
   */
  readonly far: number;
  readonly farKept: number;
  readonly farAdded: number;
  /**
   * Of the places the frame drew ground at within {@link SCENERY_NEAR_METRES}:
   * the share the next frame still draws ground at, and the share whose
   * ground the next frame draws more than {@link GROUND_MOVED_METRES} higher
   * or lower.
   */
  readonly groundKept: number;
  readonly groundMoved: number;
  /**
   * #3094, compared only where asked (`far`): of the places the frame drew
   * ground at from {@link SCENERY_NEAR_METRES} to {@link SCENERY_FAR_METRES},
   * the share whose ground the next frame draws more than
   * {@link FAR_GROUND_MOVED_METRES} higher or lower, and the most any of
   * them moved, metres.
   */
  readonly farGroundMoved: number;
  readonly farGroundMost: number;
  /**
   * #3094: the most an item from there to {@link SCENERY_FAR_METRES} that
   * is still there in plan was stood higher or lower, metres.
   */
  readonly farHeightMost: number;
}

/**
 * What changed from `before` to `after`. The scenery is compared where the
 * frames carry it. The ground is compared at every vertex `before` drew
 * within {@link SCENERY_NEAR_METRES} of the rider: the top of the ground
 * each frame's own mesh draws at that place (`landform.ts`
 * §`standingOnGround`, the highest triangle there, which is the one seen).
 * Two frames' meshes share no vertex, since each is built round its own
 * rider, and at a corner one mesh lies over itself. `ground` is how far to
 * compare it: not at all, `near` the rider, or `far` as well, out to
 * {@link SCENERY_FAR_METRES} (#3094); it walks both meshes for every vertex.
 */
function sceneChange(
  before: GridFrame,
  after: GridFrame,
  ground: 'none' | 'near' | 'far',
): SceneChange {
  const rider = before.frame.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('no rider drawn');
  const from = (x: number, z: number): number => Math.hypot(x - rider.x, z - rider.z);
  const near = (x: number, z: number): boolean => from(x, z) <= SCENERY_NEAR_METRES;
  const far = (x: number, z: number): boolean =>
    from(x, z) > SCENERY_NEAR_METRES && from(x, z) <= SCENERY_FAR_METRES;
  const inPlan = (item: ScatterItem, other: ScatterItem): boolean =>
    other.kind === item.kind &&
    Math.abs(other.x - item.x) < 0.01 &&
    Math.abs(other.z - item.z) < 0.01;
  const scenery = before.frame.scatter.filter((item) => near(item.x, item.z));
  const kept = scenery.filter((item) =>
    after.frame.scatter.some((other) => inPlan(item, other) && Math.abs(other.y - item.y) < 0.01),
  ).length;
  // Past the junction an item is held to its place in plan, and how far it
  // was stood up or down there is read beside it (#3094).
  const farBefore = before.frame.scatter.filter((item) => far(item.x, item.z));
  const farAfter = after.frame.scatter.filter((item) => far(item.x, item.z));
  let farKept = 0;
  let farHeightMost = 0;
  for (const item of farBefore) {
    const other = after.frame.scatter.find((each) => inPlan(item, each));
    if (other === undefined) continue;
    farKept += 1;
    farHeightMost = Math.max(farHeightMost, Math.abs(other.y - item.y));
  }
  const farAdded = farAfter.filter(
    (item) => !before.frame.scatter.some((other) => inPlan(item, other)),
  ).length;
  let vertices = 0;
  let groundKept = 0;
  let groundMoved = 0;
  let farVertices = 0;
  let farGroundMoved = 0;
  let farGroundMost = 0;
  if (ground !== 'none') {
    const last = before.frame.terrain.mesh.vertices;
    const drawn: { x: number; y: number; z: number; far: boolean }[] = [];
    for (let at = 0; at + 2 < last.length; at += 3) {
      const x = last[at] as number;
      const z = last[at + 2] as number;
      const y = last[at + 1] as number;
      if (near(x, z)) drawn.push({ x, y, z, far: false });
      else if (ground === 'far' && far(x, z)) drawn.push({ x, y, z, far: true });
    }
    const place = (point: { x: number; z: number }): string =>
      `${String(point.x)},${String(point.z)}`;
    const tops = (mesh: SceneFrame['terrain']['mesh']): Map<string, number> =>
      new Map(standingOnGround(drawn, mesh).map((point) => [place(point), point.y]));
    const was = tops(before.frame.terrain.mesh);
    const now = tops(after.frame.terrain.mesh);
    const farPlaces = new Set(drawn.filter((point) => point.far).map(place));
    for (const [at, y] of was) {
      const next = now.get(at);
      if (farPlaces.has(at)) {
        if (next === undefined) continue;
        farVertices += 1;
        const moved = Math.abs(next - y);
        farGroundMost = Math.max(farGroundMost, moved);
        if (moved > FAR_GROUND_MOVED_METRES) farGroundMoved += 1;
        continue;
      }
      vertices += 1;
      if (next === undefined) continue;
      groundKept += 1;
      if (Math.abs(next - y) > GROUND_MOVED_METRES) groundMoved += 1;
    }
  }
  return {
    scenery: scenery.length,
    sceneryKept: scenery.length === 0 ? 1 : kept / scenery.length,
    far: farBefore.length,
    farKept: farBefore.length === 0 ? 1 : farKept / farBefore.length,
    farAdded: farAfter.length === 0 ? 0 : farAdded / farAfter.length,
    groundKept: vertices === 0 ? 1 : groundKept / vertices,
    groundMoved: vertices === 0 ? 0 : groundMoved / vertices,
    farGroundMoved: farVertices === 0 ? 0 : farGroundMoved / farVertices,
    farGroundMost,
    farHeightMost,
  };
}

/** The least distance from `(x, z)` to a polyline of `x, z` pairs, or to one of `x, z, x, z` segments. */
function toSegments(
  x: number,
  z: number,
  points: ArrayLike<number>,
  stride: 2 | 4,
  least = Number.POSITIVE_INFINITY,
): number {
  const step = stride === 2 ? 2 : 4;
  for (let at = 0; at + 3 < points.length; at += step) {
    const ax = points[at] as number;
    const az = points[at + 1] as number;
    const bx = points[at + 2] as number;
    const bz = points[at + 3] as number;
    const span = (bx - ax) ** 2 + (bz - az) ** 2;
    const t =
      span > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / span)) : 0;
    least = Math.min(least, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
  }
  return least;
}

/**
 * The ways out of `junction` that `frame` does not draw: each as `way@metres`,
 * for every point {@link DRAWN_OUT_METRES} along a way the ride did not come
 * in by that neither the road nor any side road runs within
 * {@link DRAWN_WITHIN_METRES} of.
 */
function undrawnWaysOut(junction: RiddenJunction, frame: GridFrame): string[] {
  const origin = corridorOrigin(frame.input.profile);
  const [column, row] = junction.turn.at;
  const metresPerPixel =
    (distanceBetween(fixturePosition(column, row), fixturePosition(column + 1000, row)) as number) /
    1000;
  const centre = frame.frame.corridor.centre.flatMap((point) => [point.x, point.z]);
  const missing: string[] = [];
  for (const way of WAYS_OUT) {
    if (way[0] === junction.turn.from[0] && way[1] === junction.turn.from[1]) continue;
    for (const metres of DRAWN_OUT_METRES) {
      const out = metres / metresPerPixel;
      const { x, z } = localGroundPosition(
        origin,
        fixturePosition(column + way[0] * out, row + way[1] * out),
      );
      let least = toSegments(x, z, centre, 2);
      for (const road of frame.frame.sideRoads) least = toSegments(x, z, road.segments, 4, least);
      if (!(least <= DRAWN_WITHIN_METRES)) missing.push(`${way.join(',')}@${String(metres)}`);
    }
  }
  return missing;
}

/** What one junction's case holds, on the frames the renderer was handed. */
function expectTheRuling(junction: RiddenJunction): void {
  const side = junction.turn.key === 'ArrowLeft' ? 'left' : 'right';
  // 1. Round the corner with no jump: every frame of the turn at the frame
  // rate, so the measures read one frame's change.
  expect(junction.round.every(({ fine }) => fine)).toBe(true);
  expectRoundTheCorner(
    turned(watchedOn(junction.round), GRID_FPS),
    side,
    CAMERA_MAXIMUM_YAW_RATE,
    GRID_FPS,
  );
  // 2. No frame replaces the scene, through the press and the corner: near
  // the rider on every frame, and past the junction at each change of view.
  let pairs = 0;
  let viewChanges = 0;
  for (let index = 1; index < junction.frames.length; index += 1) {
    const before = junction.frames[index - 1] as GridFrame;
    const after = junction.frames[index] as GridFrame;
    if (!before.fine || !after.fine) continue;
    // The quality governor reads the frame times, and the long frames
    // between the watched stretches read as a slow device: where it moved
    // the rung, the rung's scenery budget changed what is placed, not the
    // road.
    if (
      before.input.scatterItems !== after.input.scatterItems ||
      before.input.structureItems !== after.input.structureItems
    ) {
      continue;
    }
    pairs += 1;
    const viewChanged = before.input.profile !== after.input.profile;
    if (viewChanged) viewChanges += 1;
    // The ground at every change of view, out to the far places then, and
    // near the rider on every tenth pair between.
    const change = sceneChange(
      before,
      after,
      viewChanged ? 'far' : pairs % 10 === 0 ? 'near' : 'none',
    );
    const facts = `at ${String(after.input.state.ride.distance)} m: ${JSON.stringify(change)}`;
    if (change.scenery >= SCENERY_COUNTED) {
      expect(change.sceneryKept, facts).toBeGreaterThanOrEqual(SCENERY_KEPT_LEAST);
    }
    expect(change.groundKept, facts).toBeGreaterThanOrEqual(GROUND_KEPT_LEAST);
    expect(change.groundMoved, facts).toBeLessThanOrEqual(GROUND_MOVED_MOST);
    // #3051: and a change of view replaces nothing that stands past the
    // junction either: what stood along the way the route left still stands
    // there, and what stands along the way it took stood there before.
    if (viewChanged) {
      expect(change.far, facts).toBeGreaterThanOrEqual(SCENERY_COUNTED);
      expect(change.farKept, facts).toBeGreaterThanOrEqual(SCENERY_KEPT_LEAST);
      expect(change.farAdded, facts).toBeLessThanOrEqual(SCENERY_ADDED_MOST);
      // #3094: and the ground there stays where it was, and so what stands on it.
      expect(change.farGroundMoved, facts).toBeLessThanOrEqual(FAR_GROUND_MOVED_MOST);
      expect(change.farGroundMost, facts).toBeLessThanOrEqual(FAR_GROUND_MOST_METRES);
      expect(change.farHeightMost, facts).toBeLessThanOrEqual(FAR_GROUND_MOST_METRES);
    }
  }
  // Every frame of the ride was handed the ways out the route does not take.
  expect(junction.frames.every(({ input }) => (input.waysOut?.length ?? 0) >= 2)).toBe(true);

  expect(pairs).toBeGreaterThan(150);
  // The press changed the view on a pair the measure read.
  expect(viewChanges).toBeGreaterThanOrEqual(1);
  // 3. Every way out drawn before the rider reaches it, before the press and after.
  const short = junction.round.filter(
    ({ input }) => (input.state.ride.distance as number) <= junction.at - 10,
  );
  for (const [when, frame] of [
    ['before the press', junction.beforePress],
    ['after the press', junction.afterPress],
    ['10 m short of it', short[short.length - 1] as GridFrame],
  ] as const) {
    expect(undrawnWaysOut(junction, frame), `${junction.turn.key} ${when}`).toStrictEqual([]);
  }
}

describe('the owner’s ruling of 2026-11-23: three turns through the real session — #3051', () => {
  // Each case rides from the start, pressing the turns before its own on long
  // frames, and watches its own junction: round the corner with no jump, no
  // frame that replaces the scene, and every way out drawn before the rider
  // reaches it, before the press and after.
  it('turn 1, left off Main street: round the corner, the scene kept, every way out drawn', async () => {
    expectTheRuling(await rideTheGridTo(0));
  });

  it('turn 2, right: round the corner, the scene kept, every way out drawn', async () => {
    expectTheRuling(await rideTheGridTo(1));
  });

  it('turn 3, right again: round the corner, the scene kept, every way out drawn', async () => {
    expectTheRuling(await rideTheGridTo(2));
  });
});

// --- #3095: a village and its billboards past the junction, on the real game screen ---

/** `ways-out.test.ts`' lowland grid: the same columns, and rows on to 2 150 m. */
const LOWLAND_ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];

/** Low, level ground: villages stand on it. */
const LOWLAND: SyntheticGround = () => 120;

/** How far either side of the junction the corner the route takes is drawn, metres. */
const VILLAGE_CORNER_METRES = 20;

/** A place on the frame's ground, as a frame's pieces hold it. */
type Plan = { readonly x: number; readonly z: number };

/** Every vertex of a frame's village pavements. */
function villagePavements(frame: SceneFrame): Plan[] {
  return frame.streets.flatMap((street) => {
    const out: Plan[] = [];
    for (let at = 0; at + 2 < street.pavement.positions.length; at += 3) {
      out.push({
        x: street.pavement.positions[at] as number,
        z: street.pavement.positions[at + 2] as number,
      });
    }
    return out;
  });
}

/** Every point of a frame's village crossroads' arms. */
function villageCrossroads(frame: SceneFrame): Plan[] {
  return frame.sideRoads
    .filter((road) => road.junction.source === 'village')
    .flatMap((road) => {
      const out: Plan[] = [];
      for (let at = 0; at + 1 < road.segments.length; at += 2) {
        out.push({ x: road.segments[at] as number, z: road.segments[at + 1] as number });
      }
      return out;
    });
}

/**
 * Rides the real game screen over the lowland grid to 110 m short of the
 * junction at `column` along Main street, turns left there, and returns the
 * last frame before the press and the first of the view it gave, with the
 * junction's place in the first's frame.
 */
async function rideTheLowlandTo(column: number, realistic = false, east = 0, back = 110) {
  const junctionAt = (COLUMNS[column] as number) - (COLUMNS[0] as number);
  if (realistic) localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
  const columns = COLUMNS.map((each) => each + east);
  mounted = await mount(
    <GameView
      port={{ ...port(), openWorld: sessions(LOWLAND, LOWLAND_ROWS, columns) }}
      renderer={() => Promise.resolve(capturingRenderer(realistic))}
      now={() => nowMs}
      frameNow={realistic ? () => wallMs : undefined}
    />,
  );
  for (let tries = 0; tries < 50 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
    await settle();
  }
  await act(async () => {
    rideButton()?.click();
    await Promise.resolve();
  });
  await settle();
  frameMs = 1000;
  const pressAt = junctionAt - back;
  for (let frame = 0; frame < 400 && odometer() < pressAt - 15; frame += 1) await pump();
  frameMs = 1000 / 30;
  for (let frame = 0; frame < 400 && odometer() < pressAt; frame += 1) await pump();
  // Inside the prompt, short of the lock, as a rider's press would be.
  expect(odometer()).toBeLessThan(junctionAt - 100);
  const pressed = drawn.length;
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true }),
    );
    await Promise.resolve();
  });
  for (let frame = 0; frame < 3; frame += 1) await pump();
  const before = drawn[pressed - 1];
  const after = drawn.slice(pressed).find(({ input }) => input.profile !== before?.input.profile);
  if (before === undefined || after === undefined) throw new Error('the press changed no view');
  const common = corridorOrigin(before.input.profile);
  return {
    before,
    after,
    common,
    junction: localGroundPosition(common, placeAt(junctionAt + east, LOWLAND_ROWS[3] as number)),
  };
}

/**
 * What of `read` stands past the junction's corner and within reach of the
 * rider, before the press and after it, each in the frame the press was made
 * in, to 10 cm; and the share of each the other still has.
 */
function heldThroughThePress(
  ridden: Awaited<ReturnType<typeof rideTheLowlandTo>>,
  read: (frame: SceneFrame) => readonly Plan[],
): { readonly was: number; readonly kept: number; readonly added: number } {
  const rider = ridden.before.frame.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('no rider drawn');
  const past = (frame: GridFrame | (typeof drawn)[number]): string[] =>
    read(frame.frame)
      .map((place) => reframed(corridorOrigin(frame.input.profile), ridden.common, place))
      .filter(
        (place) =>
          Math.hypot(place.x - ridden.junction.x, place.z - ridden.junction.z) >
            VILLAGE_CORNER_METRES &&
          Math.hypot(place.x - rider.x, place.z - rider.z) <= SCENERY_FAR_METRES + 100,
      )
      .map((place) => `${place.x.toFixed(1)},${place.z.toFixed(1)}`);
  const was = past(ridden.before);
  const now = past(ridden.after);
  const share = (of: readonly string[], within: readonly string[]): number =>
    of.length === 0 ? 1 : of.filter((each) => within.includes(each)).length / of.length;
  return { was: was.length, kept: share(was, now), added: 1 - share(now, was) };
}

/**
 * Of what `read` finds past the junction's corner and within reach of the
 * rider before the press, how many are still there on the first frame of the
 * view it gave — each within `within` metres of where it was, in plan, in the
 * frame the press was made in: people walk, and the other cyclists ride, for
 * the frame between. And how many the second frame has there that the first
 * had nowhere within `within`.
 */
function movingThroughThePress(
  ridden: Awaited<ReturnType<typeof rideTheLowlandTo>>,
  read: (frame: SceneFrame) => readonly Plan[],
  within: number,
  reach: number = SCENERY_FAR_METRES + 100,
): { readonly was: number; readonly moved: number; readonly added: number } {
  const rider = ridden.before.frame.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('no rider drawn');
  const past = (frame: GridFrame | (typeof drawn)[number]): Plan[] =>
    read(frame.frame)
      .map((place) => reframed(corridorOrigin(frame.input.profile), ridden.common, place))
      .filter(
        (place) =>
          Math.hypot(place.x - ridden.junction.x, place.z - ridden.junction.z) >
            VILLAGE_CORNER_METRES && Math.hypot(place.x - rider.x, place.z - rider.z) <= reach,
      );
  const was = past(ridden.before);
  const now = past(ridden.after);
  const missing = (of: readonly Plan[], within_: readonly Plan[]): number =>
    of.filter(
      (place) =>
        !within_.some((other) => Math.hypot(other.x - place.x, other.z - place.z) <= within),
    ).length;
  return { was: was.length, moved: missing(was, now), added: missing(now, was) };
}

/**
 * How far a person walks, or one of the other cyclists rides, from the last
 * frame before the press to the first of the view it gave, at most, metres:
 * **1** — a frame of the 30 Hz ride is 3.3 cm walked and 27 cm ridden at 8 m/s.
 * A choice that took one off the road straight on put it on another street.
 */
const MOVED_IN_A_FRAME_METRES = 1;

/**
 * How far from the rider people are compared, metres: `people.ts`
 * §`PEOPLE_FAR_METRES`, less 20 m. Who is drawn is read from the camera,
 * which stands behind the rider and turns with the frame between.
 */
const PEOPLE_COMPARED_METRES = PEOPLE_FAR_METRES - 20;

describe('#3095: a village and its billboards past the junction stay through the press, on the real game screen', () => {
  it('lays the village’s pavements and its crossroads past the fourth junction where they were', async () => {
    const ridden = await rideTheLowlandTo(4);
    for (const [what, read] of [
      ['pavements', villagePavements],
      ['crossroads', villageCrossroads],
    ] as const) {
      const held = heldThroughThePress(ridden, read);
      expect(held.was, what).toBeGreaterThan(10);
      expect({ what, kept: held.kept, added: held.added }).toStrictEqual({
        what,
        kept: 1,
        added: 0,
      });
    }
  });

  it('stands the billboards past the sixth junction where they were', async () => {
    const held = heldThroughThePress(await rideTheLowlandTo(6), (frame) => frame.billboards);
    expect(held.was).toBeGreaterThanOrEqual(1);
    expect({ kept: held.kept, added: held.added }).toStrictEqual({ kept: 1, added: 0 });
  });
});

describe('#3095: the people and the other cyclists past the junction stay through the press, on the real game screen in the realistic world', () => {
  // Both are drawn only on the realistic world's top rung (`scene.ts`
  // §`SceneInput.people`), which this ride loads and keeps.
  it('walks the village’s people past the sixth junction where they walked', async () => {
    const ridden = await rideTheLowlandTo(5, true);
    expect(ridden.before.input.people).toBeGreaterThan(0);
    const held = movingThroughThePress(
      ridden,
      (frame) => [...(frame.people?.near ?? []), ...(frame.people?.far ?? [])],
      MOVED_IN_A_FRAME_METRES,
      PEOPLE_COMPARED_METRES,
    );
    expect({ moved: held.moved, added: held.added }).toStrictEqual({ moved: 0, added: 0 });
    expect(held.was).toBeGreaterThan(10);
  });

  it('rides the other cyclists past the seventh junction where they rode', async () => {
    // A grid moved 14 m east, whose encounters put cyclists past the junction at the press.
    const ridden = await rideTheLowlandTo(6, true, 14, 104);
    expect(ridden.before.input.sceneryCyclists).toBe(true);
    const held = movingThroughThePress(
      ridden,
      (frame) => frame.cyclists ?? [],
      MOVED_IN_A_FRAME_METRES,
    );
    expect({ moved: held.moved, added: held.added }).toStrictEqual({ moved: 0, added: 0 });
    expect(held.was).toBeGreaterThanOrEqual(2);
  });
});
