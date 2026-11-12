// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Delivery's belt in a real WebGL context — #1814. What jsdom cannot do for
 * `delivery-belt.test.ts`: draw, count the draw calls, and read a pixel. The
 * drawing is `three-renderer.ts`' own (`threeGameRenderer`,
 * `deliveryCallsProbe`, `deliveryKindProbe`), because nothing but that file
 * may import three (`three-seam.test.ts`).
 *
 * Published on `window.__oylDelivery`:
 *
 * 1. **`viewCalls(count)`** — a REAL view (`threeGameRenderer.create`) drawing
 *    a real frame (`scene.ts` §`sceneFrame`, the stylised world) with and
 *    without `SceneFrame.delivery` holding `count` of each piece beside the
 *    road ahead: every draw call the page makes, counted at WebGL's own entry
 *    points (`realistic/draws.ts`), each frame drawn twice and the second
 *    read, so an upload is not counted as a draw.
 * 2. **`markerLeaves()`** — the same view, two houses on the round: a parcel
 *    thrown by the real `throw.ts` until it delivers to the first, and what
 *    the view's belt drew of the markers on the frame before and the frame
 *    after, read back off its instances (`three-renderer.ts`
 *    §`deliveryDrawnOf`) — not off the round.
 * 3. **`probeCalls(world, count)`** — the belt alone in each world's
 *    materials, three's `renderer.info.render.calls` shown and hidden: the
 *    realistic world's programs compile and draw without loading the
 *    realistic world, which the required gate does not pay for (#866).
 * 4. **`kinds(world)`** — one obstacle of each kind, square-on: whether a
 *    point only the bin covers, one the bin and the cone cover, and one the
 *    bin and the trolley cover read as painted.
 *    **`pullingOut(world)`** — #2506: a car pulling out read at the same
 *    points, and a parked car and a car pulling out read at the middle of
 *    where a hazard marker floats, with the eye raised to it.
 * 5. **`showcase()`** — a real view's frame with a parcel in flight, a house's
 *    marker and one obstacle of each kind, on a canvas the spec photographs
 *    for the owner (the lane's ruling of 2026-10-28).
 * 6. **`inLane(kind, lane, aheads, clearShare, width, height)`** — #2396: a
 *    real view's frame with the rider steered into a lane and an obstacle
 *    standing in that lane at each distance ahead, and how many of the pixels
 *    it and its hazard marker changed stand clear above the rider's top.
 * 7. **`inLaneShowcase(ahead)`** — #2396's photograph: that frame on the
 *    owner's tablet, a bin in the rider's lane and a cone beyond it.
 * 8. **`pastParkedCar(eyeAheads, width, height)`** — #2396: the rider back in
 *    the right-hand lane just past a parked car, the camera still beside it,
 *    and how much of the road under the rider the car covers at each place.
 */

import { metres } from '@onyourleft/domain';

import {
  CAMERA_BEHIND_RIDER_METRES,
  eyeLateralBesideParkedCars,
} from '../src/game/delivery/camera-clear';
import { deliveryInView } from '../src/game/delivery/in-view';
import {
  parkedCarStands,
  startObstacles,
  type Obstacle,
  type ObstacleKind,
} from '../src/game/delivery/obstacles';
import { startRound } from '../src/game/delivery/round';
import type { DeliveryTarget } from '../src/game/delivery/targets';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  NO_PARCELS,
  PARCEL_FLIGHT_TICKS,
  stepThrows,
  type ThrowState,
  type ThrowTarget,
} from '../src/game/delivery/throw';
import type { DeliveryInView, GameView, SceneFrame } from '../src/game/port';
import { qualitySettings } from '../src/game/quality';
import { northRoute } from '../src/game/route-fixtures-testing';
import { sceneFrame } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import type { CorridorPoint } from '../src/game/terrain';
import { corridorOrigin } from '../src/game/terrain';
import {
  deliveryCallsProbe,
  deliveryDrawnOf,
  deliveryKindProbe,
  threeGameRenderer,
  type DeliveryCalls,
} from '../src/game/three-renderer';

import { drawCounter } from './realistic/draws';

/** What {@link viewCalls} counted. */
export interface DeliveryViewCalls {
  /** Calls for the frame with no Delivery round. */
  readonly without: number;
  /** Calls for the same frame carrying `count` of each piece. */
  readonly with: number;
  /** Calls for the same frame carrying a Delivery round with nothing in view: the control. */
  readonly empty: number;
  /** What the view's belt drew of each, read back off its instances. */
  readonly drawn: Readonly<Record<'parcels' | 'markers' | 'obstacles', number>>;
}

/** What {@link markerLeaves} read off the view's belt. */
export interface DeliveryMarkerReading {
  readonly delivered: boolean;
  readonly before: { readonly markers: number; readonly first: boolean; readonly second: boolean };
  readonly after: { readonly markers: number; readonly first: boolean; readonly second: boolean };
}

declare global {
  interface Window {
    __oylDelivery?: {
      readonly ready: boolean;
      viewCalls(count: number): DeliveryViewCalls;
      markerLeaves(): DeliveryMarkerReading;
      probeCalls(world: 'stylised' | 'realistic', count: number): DeliveryCalls;
      kinds(world: 'stylised' | 'realistic'): Readonly<Record<ProbedKind, readonly boolean[]>>;
      pullingOut(world: 'stylised' | 'realistic'): PullingOutReading;
      showcase(): void;
      carsShowcase(): void;
      pullingOutShowcase(): void;
      inLane(
        kind: ObstacleKind,
        lane: number,
        aheads: readonly number[],
        clearShare: number,
        width: number,
        height: number,
      ): InLaneReading;
      inLaneShowcase(ahead: number): void;
      pastCarShowcase(eyeAhead: number, behind: boolean): void;
      pastParkedCar(
        eyeAheads: readonly number[],
        width: number,
        height: number,
      ): readonly PastCarSample[];
    };
  }
}

const counter = drawCounter(WebGL2RenderingContext.prototype);

/**
 * The kinds this harness reads pixels of. #2364's dog and other rider are
 * held to their footprints and their one instanced mesh by
 * `delivery-belt.test.ts`; a car pulling out is drawn as a parked car.
 */
const ROSTER = ['bin', 'trolley', 'cone', 'parked-car'] as const satisfies readonly ObstacleKind[];

/** One of {@link ROSTER}. */
type ProbedKind = (typeof ROSTER)[number];

/** The kinds that cross the road: a parked car (#2362) only ever stands. */
const CROSSING_ROSTER: readonly ObstacleKind[] = ['bin', 'trolley', 'cone'];

/**
 * The points `deliveryKindProbe` reads, the obstacle's own metres, `x` across
 * and `y` up: inside the bin's body above the cone's tip; low on the middle,
 * inside the bin and the cone but between the trolley's uprights; on the
 * trolley's right upright, inside the bin, wide of the cone. A parked car
 * (#2362) paints the first and the last, its body, and not the middle, which
 * is under its body and between its wheels.
 */
const KIND_POINTS: readonly (readonly [number, number])[] = [
  [0.1, 0.85],
  [0, 0.2],
  [0.22, 0.5],
];

/** A fresh canvas a call, so no reading inherits another's context. */
function canvas(width = 320, height = 180): HTMLCanvasElement {
  const made = document.createElement('canvas');
  made.width = width;
  made.height = height;
  document.body.append(made);
  return made;
}

const ROUTE = northRoute(2_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
/** Where the rider is: far enough in that the corridor runs its whole 60 m behind. */
const RIDER = 400;

function frameAt(distance: number): SceneFrame {
  const start = atStartLine(ROUTE);
  return sceneFrame({
    profile: ROUTE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
  });
}

/** The corridor point nearest `along`. */
function pointNear(frame: SceneFrame, along: number): CorridorPoint {
  let best = frame.corridor.centre[0] as CorridorPoint;
  for (const point of frame.corridor.centre) {
    if (Math.abs(point.along - along) < Math.abs(best.along - along)) best = point;
  }
  return best;
}

/** `count` of each piece on `frame`'s road ahead of the rider, two metres apart. */
function piecesOn(frame: SceneFrame, count: number): DeliveryInView {
  const at = (index: number, across: number, up: number) => {
    const point = pointNear(frame, RIDER + 10 + 2 * index);
    return { x: point.x - across, y: point.y + up, z: point.z, yaw: 0 };
  };
  return {
    parcels: Array.from({ length: count }, (_, index) => at(index, 2, 1)),
    markers: Array.from({ length: count }, (_, index) => at(index, 6, 0)),
    obstacles: Array.from({ length: count }, (_, index) => ({
      ...at(index, -2, 0),
      kind: ROSTER[index % ROSTER.length] as ProbedKind,
    })),
  };
}

/** Every draw call one render of `frame` makes, the second of two. */
function callsOf(view: GameView, frame: SceneFrame): number {
  view.render(frame);
  counter.takeCalls();
  view.render(frame);
  return counter.takeCalls();
}

function viewCalls(count: number): DeliveryViewCalls {
  const view = threeGameRenderer.create(canvas(), qualitySettings(0));
  view.resize(320, 180);
  const frame = frameAt(RIDER);
  const without = callsOf(view, frame);
  const delivery = piecesOn(frame, count);
  const withDelivery = callsOf(view, { ...frame, delivery });
  const drawn = {
    parcels: deliveryDrawnOf(view, 'parcels').length,
    markers: deliveryDrawnOf(view, 'markers').length,
    obstacles: deliveryDrawnOf(view, 'obstacles').length,
  };
  const empty = callsOf(view, { ...frame, delivery: { parcels: [], markers: [], obstacles: [] } });
  view.destroy();
  return { without, with: withDelivery, empty, drawn };
}

/** Two houses on the rider's right, a doorstep 1.5 m off the carriageway, at `distances`. */
function housesOn(frame: SceneFrame, distances: readonly number[]): DeliveryTarget[] {
  return distances.map((distance, position) => {
    const point = pointNear(frame, distance);
    const fromRoad = CARRIAGEWAY_HALF_WIDTH_METRES + 1.5;
    // Riding north the rider's right is east, `−x`.
    return {
      position,
      distance: point.along,
      side: 1,
      fromRoad,
      kind: 'doorstep',
      x: point.x - fromRoad,
      y: point.y,
      z: point.z,
      yaw: -Math.PI / 2,
    };
  });
}

function markerLeaves(): DeliveryMarkerReading {
  const view = threeGameRenderer.create(canvas(), qualitySettings(0));
  view.resize(320, 180);
  const frame = frameAt(RIDER);
  const targets = housesOn(frame, [RIDER + 20, RIDER + 80]);
  const [first, second] = targets as [DeliveryTarget, DeliveryTarget];
  const throwTargets: ThrowTarget[] = targets.map((target) => ({
    position: target.position,
    along: target.distance,
    side: 'right',
    clear: target.fromRoad - CARRIAGEWAY_HALF_WIDTH_METRES,
  }));
  const read = (): DeliveryMarkerReading['before'] => {
    const markers = deliveryDrawnOf(view, 'markers');
    const on = (target: DeliveryTarget): boolean =>
      markers.some(
        (marker) =>
          Math.abs(marker.x - target.x) < 1e-3 &&
          Math.abs(marker.y - target.y) < 1e-3 &&
          Math.abs(marker.z - target.z) < 1e-3,
      );
    return { markers: markers.length, first: on(first), second: on(second) };
  };
  const draw = (round: ReturnType<typeof startRound>, throws: ThrowState): void => {
    view.render({
      ...frame,
      delivery: deliveryInView({
        corridor: frame.corridor,
        targets,
        round,
        throws,
        obstacles: [],
        obstacleState: startObstacles([]),
      }),
    });
  };
  // Thrown 5 m short of the first house at 10 m/s: the parcel reaches its
  // doorstep, 5 m from the road's centre, half a second and 5 m later.
  const rider = { along: first.distance - 5, speed: 10 };
  let round = startRound(2);
  let throws = stepThrows(NO_PARCELS, {
    rider,
    targets: throwTargets,
    round,
    throwTo: 'right',
    ticks: 0,
  }).state;
  draw(round, throws);
  let before = read();
  let delivered = false;
  for (let tick = 0; tick < PARCEL_FLIGHT_TICKS && !delivered; tick += 1) {
    before = read();
    const step = stepThrows(throws, { rider, targets: throwTargets, round });
    throws = step.state;
    round = step.round;
    delivered = step.landings.some((landing) => landing.kind === 'delivery');
    draw(round, throws);
  }
  const after = read();
  view.destroy();
  return { delivered, before, after };
}

function kinds(world: 'stylised' | 'realistic'): Record<ProbedKind, readonly boolean[]> {
  const read = (kind: ProbedKind): readonly boolean[] =>
    deliveryKindProbe(canvas(256, 256), world, kind, KIND_POINTS);
  return {
    bin: read('bin'),
    trolley: read('trolley'),
    cone: read('cone'),
    'parked-car': read('parked-car'),
  };
}

/** #2506's reading: a car pulling out's body at {@link KIND_POINTS}, and whether each car paints a hazard marker's middle. */
interface PullingOutReading {
  readonly body: readonly boolean[];
  readonly marker: { readonly 'parked-car': boolean; readonly 'car-pulling-out': boolean };
}

/**
 * The middle of an obstacle's hazard marker, the obstacle's own metres:
 * `three-renderer.ts` §`HAZARD_MARKER_MIDDLE_METRES`, 2.7 m up, on its axis.
 * Restated: the marker's height is not exported.
 */
const MARKER_POINT = [0, 2.7] as const;

function pullingOut(world: 'stylised' | 'realistic'): PullingOutReading {
  const marker = (kind: 'parked-car' | 'car-pulling-out'): boolean =>
    deliveryKindProbe(canvas(256, 256), world, kind, [MARKER_POINT], MARKER_POINT[1])[0] === true;
  return {
    body: deliveryKindProbe(canvas(256, 256), world, 'car-pulling-out', KIND_POINTS),
    marker: { 'parked-car': marker('parked-car'), 'car-pulling-out': marker('car-pulling-out') },
  };
}

function probeCalls(world: 'stylised' | 'realistic', count: number): DeliveryCalls {
  const view: DeliveryInView = {
    parcels: Array.from({ length: count }, (_, index) => ({ x: index, y: 1, z: 0, yaw: 0 })),
    markers: Array.from({ length: count }, (_, index) => ({ x: index, y: 0, z: 3, yaw: 0 })),
    obstacles: Array.from({ length: count }, (_, index) => ({
      x: index,
      y: 0,
      z: -3,
      yaw: 0,
      kind: ROSTER[index % ROSTER.length] as ProbedKind,
    })),
  };
  return deliveryCallsProbe(canvas(64, 32), world, view);
}

/** One frame for the owner's photograph: a parcel in flight, a house's marker, one obstacle of each kind. */
function showcase(): void {
  const shown = canvas(960, 540);
  shown.id = 'delivery-showcase';
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(960, 540);
  const frame = frameAt(RIDER);
  const targets = housesOn(frame, [RIDER + 9]);
  const throws = stepThrows(
    stepThrows(NO_PARCELS, {
      rider: { along: RIDER, speed: 8 },
      targets: [],
      round: startRound(1),
      throwTo: 'right',
      ticks: 0,
    }).state,
    { rider: { along: RIDER, speed: 8 }, targets: [], round: startRound(1), ticks: 4 },
  ).state;
  const obstacles: Obstacle[] = CROSSING_ROSTER.map((kind, index) => ({
    kind,
    along: RIDER + 7 + 3 * index,
    from: index === 1 ? 'right' : 'left',
    startAfter: 0,
  }));
  const state = startObstacles(obstacles);
  view.render({
    ...frame,
    delivery: deliveryInView({
      corridor: frame.corridor,
      targets,
      round: startRound(1),
      throws,
      obstacles,
      obstacleState: { ...state, tick: 30, startedAt: [0, 10, 25] },
    }),
  });
}

/**
 * #2362, round 5: the owner's photograph of the parked cars, three in a row
 * at the right-hand kerb ahead of the rider, one of each paint, on a real
 * frame of the stylised world.
 */
function carsShowcase(): void {
  const shown = canvas(960, 540);
  shown.id = 'delivery-cars';
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(960, 540);
  const frame = frameAt(RIDER);
  const obstacles: Obstacle[] = [9, 15, 21].map((ahead) => ({
    kind: 'parked-car',
    along: RIDER + ahead,
    stands: parkedCarStands('right'),
  }));
  view.render({
    ...frame,
    delivery: deliveryInView({
      corridor: frame.corridor,
      targets: [],
      round: startRound(1),
      throws: NO_PARCELS,
      obstacles,
      obstacleState: startObstacles(obstacles),
    }),
  });
}

/**
 * #2506's photograph for the owner: a parked car at the right kerb 10 m
 * ahead, and a car about to pull out of the same kerb 20 m ahead, waiting
 * and not yet set going, through a real view and the real `deliveryInView`.
 */
function pullingOutShowcase(): void {
  const shown = canvas(960, 540);
  shown.id = 'delivery-pulling-out';
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(960, 540);
  const frame = frameAt(RIDER);
  const obstacles: Obstacle[] = [
    { kind: 'parked-car', along: RIDER + 10, stands: parkedCarStands('right') },
    {
      kind: 'car-pulling-out',
      along: RIDER + 20,
      from: 'right',
      startAfter: 0,
      to: parkedCarStands('right'),
      rides: 0,
    },
  ];
  view.render({
    ...frame,
    delivery: deliveryInView({
      corridor: frame.corridor,
      targets: [],
      round: startRound(1),
      throws: NO_PARCELS,
      obstacles,
      obstacleState: startObstacles(obstacles),
    }),
  });
}

/** One distance {@link inLane} read: the obstacle `ahead` metres up the rider's own lane. */
export interface InLaneSample {
  /** How far ahead of the rider the obstacle stands, metres. */
  readonly ahead: number;
  /** Pixels the obstacle and its marker changed, with the rider drawn in front of them. */
  readonly drawn: number;
  /** Of those, the pixels at least the asked share of the frame's height above the rider's top. */
  readonly clear: number;
}

/** What {@link inLane} read: where the rider's top is, and each distance. */
export interface InLaneReading {
  /** The rider's highest drawn row, as a share of the frame's height from its top. */
  readonly riderTop: number;
  readonly samples: readonly InLaneSample[];
}

/**
 * An obstacle standing in the rider's own lane, read at each of `aheads` —
 * #2396. A real view (`threeGameRenderer.create`) draws the stylised world's
 * frame with the rider steered into `lane` (`SceneInput.steeredLateral`, as a
 * round steers them), and a standing obstacle of `kind` placed in that lane by
 * the real `in-view.ts` §`deliveryInView`. The pixels the obstacle changes are
 * read against the same frame with no round in view, so the rider's body in
 * front of it is subtracted by the renderer itself, and the rider's own top is
 * read the same way against a frame with no rider. Each frame drawn twice and
 * the second read, so an upload is not what is counted.
 */
function inLane(
  kind: ObstacleKind,
  lane: number,
  aheads: readonly number[],
  clearShare: number,
  width: number,
  height: number,
): InLaneReading {
  const shown = canvas(width, height);
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(width, height);
  const gl = shown.getContext('webgl2');
  if (gl === null) throw new Error('the view has no WebGL2 context');
  const start = atStartLine(ROUTE);
  const frame = sceneFrame({
    profile: ROUTE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(RIDER) } },
    steeredLateral: lane,
  });
  const read = (drawnFrame: SceneFrame): Uint8Array => {
    view.render(drawnFrame);
    view.render(drawnFrame);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  /** Each changed pixel's row, counted from the BOTTOM as `readPixels` has them. */
  const changedRows = (a: Uint8Array, b: Uint8Array): number[] => {
    const rows: number[] = [];
    for (let at = 0; at < a.length; at += 4) {
      if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) {
        rows.push(Math.floor(at / 4 / width));
      }
    }
    return rows;
  };
  const noRound: DeliveryInView = { parcels: [], markers: [], obstacles: [] };
  const withRider = read({ ...frame, delivery: noRound });
  const riderless = {
    ...frame,
    markers: frame.markers.filter((marker) => marker.kind !== 'rider'),
  };
  const riderRows = changedRows(read({ ...riderless, delivery: noRound }), withRider);
  if (riderRows.length === 0) throw new Error('the frame drew no rider');
  const riderTopRow = Math.max(...riderRows);
  const clearRow = riderTopRow + clearShare * height;
  const samples = aheads.map((ahead): InLaneSample => {
    const obstacles: Obstacle[] = [{ kind, along: RIDER + ahead, stands: lane }];
    const delivery = deliveryInView({
      corridor: frame.corridor,
      targets: [],
      round: startRound(1),
      throws: NO_PARCELS,
      obstacles,
      obstacleState: startObstacles(obstacles),
    });
    const rows = changedRows(withRider, read({ ...frame, delivery }));
    return { ahead, drawn: rows.length, clear: rows.filter((row) => row >= clearRow).length };
  });
  view.destroy();
  return { riderTop: 1 - (riderTopRow + 1) / height, samples };
}

/** One place {@link pastParkedCar} read: the eye `eyeAhead` metres past the car's middle. */
export interface PastCarSample {
  readonly eyeAhead: number;
  /** Where the eye stood across the road, metres right of the centre line. */
  readonly eyeLateral: number;
  /** The share of the road under the rider — the middle third of the frame's bottom quarter — the car's pixels cover. */
  readonly underRiderCovered: number;
}

/**
 * #2396: a rider back in the right-hand lane just past a parked car at the
 * right-hand kerb, clear of it, while the chase camera 4.5 m behind is still
 * beside it — the frame the owner saw filled with car colour. Each of
 * `eyeAheads` puts the eye that far past the car's middle; the eye stands
 * where the real `camera-clear.ts` §`eyeLateralBesideParkedCars` puts it,
 * handed to the real `sceneFrame` as `GameView` hands it. The car's pixels
 * are read against the same frame with no round in view.
 */
function pastParkedCar(
  eyeAheads: readonly number[],
  width: number,
  height: number,
): readonly PastCarSample[] {
  const shown = canvas(width, height);
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(width, height);
  const gl = shown.getContext('webgl2');
  if (gl === null) throw new Error('the view has no WebGL2 context');
  const car: Obstacle[] = [{ kind: 'parked-car', along: RIDER, stands: parkedCarStands('right') }];
  const lane = 1.75;
  const start = atStartLine(ROUTE);
  const noRound: DeliveryInView = { parcels: [], markers: [], obstacles: [] };
  const bottomRows = Math.floor(height / 4);
  const read = (drawnFrame: SceneFrame): Uint8Array => {
    view.render(drawnFrame);
    view.render(drawnFrame);
    // `readPixels` rows run from the BOTTOM: the bottom quarter is the first rows.
    const pixels = new Uint8Array(width * bottomRows * 4);
    gl.readPixels(0, 0, width, bottomRows, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const samples = eyeAheads.map((eyeAhead): PastCarSample => {
    const riderAlong = RIDER + eyeAhead + CAMERA_BEHIND_RIDER_METRES;
    const eyeLateral = eyeLateralBesideParkedCars(car, riderAlong, lane);
    const frame = sceneFrame({
      profile: ROUTE,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(riderAlong) } },
      steeredLateral: lane,
      cameraLateral: eyeLateral,
    });
    const without = read({ ...frame, delivery: noRound });
    const withCar = read({
      ...frame,
      delivery: deliveryInView({
        corridor: frame.corridor,
        targets: [],
        round: startRound(1),
        throws: NO_PARCELS,
        obstacles: car,
        obstacleState: startObstacles(car),
      }),
    });
    // The middle third of the bottom quarter: the road under the rider.
    const fromColumn = Math.floor(width / 3);
    const toColumn = Math.ceil((2 * width) / 3);
    let covered = 0;
    for (let row = 0; row < bottomRows; row += 1) {
      for (let column = fromColumn; column < toColumn; column += 1) {
        const at = (row * width + column) * 4;
        if (
          without[at] !== withCar[at] ||
          without[at + 1] !== withCar[at + 1] ||
          without[at + 2] !== withCar[at + 2]
        ) {
          covered += 1;
        }
      }
    }
    return {
      eyeAhead,
      eyeLateral,
      underRiderCovered: covered / ((toColumn - fromColumn) * bottomRows),
    };
  });
  view.destroy();
  return samples;
}

/**
 * #2396's photograph for the owner: the rider steered into the right-hand
 * lane on the owner's 16 : 10 tablet, a bin standing in that lane `ahead`
 * metres up the road and a cone in the next lane 6 m beyond it.
 */
function inLaneShowcase(ahead: number): void {
  const shown = canvas(1280, 800);
  shown.id = 'delivery-in-lane';
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(1280, 800);
  const start = atStartLine(ROUTE);
  const frame = sceneFrame({
    profile: ROUTE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(RIDER) } },
    steeredLateral: 1.75,
  });
  const obstacles: Obstacle[] = [
    { kind: 'bin', along: RIDER + ahead, stands: 1.75 },
    { kind: 'cone', along: RIDER + ahead + 6, stands: 0 },
  ];
  view.render({
    ...frame,
    delivery: deliveryInView({
      corridor: frame.corridor,
      targets: [],
      round: startRound(1),
      throws: NO_PARCELS,
      obstacles,
      obstacleState: startObstacles(obstacles),
    }),
  });
}

/**
 * #2396's photograph of a parked car being passed: {@link pastParkedCar}'s
 * frame on the owner's tablet with the eye `eyeAhead` metres past the car's
 * middle, standing where `camera-clear.ts` puts it — or, with `behind`, where
 * it stood before #2396, behind the rider, for the owner to compare.
 */
function pastCarShowcase(eyeAhead: number, behind: boolean): void {
  const shown = canvas(1280, 800);
  shown.id = 'delivery-past-car';
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(1280, 800);
  const car: Obstacle[] = [{ kind: 'parked-car', along: RIDER, stands: parkedCarStands('right') }];
  const riderAlong = RIDER + eyeAhead + CAMERA_BEHIND_RIDER_METRES;
  const start = atStartLine(ROUTE);
  const frame = sceneFrame({
    profile: ROUTE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(riderAlong) } },
    steeredLateral: 1.75,
    cameraLateral: behind ? undefined : eyeLateralBesideParkedCars(car, riderAlong, 1.75),
  });
  view.render({
    ...frame,
    delivery: deliveryInView({
      corridor: frame.corridor,
      targets: [],
      round: startRound(1),
      throws: NO_PARCELS,
      obstacles: car,
      obstacleState: startObstacles(car),
    }),
  });
}

window.__oylDelivery = {
  ready: true,
  pastCarShowcase,
  carsShowcase,
  pullingOutShowcase,
  viewCalls,
  markerLeaves,
  probeCalls,
  kinds,
  pullingOut,
  showcase,
  inLane,
  inLaneShowcase,
  pastParkedCar,
};
