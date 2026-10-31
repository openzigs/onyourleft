// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Steering between lanes in a Delivery round, from keys and from bar-mounted
 * buttons that send them — #1820, resting on the owner's rulings DL5 and DL12
 * of 2026-10-27 (epic #1803).
 *
 * ## Delivery's lanes are the game's lanes (#1901)
 *
 * The lanes, the keys, the steer state and its steady move between lanes are
 * `../lanes.ts`', lifted out of this file by #1901 so the lap race steers with
 * the same ones. This module re-exports every one of them, so what Delivery
 * reads is unchanged, and its tests read it here. The scheme, its numbers and
 * why each was chosen are in `lanes.ts`' header.
 *
 * ## A drawing, never physics
 *
 * What steering moves is where the rider is **drawn** across the road
 * (`scene.ts` §`lateralOf`, through `SceneInput.steeredLateral`) and so which
 * obstacles they meet (`obstacles.ts` §`stepObstacles` reads the rider's
 * lateral offset). It never moves how far they rode or what the trainer is
 * sent: nothing here is read by `simulation.ts`, whose state carries no
 * lateral field, and `steer.test.ts` rides one power trace with and without
 * presses and reads every tick's distance and speed back equal.
 *
 * ## Solo only
 *
 * A lateral position a room holds would be a new `physicsVersion` under ADR
 * 0038 D-3.4 (DL9), so a room ride ignores steering: `steeredLateralFor`
 * hands the scene nothing while the ride is in a room, and the rider rides
 * the line.
 *
 * ## Delivery's own two refusals
 *
 * {@link startSteer} and {@link stepSteer} are `lanes.ts`' own with
 * Delivery's two refusals in front of them, so that an error a round raises
 * says it is Delivery's, and #1817's
 * `privacy/delivery-targets-never-sent.test.ts`, which counts the throw sites
 * in every Delivery module against its cases, still finds them here. An input
 * neither refuses passes `lanes.ts`' own check too, so the shared module
 * never refuses on a round's path.
 *
 * ⚠️ **It imports only `lanes.ts`, which imports nothing**: the HUD imports
 * the keys, and `obstacles.ts` the lanes, and neither should bring anything
 * else onto the path DL5's walk (`delivery-cannot-reach-trainer.test.ts`)
 * checks.
 *
 * ## Nothing here leaves the ride
 *
 * The steer state is held in memory for the round and never stored: the
 * stored ride has no lateral field. No error message here formats an offset
 * or a duration (CLAUDE.md §6, ADR 0004 D): each names the field and the
 * constraint.
 */

import {
  startSteer as startLaneSteer,
  stepSteer as stepLaneSteer,
  type SteerState,
} from '../lanes';

export {
  LANE_CHANGE_SECONDS,
  LANE_OFFSETS_METRES,
  STEER_CODES,
  STEER_INTENTS,
  STEER_KEYS,
  steeredLateralFor,
  steerIntentOfKey,
  steerToward,
} from '../lanes';
export type { SteerIntent, SteerKeyEvent, SteerState } from '../lanes';

function refuse(constraint: string): never {
  throw new RangeError(`Delivery steering: ${constraint}`);
}

/**
 * Steering from where the rider is drawn when the round starts, `offset`
 * metres right of the centre line: `lanes.ts` §`startSteer`, in the nearest
 * lane. `ride-round.ts` §`startDeliveryRide` calls it at the press, with the
 * racing line's offset at the rider's distance (#1853).
 */
export function startSteer(offset: number): SteerState {
  if (!Number.isFinite(offset)) refuse('the starting offset is a finite number of metres');
  return startLaneSteer(offset);
}

/**
 * The state `seconds` later: `lanes.ts` §`stepSteer`. `ride-round.ts`
 * §`stepDeliveryRide` steps it on every simulation step that ran, before it
 * steps the obstacles with the offset (#1853).
 */
export function stepSteer(state: SteerState, seconds: number): SteerState {
  if (!Number.isFinite(seconds) || seconds < 0) {
    refuse('a step is a finite number of seconds not below zero');
  }
  return stepLaneSteer(state, seconds);
}
