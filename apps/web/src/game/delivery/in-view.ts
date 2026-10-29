// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a Delivery frame draws: the parcels in flight, a marker on each house
 * still on the round, and the obstacles, placed in the corridor's local
 * metres — #1814, resting on the owner's ruling DL6b of 2026-10-27 (epic
 * #1803), recorded as ADR 0059 D-3.
 *
 * `three-renderer.ts` §`DeliveryBelt` draws what this returns, read from
 * `port.ts` §`SceneFrame.delivery`, in at most three calls whatever the
 * count: one instanced call each for the parcels, the markers and the
 * obstacles. This module decides **where** each piece is and nothing about
 * how it looks.
 *
 * ## Only what the round still holds
 *
 * - **A marker stands on a house only while it is expecting a parcel**
 *   (`round.ts` §`HouseOutcome`): the frame after a delivery or a miss is
 *   recorded, its marker is gone. The renderer is handed nothing for it.
 * - **A parcel is drawn only while it is in flight** (`throw.ts`
 *   §`ThrowState.inFlight`): the step that lands it takes it out.
 * - **Every obstacle on the round is drawn**, waiting off its kerb until it
 *   is set going, then crossing, then off the far kerb (`obstacles.ts`
 *   §`obstacleAcross`).
 *
 * And only what stands on the frame's corridor: a piece whose distance along
 * the route is outside the corridor's span is not drawn, rather than drawn
 * clamped to the corridor's end.
 *
 * ## The route's frame, onto the drawn road
 *
 * The throw and the obstacles live in the route's frame: a distance along it
 * (the odometer) and an offset across it, positive to the rider's right
 * (`racing-line.ts` §`ROAD_SIDE`). Each is placed on the frame's own corridor
 * as `scene.ts` §`markerAt` places a rider: interpolated between its points by
 * `along`, never `distance` (#253), and moved across the road along its
 * normal, `(−headingZ, headingX)`, at the road's height, which is flat across
 * its width. A marker is placed where #1808's pick found the house's front
 * step, which is already in local metres.
 *
 * ⚠️ **The corridor is read here, not through `scene.ts`**: importing
 * `scene.ts` would run every module it imports, and Delivery's code may reach
 * nothing it does not need (ADR 0059 D-2, `delivery-cannot-reach-trainer.test.ts`).
 * The interpolation is `scene.ts` §`placeOnCorridor`'s, restated, and the
 * test holds it to the corridor's own points and the road's normal.
 *
 * ## The parcel's height, which the throw does not model
 *
 * `throw.ts` flies a parcel in two numbers, along and across, and lands it at
 * the end of {@link PARCEL_FLIGHT_SECONDS}. Its height is a drawing: from
 * {@link PARCEL_HAND_METRES} above the road at the throw, in a lob
 * {@link PARCEL_LOB_METRES} above the straight line, down to the road at the
 * flight's end. It decides nothing.
 *
 * `GameView` hands {@link deliveryInView}'s result to the view on
 * `SceneFrame.delivery` on every frame of a ride that runs a round (#1816);
 * the browser gate's `delivery-harness.ts` hands it one too. The frame's
 * types are `port.ts`', so the view itself reaches none of Delivery's modules.
 *
 * ## Nothing here leaves the ride
 *
 * Positions are held in memory for the frame (DL11), and nothing here formats
 * one into a string.
 */

import type { DeliveryInView, DeliveryObstaclePiece, DeliveryPiece } from '../port';
import type { CorridorPoint, RoadCorridor } from '../terrain';

import { obstacleAcross, type Obstacle, type ObstacleState } from './obstacles';
import type { Round } from './round';
import type { DeliveryTarget } from './targets';
import {
  DELIVERY_TICK_SECONDS,
  PARCEL_FLIGHT_SECONDS,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  type ThrowState,
} from './throw';

/**
 * How high above the road a parcel leaves the rider's hand, in metres: about
 * a rider's shoulder on a bicycle. This project's own number, a drawing only.
 */
export const PARCEL_HAND_METRES = 1.1;

/**
 * How far above the straight line from the hand to the landing the parcel's
 * lob rises at its middle, in metres. This project's own number, a drawing only.
 */
export const PARCEL_LOB_METRES = 0.8;

/** How many whole turns a parcel makes about the vertical in its flight. A drawing only. */
export const PARCEL_SPIN_TURNS = 1;

/** Everything a frame of a Delivery round knows. */
export interface DeliveryDrawInput {
  /** The frame's corridor: what the pieces are placed on. Only its centreline is read. */
  readonly corridor: Pick<RoadCorridor, 'centre'>;
  /** The round's houses, as #1808 picked them. */
  readonly targets: readonly DeliveryTarget[];
  /** The round as it stands: which houses still expect a parcel. */
  readonly round: Round;
  /** The parcels in flight, and the throw clock. */
  readonly throws: ThrowState;
  /** The round's obstacles, as #1811 placed them, and where each stands. */
  readonly obstacles: readonly Obstacle[];
  readonly obstacleState: ObstacleState;
  /**
   * How far the frame is past the last simulation step, in ticks: `0` to `1`.
   * The pieces move between ticks with it, so a parcel does not step at 20 Hz
   * on a 60 Hz screen; what lands where is still the tick's (`throw.ts`).
   * Nought unless given.
   */
  readonly sinceStep?: number;
}

/** A place on the corridor, and which way the road runs there. */
interface OnCorridor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingX: number;
  readonly headingZ: number;
}

/**
 * Where `along` falls on the corridor, between its points, and the road's
 * heading there: `scene.ts` §`placeOnCorridor` and §`headingAt`. `undefined`
 * outside the corridor's span, or on a corridor with no length.
 */
function onCorridor(centre: readonly CorridorPoint[], along: number): OnCorridor | undefined {
  const last = centre.length - 1;
  if (last <= 0 || !Number.isFinite(along)) return undefined;
  const first = centre[0] as CorridorPoint;
  if (along < first.along || along > (centre[last] as CorridorPoint).along) return undefined;
  // The last point at or before `along`, never the last index.
  let low = 0;
  let high = last - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((centre[middle] as CorridorPoint).along > along) high = middle - 1;
    else low = middle;
  }
  const from = centre[low] as CorridorPoint;
  const to = centre[low + 1] as CorridorPoint;
  const span = to.along - from.along;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (along - from.along) / span)) : 0;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  return {
    x: from.x + dx * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + dz * fraction,
    headingX: length > 0 ? dx / length : 0,
    headingZ: length > 0 ? dz / length : 1,
  };
}

/** `at` moved `across` metres to the rider's right, at `up` above the road, facing `turn` from the road's heading. */
function placed(at: OnCorridor, across: number, up: number, turn: number): DeliveryPiece {
  return {
    x: at.x - at.headingZ * across,
    y: at.y + up,
    z: at.z + at.headingX * across,
    yaw: Math.atan2(at.headingX, at.headingZ) + turn,
  };
}

/** The pieces a Delivery frame draws, as `port.ts` §`SceneFrame.delivery` carries them. @see the header */
export function deliveryInView(input: DeliveryDrawInput): DeliveryInView {
  const { centre } = input.corridor;
  const sinceStep = Math.min(1, Math.max(0, input.sinceStep ?? 0));

  const markers: DeliveryPiece[] = [];
  for (const target of input.targets) {
    if (input.round.houses[target.position] !== 'expecting') continue;
    if (onCorridor(centre, target.distance) === undefined) continue;
    markers.push({ x: target.x, y: target.y, z: target.z, yaw: target.yaw });
  }

  const parcels: DeliveryPiece[] = [];
  const flight = PARCEL_FLIGHT_SECONDS;
  for (const parcel of input.throws.inFlight) {
    const seconds = Math.min(
      flight,
      (input.throws.tick - parcel.launchTick + sinceStep) * DELIVERY_TICK_SECONDS,
    );
    const at = onCorridor(centre, parcel.launchAlong + parcel.speed * seconds);
    if (at === undefined) continue;
    const share = seconds / flight;
    const across = PARCEL_THROW_SPEED_METRES_PER_SECOND * seconds;
    const up = PARCEL_HAND_METRES * (1 - share) + 4 * PARCEL_LOB_METRES * share * (1 - share);
    parcels.push(
      placed(
        at,
        parcel.side === 'right' ? across : -across,
        up,
        2 * Math.PI * PARCEL_SPIN_TURNS * share,
      ),
    );
  }

  const obstacles: DeliveryObstaclePiece[] = [];
  const { obstacleState } = input;
  input.obstacles.forEach((obstacle, index) => {
    const at = onCorridor(centre, obstacle.along);
    if (at === undefined) return;
    const started = obstacleState.startedAt[index];
    const seconds =
      started === undefined
        ? 0
        : (obstacleState.tick - started + sinceStep) * DELIVERY_TICK_SECONDS;
    obstacles.push({ ...placed(at, obstacleAcross(obstacle, seconds), 0, 0), kind: obstacle.kind });
  });

  return { parcels, markers, obstacles };
}
