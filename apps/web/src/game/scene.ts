// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning a simulated ride into a frame the renderer can draw.
 *
 * Pure, and deliberately so: this is where the rider, the bot (#92) and the
 * ghost (#93) are placed on the road, and every one of those placements is
 * arithmetic that jsdom can check. What is left for `three-renderer.ts` is only
 * turning the result into pixels.
 *
 * ⚠️ **The three markers are placed here and told apart in the renderer.** This
 * file decides *where* each is; `three-renderer.ts` decides what each looks
 * like, and gives each a different shape as well as a different colour. #93's
 * third criterion — that a rider glancing at a bar-mounted phone can tell them
 * apart instantly — needs both halves, and splitting them this way means neither
 * can be satisfied by accident.
 */

import { ghostDistanceAt, ghostHasFinished, type GhostTrack, seconds } from '@onyourleft/domain';

import type { CameraPose, RiderMarker, SceneFrame } from './port';
import type { GameState } from './simulation';
import {
  roadCorridor,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import type { RouteProfile } from '@onyourleft/domain';

/** Everything a frame needs beyond the rider's own state. */
export interface SceneInput {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly state: GameState;
  /** The bot's odometer, from `@onyourleft/physics`'s `advanceBot`. Optional. */
  readonly botDistance?: number | undefined;
  /** The rider's own previous attempt, when they chose to race one. Optional. */
  readonly ghost?: GhostTrack | undefined;
}

/** Builds one frame. */
export function sceneFrame(input: SceneInput): SceneFrame {
  const riderDistance: number = input.state.ride.distance;
  const corridor = roadCorridor(input.profile, input.origin, riderDistance);
  return {
    corridor,
    camera: cameraPose(corridor, riderDistance),
    markers: markers(corridor, input, riderDistance),
  };
}

/**
 * Where the chase camera looks from.
 *
 * The heading is taken from the corridor's own centreline rather than from a
 * stored bearing, so the camera and the road cannot disagree: if the corridor
 * turns, the camera turns with it by construction. A separately-computed bearing
 * is the kind of second source of truth that drifts by a frame and reads as the
 * camera lagging the corner.
 */
export function cameraPose(corridor: RoadCorridor, atDistance: number): CameraPose {
  const here = nearestPoint(corridor, atDistance);
  const ahead = corridor.centre[Math.min(corridor.centre.length - 1, here.index + 1)];
  const from = here.point;
  const dx = (ahead?.x ?? from.x + 1) - from.x;
  const dz = (ahead?.z ?? from.z) - from.z;
  const length = Math.hypot(dx, dz);
  // A stationary rider at the very end of a point-to-point route has no next
  // point, so the heading would be (0, 0) and the camera would look at itself.
  // Facing north is arbitrary and is better than a degenerate look-at, which
  // three resolves to NaN and renders as a black screen.
  const headingX = length > 0 ? dx / length : 0;
  const headingZ = length > 0 ? dz / length : 1;
  return { x: from.x, y: from.y, z: from.z, headingX, headingZ };
}

/** The rider, and whichever of the bot and the ghost are in play. */
function markers(
  corridor: RoadCorridor,
  input: SceneInput,
  riderDistance: number,
): readonly RiderMarker[] {
  const found: RiderMarker[] = [markerAt(corridor, riderDistance, 'rider')];
  if (input.botDistance !== undefined) {
    found.push(markerAt(corridor, input.botDistance, 'bot'));
  }
  if (input.ghost !== undefined) {
    found.push(markerAt(corridor, ghostDistanceNow(input.ghost, input.state), 'ghost'));
  }
  return found;
}

/**
 * A marker on the road at a distance.
 *
 * ⚠️ Clamped to the corridor rather than extrapolated. A bot or ghost far enough
 * ahead to be outside the built corridor is drawn at its far end rather than
 * floating in space beyond it — the rider learns "it is somewhere up there",
 * which is true, and the exact gap is the HUD's job (#94) and is a number rather
 * than a position. On a loop that includes a bot a whole lap up: it is drawn at
 * the far end of what the rider can see, and the HUD says how far.
 *
 * ⚠️ `atDistance` is an **odometer** — how far that rider has ridden in total,
 * which is what every producer here hands over: `GameState.ride.distance`,
 * `BotTick.state.distance` and `ghostDistanceAt` are all unwrapped. See
 * {@link nearestPoint} for what that means for the search.
 */
function markerAt(
  corridor: RoadCorridor,
  atDistance: number,
  kind: RiderMarker['kind'],
): RiderMarker {
  const { point } = nearestPoint(corridor, atDistance);
  return { kind, x: point.x, y: point.y, z: point.z };
}

/**
 * The corridor point closest to an odometer reading, and its index.
 *
 * ⚠️ **Searched on `CorridorPoint.along`, never on `CorridorPoint.distance`,
 * and #253 is what happens when it is the other way round.** `along` is how far
 * into the *ride* a point is and is unwrapped; `distance` is where the point is
 * on the *road* and is wrapped into `[0, totalDistance)` by `distanceOnRoute`.
 * Every odometer handed to this function is unwrapped — deliberately, because
 * `pacer/gap.ts` needs a bot a lap ahead to read as a lap ahead rather than as
 * level. So on a `loop: true` route, from the moment either odometer passes
 * `totalDistance`, every point's `distance` is smaller than the value being
 * searched for, the search saturates at the corridor's far end, and the rider
 * and the bot are drawn at one point for the rest of the ride. Two riders, one
 * place, with both halves of the program behaving exactly as documented.
 */
function nearestPoint(
  corridor: RoadCorridor,
  atDistance: number,
): { readonly point: CorridorPoint; readonly index: number } {
  let bestIndex = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corridor.centre.length; index += 1) {
    const candidate = corridor.centre[index] as CorridorPoint;
    const gap = Math.abs(candidate.along - atDistance);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  }
  return { point: corridor.centre[bestIndex] as CorridorPoint, index: bestIndex };
}

/**
 * How far the ghost had ridden at this moment of the ride.
 *
 * ⚠️ The ghost is placed at where it had ridden **at this elapsed time**, which
 * is what makes it a race rather than a replay running beside you. After it
 * finishes it stays at its finishing distance rather than disappearing — a
 * rider who beat it wants to see it behind them.
 *
 * Exported because the HUD needs the same number the marker is placed from: the
 * gap a rider reads and the shape they see on the road must not be two answers
 * to one question, which is the argument `GameState.bot` already makes for the
 * bot's odometer. The clamp on a negative elapsed time is part of it — two
 * callers clamping separately is two chances to stop.
 */
export function ghostDistanceNow(ghost: GhostTrack, state: GameState): number {
  return ghostDistanceAt(ghost, seconds(Math.max(0, state.elapsed)));
}

/** Whether the ghost has already finished, for a HUD that wants to say so. */
export function ghostFinished(ghost: GhostTrack, state: GameState): boolean {
  return ghostHasFinished(ghost, seconds(Math.max(0, state.elapsed)));
}
