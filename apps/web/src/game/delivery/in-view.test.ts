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
  LOW_LIGHT_REVEAL_METRES,
  PARCEL_HAND_METRES,
  PARCEL_LOB_METRES,
  type DeliveryDrawInput,
} from './in-view';
import {
  drawnObstacleAcross,
  obstacleAcross,
  obstacleAlong,
  startObstacles,
  stepObstacles,
  type Obstacle,
} from './obstacles';
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
      targets.map((target) => ({
        x: target.x,
        y: target.y,
        z: target.z,
        yaw: target.yaw,
        kind: 'house',
      })),
    );

    round = recordDelivery(round, 0);
    round = recordMiss(round, 2);
    const after = deliveryInView(input({ targets, round }));
    expect(after.markers).toEqual([
      {
        x: targets[1]?.x,
        y: targets[1]?.y,
        z: targets[1]?.z,
        yaw: targets[1]?.yaw,
        kind: 'house',
      },
    ]);
  });

  it('marks a mailbox with its own marker at the kerb, and a house that must not get a parcel with its sign — #2365', () => {
    const targets = [targetAt(0, 520), { ...targetAt(1, 580), mailbox: true, x: 4.1 }];
    const skip = { ...targetAt(0, 640), x: 6.5 };
    const view = deliveryInView(input({ targets, round: startRound(2), noDelivery: [skip] }));
    expect(view.markers.map((marker) => [marker.kind, marker.x, marker.z])).toEqual([
      ['house', targets[0]?.x, targets[0]?.z],
      ['mailbox', 4.1, targets[1]?.z],
      ['no-delivery', 6.5, skip.z],
    ]);
    // A delivered or missed house loses its marker; one that gets no parcel keeps its sign.
    const settled = recordMiss(recordDelivery(startRound(2), 0), 1);
    expect(
      deliveryInView(input({ targets, round: settled, noDelivery: [skip] })).markers.map(
        (marker) => marker.kind,
      ),
    ).toEqual(['no-delivery']);
  });

  it('reveals a house’s sign that it gets no parcel as it reveals a house’s marker, in rain or at dusk — #2366, the owner’s ruling of 2026-11-12', () => {
    const near = { ...targetAt(0, RIDER + 30), x: 6.5 };
    const edge = { ...targetAt(1, RIDER + LOW_LIGHT_REVEAL_METRES), x: 6.5 };
    const far = { ...targetAt(2, RIDER + 41), x: 6.5 };
    const signs = (revealMetres: number | undefined): readonly (number | undefined)[] =>
      deliveryInView(
        input({
          targets: [],
          round: startRound(1),
          noDelivery: [near, edge, far],
          riderAlong: RIDER,
          revealMetres,
        }),
      )
        .markers.filter((marker) => marker.kind === 'no-delivery')
        .map((marker) => marker.z);
    // At dusk or in rain: those within the reveal distance, its edge included.
    expect(signs(LOW_LIGHT_REVEAL_METRES)).toEqual([near.z, edge.z]);
    // Clear daylight: every sign on the corridor, for the whole round.
    expect(signs(undefined)).toEqual([near.z, edge.z, far.z]);
  });

  it('hides a marker beyond the reveal distance and shows it inside it, and in clear weather draws every one — #2366', () => {
    const targets = [targetAt(0, RIDER + 30), targetAt(1, RIDER + 41), targetAt(2, RIDER + 200)];
    const round = startRound(3);
    const dusk = deliveryInView(
      input({
        targets,
        round,
        riderAlong: RIDER,
        revealMetres: LOW_LIGHT_REVEAL_METRES,
        weather: { rain: false, dusk: true },
      }),
    );
    expect(LOW_LIGHT_REVEAL_METRES).toBe(40);
    expect(dusk.markers.map((marker) => marker.z)).toEqual([targets[0]?.z]);
    expect(dusk.weather).toEqual({ rain: false, dusk: true });
    // Exactly at the reveal distance it shows.
    const edge = deliveryInView(
      input({
        targets: [targetAt(0, RIDER + LOW_LIGHT_REVEAL_METRES)],
        round: startRound(1),
        riderAlong: RIDER,
        revealMetres: LOW_LIGHT_REVEAL_METRES,
      }),
    );
    expect(edge.markers).toHaveLength(1);
    // Clear weather: no reveal distance, every marker on the corridor, and no weather on the frame.
    const clear = deliveryInView(input({ targets, round, riderAlong: RIDER }));
    expect(clear.markers).toHaveLength(3);
    expect(clear.weather).toBeUndefined();
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
        // #2362: its place on the round, which a parked car's paint is chosen by.
        index: 0,
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

  it('draws a car pulling out driving out: its nose the way it goes, its wheels rolling and steered, its road-side indicator on', () => {
    const cars: readonly Obstacle[] = [
      {
        kind: 'car-pulling-out',
        along: RIDER + 40,
        from: 'left',
        startAfter: 0.5,
        to: -2.4,
        rides: 0,
      },
      {
        kind: 'car-pulling-out',
        along: RIDER + 55,
        from: 'right',
        startAfter: 0.5,
        to: 2.4,
        rides: 0,
      },
    ];
    const at = (tick: number | undefined, over: Partial<DeliveryDrawInput> = {}) =>
      deliveryInView(
        input({
          obstacles: cars,
          obstacleState:
            tick === undefined
              ? startObstacles(cars)
              : { tick, startedAt: [0, 0], crashed: [false, false] },
          ...over,
        }),
      ).obstacles;
    // Not set going: waiting, parallel to the road, the indicator lit steadily.
    for (const [index, piece] of at(undefined).entries()) {
      expect(piece.yaw).toBeCloseTo(0, 9);
      expect(piece.car).toStrictEqual({
        travelledMetres: 0,
        speedMetresPerSecond: 0,
        steerRadians: 0,
        braking: 0,
        indicator: index === 0 ? 'right' : 'left',
      });
    }
    let last = at(0);
    let driven = 0;
    for (let tick = 1; tick <= 100; tick += 1) {
      const now = at(tick);
      for (const [index, piece] of now.entries()) {
        const before = last[index];
        if (before === undefined || piece.car === undefined) throw new Error('a car has no motion');
        // It flashes from when it was set going.
        expect(piece.car.indicatorSeconds).toBeCloseTo(tick * DELIVERY_TICK_SECONDS, 9);
        const step = Math.hypot(piece.x - before.x, piece.z - before.z);
        expect(piece.car.travelledMetres).toBeGreaterThanOrEqual(before.car?.travelledMetres ?? 0);
        if (step < 0.02) continue;
        driven += 1;
        // Its own +z faces its yaw (`port.ts`): it moves nose first, within 3 degrees.
        const going = Math.atan2(piece.x - before.x, piece.z - before.z);
        expect(Math.abs(going - piece.yaw)).toBeLessThan(0.05);
        expect(piece.car.speedMetresPerSecond).toBeGreaterThan(0.3);
      }
      last = now;
    }
    expect(driven).toBeGreaterThan(90);
    // Out: in its lane, straight, standing, having rolled its whole way.
    const [left, right] = at(100);
    expect(left?.x).toBeCloseTo(2.4, 6);
    expect(right?.x).toBeCloseTo(-2.4, 6);
    expect(left?.z).toBeCloseTo(RIDER + 40, 6);
    expect(left?.car?.travelledMetres).toBeCloseTo(8, 6);
    expect(left?.car?.speedMetresPerSecond).toBeCloseTo(0, 6);
    // Part way: turned toward the road, the two kerbs' cars opposite ways.
    const [turning, other] = at(40);
    expect(turning?.yaw).toBeLessThan(-0.2);
    expect(other?.yaw).toBeGreaterThan(0.2);
    // Under reduced motion the indicator is lit steadily: no clock to flash on.
    for (const piece of at(40, { steadyIndicators: true })) {
      expect(piece.car?.indicator).toBeDefined();
      expect(piece.car).not.toHaveProperty('indicatorSeconds');
    }
  });

  it('draws each moving hazard where it is, facing the way it goes, a car pulling out as its own kind — #2364, #2506', () => {
    const hazards: readonly Obstacle[] = [
      { kind: 'dog', along: RIDER + 50, from: 'left', startAfter: 0 },
      { kind: 'dog', along: RIDER + 55, from: 'right', startAfter: 0 },
      {
        kind: 'car-pulling-out',
        along: RIDER + 70,
        from: 'left',
        startAfter: 0,
        to: -2.4,
        rides: 0,
      },
      {
        kind: 'oncoming-rider',
        along: RIDER + 80,
        from: 'right',
        startAfter: 0,
        to: 1.75,
        rides: -5,
      },
    ];
    // Each set going on the first tick, the rider within sight of them all, then four seconds on.
    let state = startObstacles(hazards);
    for (let tick = 0; tick < 80; tick += 1) {
      state = stepObstacles(state, {
        rider: { along: RIDER, lateral: 0, speed: 0 },
        obstacles: hazards,
      }).state;
    }
    const seconds = (state.tick - (state.startedAt[3] ?? 0)) * DELIVERY_TICK_SECONDS;
    const drawn = deliveryInView(input({ obstacles: hazards, obstacleState: state })).obstacles;
    expect(drawn.map((piece) => piece.kind)).toStrictEqual([
      'dog',
      'dog',
      'car-pulling-out',
      'oncoming-rider',
    ]);
    // Another rider is drawn where they have ridden to, toward the rider: short of where they came out.
    const rider = drawn[3];
    expect(rider?.z).toBeCloseTo(obstacleAlong(hazards[3] as Obstacle, seconds), 6);
    expect(rider?.z).toBeLessThan(RIDER + 80 - 10);
    expect(rider?.x).toBeCloseTo(-1.75, 6);
    // Facing the rider, and a dog the way it runs.
    expect(rider?.yaw).toBeCloseTo(Math.PI, 6);
    expect(drawn[0]?.yaw).toBeCloseTo(Math.PI, 6);
    expect(drawn[1]?.yaw).toBeCloseTo(0, 6);
    // A car pulling out out in its kerb lane, along the road, where it came out.
    expect(drawn[2]?.yaw).toBeCloseTo(0, 6);
    expect(drawn[2]?.z).toBeCloseTo(RIDER + 70, 6);
    expect(drawn[2]?.x).toBeCloseTo(2.4, 6);
  });

  it('draws an oncoming rider steering round a rider a crash holds, and in its lane with nobody held — #3077', () => {
    const oncoming: Obstacle = {
      kind: 'oncoming-rider',
      along: RIDER + 80,
      from: 'right',
      startAfter: 0,
      to: 1.75,
      rides: -5,
    };
    let state = startObstacles([oncoming]);
    for (let tick = 0; tick < 80; tick += 1) {
      state = stepObstacles(state, {
        rider: { along: RIDER, lateral: 0, speed: 0 },
        obstacles: [oncoming],
      }).state;
    }
    const seconds = (state.tick - (state.startedAt[0] ?? 0)) * DELIVERY_TICK_SECONDS;
    // Held where the oncoming rider has ridden to, in its lane, fallen to the right.
    const held = {
      along: obstacleAlong(oncoming, seconds),
      lateral: 1.75,
      fallenTo: 1,
      seconds: 1,
    } as const;
    const [steered] = deliveryInView(
      input({ obstacles: [oncoming], obstacleState: state, held }),
    ).obstacles;
    const [inLane] = deliveryInView(
      input({ obstacles: [oncoming], obstacleState: state }),
    ).obstacles;
    // Due north, so a metre right of the centre line is a metre west (−x).
    expect(inLane?.x).toBeCloseTo(-1.75, 6);
    expect(steered?.x).toBeCloseTo(-drawnObstacleAcross(oncoming, seconds, held), 6);
    // Passed on the road's middle side, a whole body and the gap clear of them.
    expect(-(steered?.x ?? 0)).toBeLessThan(1.75 - 0.9);
    expect(steered?.z).toBeCloseTo(inLane?.z ?? Number.NaN, 9);
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
