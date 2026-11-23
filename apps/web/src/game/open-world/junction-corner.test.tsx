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
 * ## What this file does not hold
 *
 * - **A U-turn.** A U-turn press changes the road under the rider at once
 *   (ADR 0088 D-1.6) and its line is drawn at once (`line-ease.ts`), so the
 *   drawn rider and the eye jump. Drawing it round an arc is #3045's lane
 *   (the turnaround's arc), and the press's jump is #3066.
 * - **The side street.** The street turned into is drawn only as the road
 *   the ride takes; the junction's other ways are #2903.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RollingRoute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  watts,
  type RollingEdge,
} from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { CAMERA_MAXIMUM_YAW_RATE, REDUCED_MOTION_MAXIMUM_YAW_RATE } from '../camera';
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

function turned(frames: readonly Watched[]): Turned {
  const seconds = 1 / FPS;
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
  expect(ridden.yawRateStep, facts).toBeLessThan(YAW_RATE_STEP);
  expect(ridden.riderYawRateStep, facts).toBeLessThan(YAW_RATE_STEP);
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
