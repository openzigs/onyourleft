// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a lane change is DRAWN — #2456: the bicycle turns into the move, the
 * bicycle and rider lean the way they are going, and both straighten up on
 * arrival. Until #2456 a steered rider (Delivery's lanes, #1820; the lap
 * race's, #1901) was translated across the road facing straight down it and
 * bolt upright, which the owner saw on the tablet as a slide.
 *
 * ## The sway: one damped number, held by the frame loop
 *
 * `lanes.ts` §`stepSteer` moves the rider at a steady
 * {@link SIDEWAYS_METRES_PER_SECOND} from the first step of a move to the last,
 * so the sideways speed it implies (`lanes.ts` §`sidewaysSpeedOf`) jumps from
 * nought to 4.375 m/s and back. Drawn from that, the turn and the lean would
 * snap. {@link dampedSway} follows it at a bounded sideways ACCELERATION
 * instead, by the wall clock between drawn frames, as `camera.ts`
 * §`dampedHeading` turns the camera — so no frame rate changes the look, and a
 * second press mid-move, or one back the other way, is followed without a step.
 * `GameView` holds it beside the camera's heading and hands it to the scene as
 * `SceneInput.steeredSway`.
 *
 * ## What the sway draws
 *
 * - {@link laneChangeRate}: how fast the drawn place moves across the road per
 *   metre ridden, which `scene.ts` §`markerAt` turns the bicycle toward
 *   through the same `facingTurn` (#1995's 12° cap) a change of line uses.
 * - {@link laneChangeLean}: a lean toward the move, added to the bend's own
 *   (`racing-line.ts` §`leanAt`) before `bicycle.ts` §`bicycleRoll` splits it
 *   between the bicycle and the body, as #546 splits a bend's.
 *
 * ## Bounded, per frame
 *
 * The sway changes by at most {@link SWAY_ACCELERATION} a second. The lean is
 * the sway's share of the full sideways speed times a cap, so it rolls at no
 * more than `LANE_CHANGE_LEAN_LIMIT_RADIANS × SWAY_ACCELERATION ÷
 * SIDEWAYS_METRES_PER_SECOND` = 50°/s, inside `racing-line.ts`
 * §`MAXIMUM_ROLL_RADIANS_PER_SECOND`'s 60°/s. The turn is the sway over at
 * least {@link LANE_CHANGE_TURN_SPEED_FLOOR}, so it turns at no more than
 * `SWAY_ACCELERATION ÷ 10 m/s` ≈ 2.2 rad/s before the 12° cap, which is under
 * 2.1° a frame at 60 fps.
 *
 * ## A drawing, never physics
 *
 * Nothing here is read by `simulation.ts`, the obstacles or the race: the
 * rider is still drawn exactly at `SceneInput.steeredLateral`, the offset the
 * obstacles and the race's items meet. Only the attitude changes.
 */

import { STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED } from '@onyourleft/physics';
import { LANE_CHANGE_SECONDS, SIDEWAYS_METRES_PER_SECOND } from './lanes';

/**
 * How long the drawn sway takes to build to the full sideways speed, or to
 * fall back from it: half a lane change, **0.2 s**. A judgement: long enough
 * that the turn and the lean roll in rather than snap, short enough that a
 * single move is drawn turning and leaning for most of its 0.4 s.
 */
export const SWAY_SETTLE_SECONDS = LANE_CHANGE_SECONDS / 2;

/** The most the drawn sway changes in a second, in metres a second: 21.9 m/s². */
export const SWAY_ACCELERATION = SIDEWAYS_METRES_PER_SECOND / SWAY_SETTLE_SECONDS;

/**
 * The most a lane change leans the rider and bicycle together: **10°**. The
 * physics of a 1.75 m move in 0.4 s asks for far more at any racing speed (an
 * S of two arcs of radius `L²/4d` leans `atan(4d / gT²)` ≈ 77° whatever the
 * speed), because the game's lane change is quicker than a real one. 10° reads
 * from the chase camera as a lean, and keeps the roll rate under
 * `racing-line.ts` §`MAXIMUM_ROLL_RADIANS_PER_SECOND`.
 */
export const LANE_CHANGE_LEAN_LIMIT_RADIANS = (10 * Math.PI) / 180;

/**
 * The turn rate a lane change is taken to ask for, in radians a second: one —
 * about #1995's 12° cap reached in the {@link SWAY_SETTLE_SECONDS}. A slow
 * rider's lean is the lean that turn holds at their speed, `atan(v·ω / g)`,
 * so a rider at a walking pace barely leans and a stopped one not at all.
 */
const LANE_CHANGE_TURN_RADIANS_PER_SECOND = 1;

/**
 * The slowest speed the turn into a lane change is taken at, in metres a
 * second: **10** (36 km/h). Below it, the drawn turn is what a rider at 10 m/s
 * would make, so a slow rider does not swing round faster than a quick one;
 * #1995's 12° cap holds above it.
 */
export const LANE_CHANGE_TURN_SPEED_FLOOR = 10;

/**
 * The drawn sway `seconds` after `held`, moved toward `wanted` (`lanes.ts`
 * §`sidewaysSpeedOf`) by at most {@link SWAY_ACCELERATION} a second, and never
 * past it. A time that is not a finite number of seconds above nought moves
 * nothing: the first frame of a ride, or a clock that went backwards.
 */
export function dampedSway(held: number, wanted: number, seconds: number): number {
  const time = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const most = SWAY_ACCELERATION * time;
  const gap = wanted - held;
  return Math.abs(gap) <= most ? wanted : held + Math.sign(gap) * most;
}

/**
 * Metres across the road per metre ridden that a sway of `sway` metres a
 * second draws, at `speed` — the rate `scene.ts` §`Across.rate` carries, in
 * its sign: positive to the rider's right. Taken at no less than
 * {@link LANE_CHANGE_TURN_SPEED_FLOOR}.
 */
export function laneChangeRate(sway: number, speed: number): number {
  return sway / Math.max(speed, LANE_CHANGE_TURN_SPEED_FLOOR);
}

/**
 * The combined lean, in radians, a sway of `sway` metres a second draws at
 * `speed` — positive to the rider's right, `port.ts` §`RiderMarker.lean`'s
 * sign: the sway's share of the full sideways speed times the lesser of
 * {@link LANE_CHANGE_LEAN_LIMIT_RADIANS} and the lean a one-radian-a-second
 * turn holds at that speed. Nought at a standstill and once the sway is spent.
 */
export function laneChangeLean(sway: number, speed: number): number {
  if (!(speed > 0) || sway === 0) return 0;
  const share = Math.max(-1, Math.min(1, sway / SIDEWAYS_METRES_PER_SECOND));
  const held = Math.atan(
    (speed * LANE_CHANGE_TURN_RADIANS_PER_SECOND) / STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED,
  );
  return share * Math.min(LANE_CHANGE_LEAN_LIMIT_RADIANS, held);
}
