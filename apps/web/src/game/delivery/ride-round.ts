// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Delivery round inside a game ride — #1816, resting on the owner's rulings
 * DL2, DL5, DL6b and DL11 of 2026-10-27 (epic #1803), recorded as ADR 0059.
 *
 * `GameView` holds one {@link DeliveryRide} for a ride with Delivery on, and
 * this module is the whole of what it does with one: {@link startDeliveryRide}
 * at the press, {@link stepDeliveryRide} on every simulation step that ran,
 * and {@link endDeliveryRide} when the round is over or the ride ends. It
 * composes the round (`round.ts`), the target pick (`targets.ts`), the throw
 * (`throw.ts`), the obstacles (`obstacles.ts`) and the lane steering
 * (`steer.ts`, #1853); what each of those decides is still theirs.
 *
 * ## Nothing here reaches the trainer (DL5, ADR 0059 D-2)
 *
 * The rider's distance and speed come IN, from the simulation's own state;
 * nothing goes back. A delivery, a miss and a crash change the round and its
 * score and nothing else, and this module imports none of the simulation, the
 * gradient driver or a trainer port (`delivery-cannot-reach-trainer.test.ts`,
 * #1807). `delivery-wiring.test.tsx` rides the same power trace with and
 * without a round and holds the trainer's writes equal, which is the half of
 * DL5 no import walk can see.
 *
 * ## The steps that ran, and only those
 *
 * `obstacles.ts` warns that a rolling obstacle still crosses a rider whose
 * speed is nought, so a step the rider did not ride would cost a point for
 * not moving. {@link DeliveryRideStep.ticks} is the count `GameSimulation`
 * says it integrated on the frame (`SimulationTick.steps`): nought while the
 * simulation owed nothing, and the loop does not run while the ride is
 * paused, so a paused ride steps nothing. A frame that ran several steps
 * places the rider at each by sharing the frame's distance between them, so
 * an obstacle is swept at every step rather than at the frame's end.
 *
 * ## The rider steers, and the obstacles meet them where they are drawn
 *
 * A round runs on a solo ride only, so its rider can always steer (#1820,
 * DL9): its obstacles are placed with `steering` on, so some stand in a lane,
 * and {@link DeliveryRide.steer} starts in the lane nearest the racing line at
 * the press (`racing-line.ts` §`lineOffsetAt`, never the drawn
 * `PlacedRider.lateral`, which has made room for a bot or a ghost). `GameView`
 * turns it with `steer.ts` §`steerToward` for each lane key; every step that
 * ran steps it ({@link stepDeliveryRide}) BEFORE the obstacles, and hands them
 * its offset as the rider's lateral. The same offset is what `scene.ts`
 * §`lateralOf` draws the rider at, exactly, so a crash is drawn as one
 * (#1853). It is held in memory for the round, as the rest is, and never
 * stored: a stored ride has no lateral field.
 *
 * ## A house is missed when its window has closed behind the rider
 *
 * `throw.ts` §`THROW_WINDOW_AFTER_METRES` says where a house's window closes
 * (widened by the assist's {@link ASSISTED_THROW_SCALE}), and that is where a
 * house still expecting a parcel is counted missed — but not while a parcel
 * thrown to it from inside its window is still in the air, because that
 * parcel may yet land on the doorstep. Every parcel lands within
 * `PARCEL_FLIGHT_SECONDS`, so the wait is bounded.
 *
 * ## The round's score has the crashes in it
 *
 * `round.ts` §`RoundTally.score` counts deliveries only. The owner's ruling of
 * 2026-10-28 on #1811 takes a crash off the round's score, never below nought
 * at any moment, so {@link DeliveryRide.changes} keeps each delivery and each
 * crash in the order it happened — in a step, its landings and then its
 * crashes — and {@link DeliveryRide.score} is `obstacles.ts` §`roundScore` of
 * them. The week's score is `round.ts` §`endRound`'s, deliveries only, and a
 * crash never reaches it.
 *
 * ## When the round ends
 *
 * Once no house on the round is expecting a parcel the round is over, and
 * its outcome is settled then and held: the ride goes on, the parcels still in
 * the air and the obstacles still crossing are drawn, and nothing after it
 * scores. A ride that ends first ends its round there ({@link endDeliveryRide}),
 * counting only the houses the rider has passed (#1857, the owner's ruling of
 * 2026-10-29): one passed and not delivered is missed, and one not yet reached
 * is neither, so a mis-pressed *End ride* costs no more than the houses
 * already behind the rider.
 *
 * ## A house the town cannot draw is not on the round
 *
 * The round holds as many houses as `targets.ts` §`pickRoundTargets` found,
 * up to the week's count, so every house on it has a doorstep to throw at.
 * With none found there is no round, and the ride is an ordinary one: what a
 * rider is told then is #1818's, which offers Delivery to riders.
 *
 * ## Nothing here leaves the ride (DL11)
 *
 * The seed is drawn once at the press, handed to the pick and the
 * obstacles, and kept by nothing: a {@link DeliveryRide} carries no seed, and
 * its targets are round positions, distances and points held in memory for
 * the ride. Nothing here formats a position into a string.
 */

import type { RouteProfile } from '@onyourleft/domain';

import type { PreferenceStorage } from '../hud/announce-preference';
import type { MappedBuildings } from '../mapped-buildings';
import type { CorridorOrigin } from '../terrain';

import { readDeliveryAssist } from './assist-preference';
import { readDeliveryProgress, writeDeliveryProgress } from './delivery-progress';
import {
  placeObstacles,
  roundScore,
  startObstacles,
  stepObstacles,
  type Obstacle,
  type ObstacleState,
  type ScoreChange,
} from './obstacles';
import {
  endRound,
  recordMiss,
  roundTally,
  startRound,
  type Round,
  type RoundOutcome,
  type WeekProgress,
} from './round';
import { startSteer, stepSteer, type SteerState } from './steer';
import {
  drawRoundSeed,
  pickRoundTargets,
  TARGET_WINDOW_HALF_METRES,
  type DeliveryTarget,
} from './targets';
import {
  ASSISTED_THROW_SCALE,
  CARRIAGEWAY_HALF_WIDTH_METRES,
  DELIVERY_TICK_SECONDS,
  NO_PARCELS,
  stepThrows,
  THROW_WINDOW_AFTER_METRES,
  THROW_WINDOW_BEFORE_METRES,
  type ThrowSide,
  type ThrowState,
  type ThrowTarget,
} from './throw';

/** A Delivery round being ridden, in memory for the ride only. */
export interface DeliveryRide {
  /** The week the round is ridden in: its `day` is the round's day. */
  readonly week: WeekProgress;
  /** The round's houses as #1808 picked them, for the drawing. */
  readonly targets: readonly DeliveryTarget[];
  /** The same houses as the throw reads them. */
  readonly throwTargets: readonly ThrowTarget[];
  readonly round: Round;
  readonly throws: ThrowState;
  readonly obstacles: readonly Obstacle[];
  readonly obstacleState: ObstacleState;
  /** Every delivery and crash of the round, in the order it happened: a few dozen at most. */
  readonly changes: readonly ScoreChange[];
  /** The round's score with every crash in it, never below nought: `roundScore` of {@link changes}. */
  readonly score: number;
  /** The assist's wider windows (#1813), for the throw and for the misses. */
  readonly widerWindows: boolean;
  /** Where the rider has steered across the road (#1820), stepped on every step that ran. */
  readonly steer: SteerState;
  /** The rider's distance after the last step that ran, metres. */
  readonly along: number;
  /** The round's end, once every house is settled or the ride has ended it. */
  readonly outcome: RoundOutcome | undefined;
}

/** What a round needs at the press. */
export interface DeliveryRideStart {
  /** The ride's planned mapped buildings, indexed at the press. */
  readonly buildings: MappedBuildings;
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  /** The rider's odometer reading at the press, metres. */
  readonly riderDistance: number;
  /**
   * The racing line's offset at the press, metres right of the centre line
   * (`racing-line.ts` §`lineOffsetAt`): the steering starts from it.
   */
  readonly lineOffset: number;
  /**
   * The device's storage, for the week it has kept (`delivery-progress.ts`)
   * and the assist setting (`assist-preference.ts`), both read here so that
   * nothing outside Delivery's own modules reads the setting (#1813's test).
   */
  readonly storage: PreferenceStorage | undefined;
}

/**
 * Start the round the week asks for, at the press: its houses picked, its
 * obstacles placed, both from one seed drawn here and kept by nothing.
 * `undefined` when the town has no house the round could take.
 */
export function startDeliveryRide(input: DeliveryRideStart): DeliveryRide | undefined {
  const week = readDeliveryProgress(input.storage);
  const assist = readDeliveryAssist(input.storage);
  const seed = drawRoundSeed();
  const pick = pickRoundTargets(
    {
      buildings: input.buildings,
      profile: input.profile,
      origin: input.origin,
      riderDistance: input.riderDistance,
      houses: week.houses,
    },
    seed,
  );
  const last = pick.targets.at(-1);
  if (last === undefined) return undefined;
  const obstacles = placeObstacles(
    { from: input.riderDistance, to: last.distance + TARGET_WINDOW_HALF_METRES },
    seed,
    assist.obstacles,
    // A round runs solo only, so its rider can always steer (DL9).
    true,
  );
  return {
    week,
    targets: pick.targets,
    throwTargets: pick.targets.map((target): ThrowTarget => ({
      position: target.position,
      along: target.distance,
      side: target.side === 1 ? 'right' : 'left',
      clear: Math.max(0, target.fromRoad - CARRIAGEWAY_HALF_WIDTH_METRES),
    })),
    round: startRound(pick.targets.length, { assisted: assist.noFail }),
    throws: NO_PARCELS,
    obstacles,
    obstacleState: startObstacles(obstacles),
    changes: [],
    score: 0,
    widerWindows: assist.widerWindows,
    steer: startSteer(input.lineOffset),
    along: input.riderDistance,
    outcome: undefined,
  };
}

/** One frame's simulation steps, as the ride hands them over. */
export interface DeliveryRideStep {
  /** How many simulation steps ran on this frame: `SimulationTick.steps`. Nought steps nothing. */
  readonly ticks: number;
  /** The rider's distance after them, metres: the simulation's own odometer. */
  readonly along: number;
  /** The rider's speed after them, metres a second, which a parcel thrown now carries. */
  readonly speed: number;
  /** A throw the rider asked for since the last step, already resolved to a side. */
  readonly throwTo?: ThrowSide | undefined;
}

/** What one frame's steps did. */
export interface DeliveryRideStepped {
  readonly ride: DeliveryRide;
  /** Crashes counted on these steps; nought once the round is over. */
  readonly crashes: number;
  /** The throw asked for was taken: `false` when none was, or the cool-down refused it. */
  readonly thrown: boolean;
}

/** The throw left the rider inside the target's window: `throw.ts`' own test, restated. */
function inWindow(launchAlong: number, target: ThrowTarget, scale: number): boolean {
  return (
    launchAlong >= target.along - THROW_WINDOW_BEFORE_METRES &&
    launchAlong <= target.along + THROW_WINDOW_AFTER_METRES * scale
  );
}

/** Every house whose window has closed behind the rider with no parcel still able to reach it, missed. */
function recordMisses(
  round: Round,
  throws: ThrowState,
  targets: readonly ThrowTarget[],
  along: number,
  scale: number,
): Round {
  let settled = round;
  for (const target of targets) {
    if (settled.houses[target.position] !== 'expecting') continue;
    if (along <= target.along + THROW_WINDOW_AFTER_METRES * scale) continue;
    const coming = throws.inFlight.some(
      (parcel) => parcel.side === target.side && inWindow(parcel.launchAlong, target, scale),
    );
    if (!coming) settled = recordMiss(settled, target.position);
  }
  return settled;
}

/**
 * Run the frame's simulation steps through the round: the throw asked for,
 * the parcels, the misses, the steering and the obstacles, one tick of each a
 * step.
 * @see the header
 */
export function stepDeliveryRide(ride: DeliveryRide, step: DeliveryRideStep): DeliveryRideStepped {
  const { ticks } = step;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('a Delivery ride step runs a whole number of ticks, 0 or more');
  }
  if (ticks === 0) return { ride, crashes: 0, thrown: false };
  const scale = ride.widerWindows ? ASSISTED_THROW_SCALE : 1;
  const from = ride.along;
  // Never backwards: a room's correction does not run on a Delivery ride
  // (DL9), and a distance that went back would sweep no road.
  const to = Math.max(from, step.along);
  let { round, throws, obstacleState, outcome, steer } = ride;
  const changes = [...ride.changes];
  let crashes = 0;
  let thrown = false;
  let before = from;
  for (let tick = 1; tick <= ticks; tick += 1) {
    const at = from + ((to - from) * tick) / ticks;
    const thrownNow = stepThrows(throws, {
      rider: { along: before, speed: step.speed },
      targets: ride.throwTargets,
      round,
      ...(tick === 1 && step.throwTo !== undefined ? { throwTo: step.throwTo } : {}),
      widerWindows: ride.widerWindows,
    });
    thrown ||= thrownNow.thrown;
    throws = thrownNow.state;
    steer = stepSteer(steer, DELIVERY_TICK_SECONDS);
    const obstaclesNow = stepObstacles(obstacleState, {
      rider: { along: at, lateral: steer.offset, speed: (at - before) / DELIVERY_TICK_SECONDS },
      obstacles: ride.obstacles,
    });
    obstacleState = obstaclesNow.state;
    before = at;
    if (outcome !== undefined) continue;
    for (const landing of thrownNow.landings) {
      if (landing.kind === 'delivery') changes.push('delivery');
    }
    changes.push(...obstaclesNow.crashes);
    crashes += obstaclesNow.crashes.length;
    round = recordMisses(thrownNow.round, throws, ride.throwTargets, at, scale);
    if (roundTally(round).expecting === 0) outcome = endRound(ride.week, round);
  }
  return {
    ride: {
      ...ride,
      round,
      throws,
      obstacleState,
      changes,
      score: roundScore(changes),
      steer,
      along: to,
      outcome,
    },
    crashes,
    thrown,
  };
}

/**
 * The round's end: the one it reached, or the one a ride ending now gives it
 * (#1857). Then a house whose window has closed behind the rider and that was
 * not delivered is missed, though a parcel thrown to it is still in the air:
 * the ride is over, so it cannot land. A house the rider has not yet passed is
 * neither, and `round.ts` §`endRound` counts it for nothing.
 */
export function endDeliveryRide(ride: DeliveryRide): RoundOutcome {
  if (ride.outcome !== undefined) return ride.outcome;
  const scale = ride.widerWindows ? ASSISTED_THROW_SCALE : 1;
  return endRound(
    ride.week,
    recordMisses(ride.round, NO_PARCELS, ride.throwTargets, ride.along, scale),
  );
}

/**
 * Keep the week's counts for the next ride, from the round's end — counts
 * only (DL11, `delivery-progress.ts`). `false` when the device refused.
 */
export function keepDeliveryWeek(
  storage: PreferenceStorage | undefined,
  outcome: RoundOutcome,
): boolean {
  return writeDeliveryProgress(storage, outcome.next);
}
