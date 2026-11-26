// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which of Delivery's game sounds one frame's steps call for — #3012. The
 * owner on the tablet, 2026-11-21: *"I don't hear any sounds effects in the
 * game at all."*
 *
 * Pure: it reads the round before and after the frame's steps
 * (`ride-round.ts` §`stepDeliveryRide`) and names the sounds, in the order
 * they happened within the frame as near as one frame can tell. `GameView`
 * plays each through `game-effects.ts` on the **effects** bus. Nothing here
 * plays anything, and nothing here reaches the simulation, the grade or the
 * trainer (ADR 0059 D-2.1, `delivery-cannot-reach-trainer.test.ts`).
 *
 * ## Nothing carried by sound alone
 *
 * Every sound here has its equivalent on the screen or in words already
 * (the Game Accessibility Guidelines, epic #2033): a throw draws the parcel;
 * a delivery and a miss move the HUD's *Houses* and are said; a crash shows
 * *Crashed* and is said; each moving hazard is said as it is set going
 * (`hud/delivery-announce.ts` §`oweObstacleAhead`) and drawn; and a car
 * pulling out is drawn driving out with its indicator on.
 *
 * - `delivery-throw`: a throw was taken.
 * - `delivery-delivered` / `delivery-missed`: a house went from expecting to
 *   delivered or to missed, once a frame whatever the count.
 * - `delivery-crash`: a crash was counted.
 * - `hazard-dog`, `hazard-car`, `hazard-rider`: a moving hazard was set going
 *   (#2364), the moment it is said.
 * - `car-engine` (#2992): a car pulling out started to drive out, its own
 *   `startAfter` after it was set going.
 */

import type { GameEffectName } from '../audio-port';

import type { Obstacle, ObstacleKind } from './obstacles';
import type { DeliveryRide, DeliveryRideStepped } from './ride-round';
import { DELIVERY_TICK_SECONDS } from './throw';

/** The warning each moving hazard sounds as it is set going. */
const HAZARD_SOUND: Partial<Readonly<Record<ObstacleKind, GameEffectName>>> = {
  dog: 'hazard-dog',
  'car-pulling-out': 'hazard-car',
  'oncoming-rider': 'hazard-rider',
};

/** Seconds since `obstacle` was set going at `tick`, or `undefined` while it waits. */
function secondsGoing(startedAt: number | undefined, tick: number): number | undefined {
  return startedAt === undefined ? undefined : (tick - startedAt) * DELIVERY_TICK_SECONDS;
}

/** Whether a car pulling out started to drive out between the two ticks. */
function droveOut(
  obstacle: Obstacle,
  before: number | undefined,
  after: number | undefined,
): boolean {
  if (obstacle.kind !== 'car-pulling-out' || obstacle.startAfter === undefined) return false;
  if (after === undefined || after < obstacle.startAfter) return false;
  return before === undefined || before < obstacle.startAfter;
}

/** The sounds `stepped` calls for, the round having stood at `before` when the frame began. */
export function deliverySounds(
  before: DeliveryRide,
  stepped: DeliveryRideStepped,
): readonly GameEffectName[] {
  const after = stepped.ride;
  const sounds: GameEffectName[] = [];
  if (stepped.thrown) sounds.push('delivery-throw');
  // Its warning as it is set going, and its engine as it drives out.
  after.obstacles.forEach((obstacle, index) => {
    const was = before.obstacleState.startedAt[index];
    const now = after.obstacleState.startedAt[index];
    const warning = HAZARD_SOUND[obstacle.kind];
    if (warning !== undefined && was === undefined && now !== undefined) sounds.push(warning);
    if (
      droveOut(
        obstacle,
        secondsGoing(was, before.obstacleState.tick),
        secondsGoing(now, after.obstacleState.tick),
      )
    ) {
      sounds.push('car-engine');
    }
  });
  let delivered = false;
  let missed = false;
  after.round.houses.forEach((outcome, position) => {
    if (before.round.houses[position] !== 'expecting') return;
    if (outcome === 'delivered') delivered = true;
    else if (outcome === 'missed') missed = true;
  });
  if (delivered) sounds.push('delivery-delivered');
  if (missed) sounds.push('delivery-missed');
  if (stepped.crashes > 0) sounds.push('delivery-crash');
  return sounds;
}
