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
 * 5. **`showcase()`** — a real view's frame with a parcel in flight, a house's
 *    marker and one obstacle of each kind, on a canvas the spec photographs
 *    for the owner (the lane's ruling of 2026-10-28).
 */

import { metres } from '@onyourleft/domain';

import { deliveryInView } from '../src/game/delivery/in-view';
import { startObstacles, type Obstacle, type ObstacleKind } from '../src/game/delivery/obstacles';
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
      kinds(world: 'stylised' | 'realistic'): Readonly<Record<ObstacleKind, readonly boolean[]>>;
      showcase(): void;
    };
  }
}

const counter = drawCounter(WebGL2RenderingContext.prototype);

const ROSTER: readonly ObstacleKind[] = ['bin', 'trolley', 'cone'];

/**
 * The points `deliveryKindProbe` reads, the obstacle's own metres, `x` across
 * and `y` up: inside the bin's body above the cone's tip; low on the middle,
 * inside the bin and the cone but between the trolley's uprights; on the
 * trolley's right upright, inside the bin, wide of the cone.
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
      kind: ROSTER[index % ROSTER.length] as ObstacleKind,
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

function kinds(world: 'stylised' | 'realistic'): Record<ObstacleKind, readonly boolean[]> {
  const read = (kind: ObstacleKind): readonly boolean[] =>
    deliveryKindProbe(canvas(256, 256), world, kind, KIND_POINTS);
  return { bin: read('bin'), trolley: read('trolley'), cone: read('cone') };
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
      kind: ROSTER[index % ROSTER.length] as ObstacleKind,
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
  const obstacles: Obstacle[] = ROSTER.map((kind, index) => ({
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

window.__oylDelivery = {
  ready: true,
  viewCalls,
  markerLeaves,
  probeCalls,
  kinds,
  showcase,
};
