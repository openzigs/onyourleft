// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1814's pure half: `in-view.ts` §`deliveryInView` places a Delivery frame's
 * pieces on the frame's own corridor — a marker only on a house still
 * expecting a parcel, a parcel only while it flies, every obstacle where
 * `obstacles.ts` says it stands — and nothing off the corridor. The drawing is
 * `delivery-belt.test.ts`'s and `delivery.browser.spec.ts`'s.
 */

import { describe, expect, it } from 'vitest';

import { plannerCornerRoute } from '../route-fixtures-testing';
import { corridorOrigin, roadCorridor, type CorridorPoint } from '../terrain';

import {
  deliveryInView,
  PARCEL_HAND_METRES,
  PARCEL_LOB_METRES,
  type DeliveryDrawInput,
} from './in-view';
import { obstacleAcross, startObstacles, stepObstacles, type Obstacle } from './obstacles';
import { recordDelivery, recordMiss, startRound } from './round';
import type { DeliveryTarget } from './targets';
import {
  DELIVERY_TICK_SECONDS,
  NO_PARCELS,
  PARCEL_FLIGHT_SECONDS,
  PARCEL_FLIGHT_TICKS,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  stepThrows,
  type ThrowState,
} from './throw';

/** The rider's odometer on the fixture: the corridor runs 60 m behind to 400 m ahead of it. */
const RIDER = 500;

/**
 * A straight corridor due north, a point every 2 m from 60 m behind the rider
 * to 400 m ahead, climbing 1 %: local `z` is the distance along it and `x` the
 * offset, west positive (`terrain.ts` §`localGroundPosition`), so a reader of
 * a failing assertion reads metres. Only the centreline is read.
 */
const CORRIDOR: { readonly centre: readonly CorridorPoint[] } = {
  centre: Array.from({ length: 231 }, (_, index): CorridorPoint => {
    const along = RIDER - 60 + 2 * index;
    return { x: 0, y: along / 100, z: along, distance: along, along };
  }),
};

/** A house's front step, `distance` along and `side` of the north fixture, as #1808 hands one over. */
function targetAt(position: number, distance: number): DeliveryTarget {
  const at = pointAt(CORRIDOR, distance);
  return {
    position,
    distance,
    side: -1,
    fromRoad: 6,
    kind: 'doorstep',
    x: at.x + 6,
    y: at.y + 0.2,
    z: at.z,
    yaw: Math.PI / 2,
  };
}

/** Where the fixture's road is at `along`: on its centreline, at its height. */
function pointAt(_corridor: typeof CORRIDOR, along: number): { x: number; y: number; z: number } {
  return { x: 0, y: along / 100, z: along };
}

function input(over: Partial<DeliveryDrawInput> = {}): DeliveryDrawInput {
  return {
    corridor: CORRIDOR,
    targets: [],
    round: startRound(1),
    throws: NO_PARCELS,
    obstacles: [],
    obstacleState: startObstacles([]),
    ...over,
  };
}

/** One parcel thrown from `along` at `speed`, then `ticks` ticks run with nothing to catch it. */
function thrown(along: number, speed: number, side: 'left' | 'right', ticks: number): ThrowState {
  const round = startRound(1);
  const launched = stepThrows(NO_PARCELS, {
    rider: { along, speed },
    targets: [],
    round,
    throwTo: side,
    ticks: 0,
  });
  return stepThrows(launched.state, { rider: { along, speed }, targets: [], round, ticks }).state;
}

describe('a Delivery frame’s pieces — #1814', () => {
  it('stands a marker on each house still expecting a parcel, and on none delivered or missed', () => {
    const targets = [targetAt(0, 520), targetAt(1, 580), targetAt(2, 640)];
    let round = startRound(3);
    const before = deliveryInView(input({ targets, round }));
    expect(before.markers).toEqual(
      targets.map((target) => ({ x: target.x, y: target.y, z: target.z, yaw: target.yaw })),
    );

    round = recordDelivery(round, 0);
    round = recordMiss(round, 2);
    const after = deliveryInView(input({ targets, round }));
    expect(after.markers).toEqual([
      { x: targets[1]?.x, y: targets[1]?.y, z: targets[1]?.z, yaw: targets[1]?.yaw },
    ]);
  });

  it('draws nothing off the frame’s corridor: no house, parcel or obstacle past either end', () => {
    const first = (CORRIDOR.centre[0] as CorridorPoint).along;
    const last = (CORRIDOR.centre[CORRIDOR.centre.length - 1] as CorridorPoint).along;
    const far: Obstacle = { kind: 'bin', along: last + 5, from: 'left', startAfter: 0 };
    const behind: Obstacle = { kind: 'cone', along: first - 5, from: 'right', startAfter: 0 };
    const near: Obstacle = { kind: 'trolley', along: RIDER + 30, from: 'left', startAfter: 0 };
    const obstacles = [far, behind, near];
    const pieces = deliveryInView(
      input({
        targets: [{ ...targetAt(0, RIDER), distance: last + 10 }, targetAt(1, RIDER + 20)],
        round: startRound(2),
        throws: thrown(last - 1, 10, 'right', 4),
        obstacles,
        obstacleState: startObstacles(obstacles),
      }),
    );
    expect(pieces.markers).toHaveLength(1);
    // Thrown a metre short of the corridor's end at 10 m/s: a metre past it after four ticks.
    expect(pieces.parcels).toEqual([]);
    expect(pieces.obstacles.map((obstacle) => obstacle.kind)).toEqual(['trolley']);
  });

  it('flies a parcel from the rider’s hand on the road’s centre, across to the side it was thrown and on at the rider’s speed', () => {
    const road = pointAt(CORRIDOR, 510);
    const [atThrow] = deliveryInView(input({ throws: thrown(510, 8, 'right', 0) })).parcels;
    expect(atThrow?.x).toBeCloseTo(road.x, 9);
    expect(atThrow?.z).toBeCloseTo(road.z, 9);
    expect(atThrow?.y).toBeCloseTo(road.y + PARCEL_HAND_METRES, 9);

    // Ten ticks, half a second: 5 m across and 4 m on.
    const ticks = 10;
    const seconds = ticks * DELIVERY_TICK_SECONDS;
    const share = seconds / PARCEL_FLIGHT_SECONDS;
    const ahead = pointAt(CORRIDOR, 514);
    const across = PARCEL_THROW_SPEED_METRES_PER_SECOND * seconds;
    const [right] = deliveryInView(input({ throws: thrown(510, 8, 'right', ticks) })).parcels;
    const [left] = deliveryInView(input({ throws: thrown(510, 8, 'left', ticks) })).parcels;
    // Riding north, the rider's right is east, which is `−x` (`terrain.ts` §`localGroundPosition`).
    expect(right?.x).toBeCloseTo(ahead.x - across, 9);
    expect(left?.x).toBeCloseTo(ahead.x + across, 9);
    expect(right?.z).toBeCloseTo(ahead.z, 9);
    expect(right?.y).toBeCloseTo(
      ahead.y + PARCEL_HAND_METRES * (1 - share) + 4 * PARCEL_LOB_METRES * share * (1 - share),
      9,
    );
  });

  it('draws a parcel only while it flies: the step that lands it takes it out', () => {
    const flying = thrown(510, 8, 'right', PARCEL_FLIGHT_TICKS - 1);
    expect(deliveryInView(input({ throws: flying })).parcels).toHaveLength(1);
    const landed = thrown(510, 8, 'right', PARCEL_FLIGHT_TICKS);
    expect(landed.inFlight).toEqual([]);
    expect(deliveryInView(input({ throws: landed })).parcels).toEqual([]);
  });

  it('moves a parcel between ticks by the frame’s share of one, and no further than a whole tick', () => {
    const throws = thrown(510, 8, 'right', 4);
    const at = (sinceStep?: number): number =>
      deliveryInView(input({ throws, ...(sinceStep === undefined ? {} : { sinceStep }) }))
        .parcels[0]?.z ?? Number.NaN;
    const tick = 8 * DELIVERY_TICK_SECONDS;
    expect(at()).toBeCloseTo(at(0), 12);
    expect(at(0.5) - at(0)).toBeCloseTo(tick / 2, 9);
    expect(at(1) - at(0)).toBeCloseTo(tick, 9);
    expect(at(3)).toBeCloseTo(at(1), 12);
    expect(at(-1)).toBeCloseTo(at(0), 12);
  });

  it('stands every obstacle where `obstacles.ts` has it: off its kerb until it is set going, then crossing', () => {
    const obstacle: Obstacle = { kind: 'bin', along: RIDER + 40, from: 'left', startAfter: 1 };
    const obstacles = [obstacle];
    const road = pointAt(CORRIDOR, obstacle.along);
    let state = startObstacles(obstacles);
    const waiting = deliveryInView(input({ obstacles, obstacleState: state })).obstacles;
    expect(waiting).toEqual([
      {
        kind: 'bin',
        // Off the LEFT kerb: west, `+x`, riding north.
        x: expect.closeTo(road.x - obstacleAcross(obstacle, 0), 9) as number,
        y: road.y,
        z: expect.closeTo(road.z, 9) as number,
        yaw: expect.closeTo(0, 9) as number,
      },
    ]);
    expect(obstacleAcross(obstacle, 0)).toBeLessThan(0);

    // The rider in sight of it: set going on this tick, then 40 more ticks, two seconds.
    state = stepObstacles(state, {
      rider: { along: RIDER, lateral: 2, speed: 0 },
      obstacles,
    }).state;
    for (let tick = 0; tick < 40; tick += 1) {
      state = stepObstacles(state, {
        rider: { along: RIDER, lateral: 2, speed: 0 },
        obstacles,
      }).state;
    }
    const [crossing] = deliveryInView(input({ obstacles, obstacleState: state })).obstacles;
    expect(crossing?.x).toBeCloseTo(
      road.x - obstacleAcross(obstacle, 40 * DELIVERY_TICK_SECONDS),
      9,
    );
    expect(obstacleAcross(obstacle, 40 * DELIVERY_TICK_SECONDS)).not.toBeCloseTo(
      obstacleAcross(obstacle, 0),
      3,
    );
  });

  it('places on a bend by distance along the corridor, across its own normal, at the road’s height', () => {
    const corner = plannerCornerRoute(90);
    const corridor = roadCorridor(corner, corridorOrigin(corner), 400);
    const centre = corridor.centre;
    let checked = 0;
    for (let index = 1; index < centre.length - 1; index += 7) {
      const point = centre[index] as CorridorPoint;
      const next = centre[index + 1] as CorridorPoint;
      // A parcel at the throw stands on the centre line, at its point.
      const [parcel] = deliveryInView(
        input({ corridor, throws: thrown(point.along, 0, 'right', 0) }),
      ).parcels;
      expect(parcel?.x).toBeCloseTo(point.x, 9);
      expect(parcel?.z).toBeCloseTo(point.z, 9);
      // An obstacle off its kerb stands square across the road from it.
      const obstacle: Obstacle = { kind: 'cone', along: point.along, from: 'right', startAfter: 0 };
      const [standing] = deliveryInView(
        input({ corridor, obstacles: [obstacle], obstacleState: startObstacles([obstacle]) }),
      ).obstacles;
      const headingX = next.x - point.x;
      const headingZ = next.z - point.z;
      const offX = (standing?.x ?? 0) - point.x;
      const offZ = (standing?.z ?? 0) - point.z;
      expect(Math.abs(offX * headingX + offZ * headingZ)).toBeLessThan(1e-6);
      expect(Math.hypot(offX, offZ)).toBeCloseTo(Math.abs(obstacleAcross(obstacle, 0)), 9);
      // To the rider's right: the cross product of heading and offset points down.
      expect(headingZ * offX - headingX * offZ).toBeLessThan(0);
      expect(standing?.y).toBeCloseTo(point.y, 9);
      expect(standing?.yaw).toBeCloseTo(Math.atan2(headingX, headingZ), 9);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
