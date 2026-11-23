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
 *   frame. The control was the one switch this ride had, a U-turn press,
 *   which the same measure read at 4.9 m for the rider and 4.0 m for the eye
 *   before #3066 drew the press round a half-turn. Since #3066 the press is
 *   held to the same bound here, and the control is a mutation: with the
 *   half-turn taken out (`road.ts` §`drawnPath` drawing the press's line at
 *   once), that case reads the jump again (#3066's merge with #3051).
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
 * - **the junction is drawn before the rider reaches it, on every way out**,
 *   before the press and after it: the road or a side street runs out along
 *   each way the ride did not come in by.
 *
 * ## What this file does not hold
 *
 * - **A U-turn, past its press.** The press itself is held to
 *   {@link JUMP_METRES} here over 5 m either side; the half-turn's shape,
 *   heading and grade are `u-turn-press.test.tsx`'s (#3066).
 * - **A street that ends.** Where the street turned into ends within the
 *   view, the route turns round there and comes back through the junction,
 *   and the junction's way out the route will come back along is drawn as
 *   neither the road nor a side street until the road reaches it. The grid
 *   closes every street on another for that reason. That is #3091.
 * - **The ground past the junction.** A view's ground is built from its own
 *   road (`landform.ts` §`terrainHeightAt`), so a press redraws the hills
 *   past the junction from the street turned into: measured on these three
 *   presses, a third to a half of the ground from 110 m to 300 m ahead moves
 *   by more than 25 cm, and by up to 32 m. What stands there is held to its
 *   place in plan, and moves up or down with the ground under it. The
 *   ground within {@link SCENERY_NEAR_METRES} is held; the nearest of the
 *   redrawn ground reaches it on the third press
 *   ({@link GROUND_MOVED_MOST}). That is #3094.
 * - **What is not scenery items.** Village streets and pavements,
 *   billboards, people and the other cyclists are placed along the road
 *   alone. None stands near these three junctions. That is #3095.
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
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';
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
import type { SceneInput } from '../scene';
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

  it('holds a U-turn press to the same bound: the drawn rider and the eye do not jump (#3066)', async () => {
    // This was the control for every bound above, the one switch this ride
    // had: a U-turn changed the road under the rider at once (ADR 0088
    // D-1.6) and its line was drawn at once, so on the frame of the press the
    // drawn rider's and the eye's move changed by metres (measured on
    // 2026-11-22 at 30 fps: 4.9 m and 4.0 m). #3066 draws the press round a
    // half-turn from where the rider was drawn, so this case holds the
    // measure, not the jump, as the 2026-11-22 note here asked of it. The
    // control is now a mutation: with `road.ts` §`drawnPath` drawing the
    // press's line at once, this case goes red at metres.
    const frames = await rideTheTurn('ArrowDown', [], {
      from: PRESS_AT_METRES - 5,
      to: PRESS_AT_METRES + 5,
    });
    const ridden = turned(frames);
    expect(ridden.riderJump).toBeLessThan(JUMP_METRES);
    expect(ridden.eyeJump).toBeLessThan(JUMP_METRES);
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
 * at the worst pair of each ride. ⚠️ The worst of all is the third press:
 * 9 of 797 places, 58 m and 59 m from the rider, drawn 1.5 m lower. That is
 * the nearest of the ground past the junction, which a choice still redraws
 * (this file's header, "What this file does not hold").
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
}

/**
 * What changed from `before` to `after`. The scenery is compared where the
 * frames carry it. The ground is compared at every vertex `before` drew
 * within {@link SCENERY_NEAR_METRES} of the rider: the top of the ground
 * each frame's own mesh draws at that place (`landform.ts`
 * §`standingOnGround`, the highest triangle there, which is the one seen).
 * Two frames' meshes share no vertex, since each is built round its own
 * rider, and at a corner one mesh lies over itself. `ground` is whether to
 * compare it at all: it walks both meshes for every vertex.
 */
function sceneChange(before: GridFrame, after: GridFrame, ground: boolean): SceneChange {
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
  // Past the junction the ground itself is another view's after a choice
  // (this file's header), so there an item is held to its place in plan.
  const farBefore = before.frame.scatter.filter((item) => far(item.x, item.z));
  const farAfter = after.frame.scatter.filter((item) => far(item.x, item.z));
  const farKept = farBefore.filter((item) =>
    after.frame.scatter.some((other) => inPlan(item, other)),
  ).length;
  const farAdded = farAfter.filter(
    (item) => !before.frame.scatter.some((other) => inPlan(item, other)),
  ).length;
  let vertices = 0;
  let groundKept = 0;
  let groundMoved = 0;
  if (ground) {
    const last = before.frame.terrain.mesh.vertices;
    const drawn: { x: number; y: number; z: number }[] = [];
    for (let at = 0; at + 2 < last.length; at += 3) {
      const x = last[at] as number;
      const z = last[at + 2] as number;
      if (near(x, z)) drawn.push({ x, y: last[at + 1] as number, z });
    }
    const place = (point: { x: number; z: number }): string =>
      `${String(point.x)},${String(point.z)}`;
    const tops = (mesh: SceneFrame['terrain']['mesh']): Map<string, number> =>
      new Map(standingOnGround(drawn, mesh).map((point) => [place(point), point.y]));
    const was = tops(before.frame.terrain.mesh);
    const now = tops(after.frame.terrain.mesh);
    vertices = was.size;
    for (const [at, y] of was) {
      const next = now.get(at);
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
    // The ground at every change of view, and on every tenth pair between.
    const change = sceneChange(before, after, viewChanged || pairs % 10 === 0);
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
