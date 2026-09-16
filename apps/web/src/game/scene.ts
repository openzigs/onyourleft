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

import { ghostDistanceAt, ghostHasFinished, type GhostTrack } from '@onyourleft/domain';

import type { CameraPose, RiderMarker, SceneFrame } from './port';
import { SCATTER_MAX_ITEMS, scatterAt, scatterSeed, type ScatterItem } from './scatter';
import { ghostClock, type GameState } from './simulation';
import {
  roadCorridor,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import { worldStyle } from './world';
import type { RouteProfile } from '@onyourleft/domain';

/** Everything a frame needs beyond the rider's own state. */
export interface SceneInput {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly state: GameState;
  /**
   * Where to draw the rider this frame, if not where the last step left them.
   *
   * ⚠️ **The whole of #323's seam on this side, and it is optional for one
   * reason only**: `atStartLine` and the browser harness build frames from a
   * state with no simulation behind it at all, and there is nothing for them
   * to interpolate. The ride screen supplies it on every frame, from
   * `GameSimulation.drawnAt`, and `GameView.test.tsx` fails if it stops —
   * `check-wiring.mjs` §Limits is explicit that an optional field nobody
   * supplies is a hole this repository's gates cannot see, so the guard is a
   * test that reads what the renderer was handed.
   *
   * Absent means "where the newest completed step left them", which is what
   * every frame drew before #323 and is what made the world step.
   */
  readonly riderDistance?: number | undefined;
  /**
   * Where to draw the bot — its odometer, from `@onyourleft/physics`'s
   * `advanceBot`, or a blend of its last two (#323). Optional; absent means
   * there is no bot.
   */
  readonly botDistance?: number | undefined;
  /** The rider's own previous attempt, when they chose to race one. Optional. */
  readonly ghost?: GhostTrack | undefined;
}

/** Builds one frame. */
export function sceneFrame(input: SceneInput): SceneFrame {
  const riderDistance: number = input.riderDistance ?? input.state.ride.distance;
  const corridor = roadCorridor(input.profile, input.origin, riderDistance);
  return {
    corridor,
    camera: cameraPose(corridor, riderDistance),
    markers: markers(corridor, input, riderDistance),
    // Recomputed per frame rather than cached against the profile: it is two
    // bounded passes over at most `WORLD_SAMPLE_LIMIT` samples, and a cache
    // keyed on a profile is a second source of truth that a route change has
    // to remember to clear. `world.ts` says what the bound buys.
    world: worldStyle(input.profile),
    scatter: scatter(corridor, input, riderDistance),
  };
}

/**
 * The scenery for exactly the stretch of road this frame drew.
 *
 * ⚠️ **The span comes from the corridor rather than from `VIEW_AHEAD_METRES` and
 * `VIEW_BEHIND_METRES`.** Reading the two constants here would be a second
 * statement of how far the rider can see, and the day either moves — or the day
 * a caller passes `roadCorridor` an override, which its options already allow —
 * the scenery would stop where the road no longer does. Taking the first and
 * last centreline point's own `along` cannot drift, because it *is* what was
 * built.
 */
function scatter(
  corridor: RoadCorridor,
  input: SceneInput,
  riderDistance: number,
): readonly ScatterItem[] {
  const first = corridor.centre[0] as CorridorPoint;
  const last = corridor.centre[corridor.centre.length - 1] as CorridorPoint;
  return scatterAt(
    input.profile,
    input.origin,
    // O(1), and recomputed per frame for the reason `worldStyle` is: a cache
    // keyed on a profile is a second source of truth a route change has to
    // remember to clear.
    scatterSeed(input.profile),
    first.along,
    last.along,
    { maxItems: SCATTER_MAX_ITEMS, riderMetres: riderDistance },
  );
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
  const here = placeOnCorridor(corridor, atDistance);
  const from = corridor.centre[here.index] as CorridorPoint;
  const ahead = corridor.centre[Math.min(corridor.centre.length - 1, here.index + 1)];
  // ⚠️ The heading is taken between the two corridor POINTS either side rather
  // than from `here` to the next one, and that is not a simplification: a
  // camera sitting exactly on `ahead` would have a zero-length direction and
  // fall through to the arbitrary north below, which is a camera that snaps
  // sideways once per corridor point.
  const dx = (ahead?.x ?? from.x + 1) - from.x;
  const dz = (ahead?.z ?? from.z) - from.z;
  const length = Math.hypot(dx, dz);
  // A stationary rider at the very end of a point-to-point route has no next
  // point, so the heading would be (0, 0) and the camera would look at itself.
  // Facing north is arbitrary and is better than a degenerate look-at, which
  // three resolves to NaN and renders as a black screen.
  const headingX = length > 0 ? dx / length : 0;
  const headingZ = length > 0 ? dz / length : 1;
  return { x: here.x, y: here.y, z: here.z, headingX, headingZ };
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
    // ⚠️ The ghost is placed at where it had ridden **at this point in the
    // race**, which is what makes it a race rather than a replay running beside
    // you. After it finishes it stays at its finishing distance rather than
    // disappearing — a rider who beat it wants to see it behind them.
    //
    // ⚠️ **`ghostClock`, never `state.elapsed` — #254.** The two differ by
    // exactly the time a backgrounded phone stalled for, and reading the wall
    // clock here handed the ghost five minutes of road while the rider and the
    // bot covered ten seconds of it. `simulation.ts` §`ghostClock` states the
    // rule beside the bound that creates the difference.
    const at = ghostDistanceAt(input.ghost, ghostClock(input.state));
    found.push(markerAt(corridor, at, 'ghost'));
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
 * than a position.
 */
function markerAt(
  corridor: RoadCorridor,
  atDistance: number,
  kind: RiderMarker['kind'],
): RiderMarker {
  const at = placeOnCorridor(corridor, atDistance);
  return { kind, x: at.x, y: at.y, z: at.z };
}

/** A position on the corridor, and the centreline point it follows. */
interface CorridorPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * The index of the point at or before it, for a caller that needs the road's
   * direction there. Never the last index, so `index + 1` is always a point.
   */
  readonly index: number;
}

/**
 * Where an odometer reading falls on the corridor, **between** its points.
 *
 * ⚠️ **Matched on `CorridorPoint.along`, which is unwrapped, and never on
 * `CorridorPoint.distance`, which is not — #253.** Every distance that reaches
 * this file is an odometer: the rider's from the simulation, the bot's from
 * `advanceBot`, the ghost's from a replay of recorded distance. `distance`
 * wraps into `[0, totalDistance]`, so on a loop every corridor point compared
 * smaller than an odometer past the wrap and the search returned the far end
 * for **every** rider — the bot and the rider drawn at one point from lap two
 * onward, which is the case the pacer exists for.
 *
 * The fix is on this side deliberately. Wrapping the odometer instead would
 * place the markers correctly and break the HUD gap in the same motion, because
 * `pacer/gap.ts` is right that a bot a lap ahead must read as a lap ahead.
 *
 * ⚠️ **It interpolates, where until #323 it returned the NEAREST point.** The
 * corridor samples the road about every ten metres, so a nearest-point lookup
 * quantised every marker to that grid: a bot that gained two metres gained
 * nothing on screen, and then jumped ten. The rider's own marker hid it — the
 * corridor is built *from* the rider's distance, so a point lands on the rider
 * by construction — and that is exactly why the bot and the ghost were the
 * riders that stepped. It is also what would have thrown away #323's other
 * half: a distance interpolated between two simulation steps is a centimetre
 * at a time, and the next function down was rounding it to ten metres.
 *
 * Clamped rather than extrapolated at both ends, which is what
 * {@link markerAt} promises and what keeps a bot far up the road on the road.
 */
function placeOnCorridor(corridor: RoadCorridor, atDistance: number): CorridorPlacement {
  const centre = corridor.centre;
  const last = centre.length - 1;
  if (last <= 0) {
    // A one-point corridor has nothing to interpolate along. `cameraPose`'s own
    // degenerate-heading case, and it must not divide by a zero span.
    const only = centre[0] as CorridorPoint;
    return { x: only.x, y: only.y, z: only.z, index: 0 };
  }
  let index = 0;
  for (let candidate = 0; candidate < last; candidate += 1) {
    if ((centre[candidate] as CorridorPoint).along > atDistance) {
      break;
    }
    index = candidate;
  }
  const from = centre[index] as CorridorPoint;
  const to = centre[index + 1] as CorridorPoint;
  const span = to.along - from.along;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (atDistance - from.along) / span)) : 0;
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + (to.z - from.z) * fraction,
    index,
  };
}

/**
 * Whether the ghost has already finished, for a HUD that wants to say so.
 *
 * ⚠️ Against {@link ghostClock} like every other ghost question (#254), so a
 * stalled ride cannot declare the attempt finished while its marker is still
 * halfway up the road.
 *
 * Its consumer is `game/ghost-outcome.ts`, and it did not have one until #259:
 * this function was exported, unit-tested and green while the HUD went on
 * quoting a gap against an attempt that had stopped. That header says why the
 * answer is latched there rather than read afresh here.
 */
export function ghostFinished(ghost: GhostTrack, state: GameState): boolean {
  return ghostHasFinished(ghost, ghostClock(state));
}
