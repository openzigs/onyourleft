// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which game sounds one frame's steps call for — #3012. That `GameView` plays
 * them is `delivery-wiring.test.tsx`'s; that they land on the effects bus is
 * `game-effects.test.ts`'.
 */

import { describe, expect, it } from 'vitest';

import { deliverySounds } from './delivery-sounds';
import type { Obstacle, ObstacleState } from './obstacles';
import type { DeliveryRide, DeliveryRideStepped } from './ride-round';
import type { HouseOutcome } from './round';
import { DELIVERY_TICK_SECONDS } from './throw';

const DOG: Obstacle = { kind: 'dog', along: 300, from: 'left', startAfter: 2 };
const CAR: Obstacle = {
  kind: 'car-pulling-out',
  along: 600,
  from: 'right',
  startAfter: 1,
  to: 2.4,
  rides: 0,
};
const RIDER: Obstacle = {
  kind: 'oncoming-rider',
  along: 900,
  from: 'left',
  startAfter: 0,
  to: -1.75,
  rides: -4,
};
const BIN: Obstacle = { kind: 'bin', along: 1_200, stands: 1.75 };
const OBSTACLES = [DOG, CAR, RIDER, BIN] as const;

/**
 * The parts of a round `deliverySounds` reads: its obstacles, where they
 * stand, and its houses. The rest of a ride is not read.
 */
function ride(houses: readonly HouseOutcome[], obstacleState: ObstacleState): DeliveryRide {
  return {
    obstacles: OBSTACLES,
    obstacleState,
    round: { houses },
  } as unknown as DeliveryRide;
}

function state(tick: number, startedAt: readonly (number | undefined)[]): ObstacleState {
  return { tick, startedAt, crashed: startedAt.map(() => false) };
}

function stepped(
  after: DeliveryRide,
  over: Partial<Omit<DeliveryRideStepped, 'ride'>> = {},
): DeliveryRideStepped {
  return { ride: after, crashes: 0, thrown: false, noDeliveries: 0, ...over };
}

const WAITING = state(10, [undefined, undefined, undefined, undefined]);
const EXPECTING: readonly HouseOutcome[] = ['expecting', 'expecting', 'expecting'];

describe('the game sounds a frame calls for — #3012', () => {
  it('calls for nothing on a frame where nothing happened', () => {
    const before = ride(EXPECTING, WAITING);
    expect(deliverySounds(before, stepped(ride(EXPECTING, state(12, WAITING.startedAt))))).toEqual(
      [],
    );
  });

  it('a throw, a delivery, a miss and a crash, each once a frame however many', () => {
    const before = ride(EXPECTING, WAITING);
    const after = ride(['delivered', 'missed', 'delivered'], state(12, WAITING.startedAt));
    expect(deliverySounds(before, stepped(after, { thrown: true, crashes: 2 }))).toStrictEqual([
      'delivery-throw',
      'delivery-delivered',
      'delivery-missed',
      'delivery-crash',
    ]);
  });

  it('says nothing again of a house settled before the frame', () => {
    const before = ride(['delivered', 'missed', 'expecting'], WAITING);
    const after = ride(['delivered', 'missed', 'expecting'], state(12, WAITING.startedAt));
    expect(deliverySounds(before, stepped(after))).toStrictEqual([]);
  });

  it('warns of each moving hazard the frame set going, and never of a standing one', () => {
    const before = ride(EXPECTING, WAITING);
    const after = ride(EXPECTING, state(12, [11, 12, 11, 11]));
    expect(deliverySounds(before, stepped(after))).toStrictEqual([
      'hazard-dog',
      'hazard-car',
      'hazard-rider',
    ]);
    // Set going already: no second warning.
    expect(deliverySounds(after, stepped(ride(EXPECTING, state(13, [11, 12, 11, 11]))))).toEqual(
      [],
    );
  });

  it('starts the car’s engine on the frame it drives out, its startAfter after it was set going, and once', () => {
    const goingAt = 12;
    const outAt = goingAt + Math.ceil(CAR.startAfter / DELIVERY_TICK_SECONDS);
    const at = (tick: number): DeliveryRide =>
      ride(EXPECTING, state(tick, [undefined, goingAt, undefined, undefined]));
    const sounds: string[] = [];
    for (let tick = goingAt; tick < outAt + 10; tick += 1) {
      sounds.push(...deliverySounds(at(tick), stepped(at(tick + 1))));
    }
    expect(sounds).toStrictEqual(['car-engine']);
    // On the frame that sets it going and is past its wait already: both.
    const late = deliverySounds(
      ride(EXPECTING, WAITING),
      stepped(ride(EXPECTING, state(goingAt + 40, [undefined, goingAt, undefined, undefined]))),
    );
    expect(late).toStrictEqual(['hazard-car', 'car-engine']);
  });
});
