// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2577: the owner, on the tablet, "I cant tell when I throw a package if it
 * actually gets to the house. Is there a reward for hitting it." A parcel's
 * landing is kept on the round for a moment, with what it earned, and the
 * frame marks it: a hit on the house, a miss where the parcel came down. Read
 * back through what `GameView` reads: the stepped round and `deliveryInView`.
 * The town is synthetic and no test name or message carries a coordinate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';
import { roadCorridor } from '../terrain';

import { deliveryTown } from './delivery-town-testing';
import { deliveryInView } from './in-view';
import {
  LANDING_SHOWN_SECONDS,
  LANDING_SHOWN_TICKS,
  startDeliveryRide,
  stepDeliveryRide,
  type DeliveryRide,
  type ParcelLanded,
} from './ride-round';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  DELIVERY_TICK_SECONDS,
  NO_DELIVERY_SCORE_DELTA,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  type ThrowTarget,
} from './throw';

const town = deliveryTown();
const SPEED = 8;

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 2_577;
      return array;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const storage: PreferenceStorage = { getItem: () => null, setItem: () => undefined };

/** A round in the town with no obstacle, so a throw is not also a crash. */
function started(): DeliveryRide {
  const ride = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    lineOffset: 0,
    storage,
  });
  if (ride === undefined) throw new Error('the town gave no round');
  return { ...ride, obstacles: [], obstacleState: { tick: 0, startedAt: [], crashed: [] } };
}

/** Ride on one step a call to the ride distance `along`, throwing `throwTo` on the first, and every landing on the way. */
function rideTo(
  ride: DeliveryRide,
  along: number,
  throwTo?: 'left' | 'right',
): { ride: DeliveryRide; landed: ParcelLanded[] } {
  let now = ride;
  const landed: ParcelLanded[] = [];
  let first = true;
  while (now.rideAlong < along - 1e-9) {
    const stepped = stepDeliveryRide(now, {
      ticks: 1,
      along: Math.min(along, now.rideAlong + SPEED * DELIVERY_TICK_SECONDS),
      speed: SPEED,
      ...(first && throwTo !== undefined ? { throwTo } : {}),
    });
    first = false;
    now = stepped.ride;
    landed.push(...stepped.landed);
  }
  return { ride: now, landed };
}

/** Where to throw from for a parcel to land on `target`'s step. */
function throwPoint(target: ThrowTarget): number {
  const across = CARRIAGEWAY_HALF_WIDTH_METRES + target.clear;
  return target.along - SPEED * (across / PARCEL_THROW_SPEED_METRES_PER_SECOND);
}

/** Ride until no parcel is in the air, and every landing on the way. */
function untilLanded(ride: DeliveryRide): { ride: DeliveryRide; landed: ParcelLanded[] } {
  let now = ride;
  const landed: ParcelLanded[] = [];
  while (now.throws.inFlight.length > 0) {
    const stepped = rideTo(now, now.rideAlong + SPEED * DELIVERY_TICK_SECONDS);
    now = stepped.ride;
    landed.push(...stepped.landed);
  }
  return { ride: now, landed };
}

/** The frame's markers of `kind`, as `GameView` hands the view its frame. */
function marksOf(ride: DeliveryRide, kind: 'delivered' | 'missed') {
  return deliveryInView({
    corridor: roadCorridor(town.profile, town.origin, ride.along),
    targets: ride.targets,
    round: ride.round,
    throws: ride.throws,
    obstacles: ride.obstacles,
    obstacleState: ride.obstacleState,
    noDelivery: ride.noDeliveryTargets,
    landed: ride.landed,
  }).markers.filter((marker) => marker.kind === kind);
}

describe('a parcel’s landing, shown — #2577', () => {
  it('holds the mark for 1.5 s of the throw clock, 30 ticks', () => {
    expect(LANDING_SHOWN_SECONDS).toBe(1.5);
    expect(LANDING_SHOWN_TICKS).toBe(30);
  });

  it('reports a delivery with the point it earned, and marks the house it reached until the mark’s time is up', () => {
    const ride = started();
    const target = ride.throwTargets[0] as ThrowTarget;
    const house = ride.targets.find((each) => each.position === target.position);
    const thrown = rideTo(
      rideTo(ride, throwPoint(target)).ride,
      throwPoint(target) + 0.4,
      target.side,
    );
    const { ride: landed, landed: landings } = untilLanded(thrown.ride);
    expect(landed.round.houses[target.position]).toBe('delivered');
    expect(landings).toHaveLength(1);
    expect(landings[0]).toMatchObject({ kind: 'delivered', points: 1, house: target.position });
    expect(landed.score).toBe(1);
    expect(landed.landed).toEqual(landings);
    // On the frame: the house's own marker is gone, and a hit's mark stands where it stood.
    const marks = marksOf(landed, 'delivered');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ x: house?.x, y: house?.y, z: house?.z });
    expect(marksOf(landed, 'missed')).toEqual([]);
    // Still there one tick short of its time, gone at it.
    const sinceLanding = landed.throws.tick - (landings[0]?.tick ?? 0);
    const almost = rideTo(
      landed,
      landed.rideAlong + SPEED * DELIVERY_TICK_SECONDS * (LANDING_SHOWN_TICKS - 1 - sinceLanding),
    ).ride;
    expect(marksOf(almost, 'delivered')).toHaveLength(1);
    const gone = rideTo(almost, almost.rideAlong + SPEED * DELIVERY_TICK_SECONDS).ride;
    expect(gone.landed).toEqual([]);
    expect(marksOf(gone, 'delivered')).toEqual([]);
  });

  it('reports a parcel no house caught as a miss, worth nothing, marked where it came down on its side of the road', () => {
    const ride = started();
    const target = ride.throwTargets[0] as ThrowTarget;
    // Thrown to the other side: no house there catches it.
    const away = target.side === 'right' ? 'left' : 'right';
    const thrown = rideTo(rideTo(ride, throwPoint(target)).ride, throwPoint(target) + 0.4, away);
    const { ride: landed, landed: landings } = untilLanded(thrown.ride);
    expect(landings).toHaveLength(1);
    expect(landings[0]).toMatchObject({ kind: 'missed', points: 0, side: away });
    expect(landings[0]?.house).toBeUndefined();
    expect(landed.score).toBe(0);
    const marks = marksOf(landed, 'missed');
    expect(marks).toHaveLength(1);
    expect(marksOf(landed, 'delivered')).toEqual([]);
    // It lies off the road on the side thrown to, where the parcel came down.
    const corridor = roadCorridor(town.profile, town.origin, landed.along);
    const centre = deliveryInView({
      corridor,
      targets: [],
      round: landed.round,
      throws: {
        tick: 1,
        readyAt: 0,
        inFlight: [{ side: away, launchAlong: landings[0]?.along ?? 0, speed: 0, launchTick: 1 }],
      },
      obstacles: [],
      obstacleState: landed.obstacleState,
    }).parcels[0];
    // A parcel just thrown from that spot is drawn at the road's centre, so the mark's
    // distance from it is how far across the parcel came down.
    const across = Math.hypot(
      (marks[0]?.x ?? 0) - (centre?.x ?? 0),
      (marks[0]?.z ?? 0) - (centre?.z ?? 0),
    );
    expect(across).toBeCloseTo(landings[0]?.across ?? -1, 6);
    expect(across).toBeGreaterThan(CARRIAGEWAY_HALF_WIDTH_METRES);
  });

  it('reports a parcel at a house that must not get one with the point it cost, and marks that house a miss', () => {
    const plain = started();
    const target = plain.throwTargets[0] as ThrowTarget;
    const house = plain.targets[0];
    if (house === undefined) throw new Error('no house');
    // The round's first house, as a house that must not get a parcel; a score of 2 to take one off.
    const ride: DeliveryRide = {
      ...plain,
      throwTargets: plain.throwTargets.slice(1),
      throwNoDelivery: [{ ...target, position: 0 }],
      noDeliveryTargets: [{ ...house, position: 0 }],
      noDeliveryCosts: true,
      changes: ['delivery', 'delivery'],
      score: 2,
    };
    const thrown = rideTo(
      rideTo(ride, throwPoint(target)).ride,
      throwPoint(target) + 0.4,
      target.side,
    );
    const { ride: landed, landed: landings } = untilLanded(thrown.ride);
    expect(landings).toHaveLength(1);
    expect(landings[0]).toMatchObject({
      kind: 'no-delivery',
      points: NO_DELIVERY_SCORE_DELTA,
      house: 0,
    });
    expect(landed.score).toBe(2 + NO_DELIVERY_SCORE_DELTA);
    const marks = marksOf(landed, 'missed');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ x: house.x, z: house.z });
    // With the score at nought it costs nothing, and says so: never below nought.
    const atNought = untilLanded(
      rideTo(
        rideTo({ ...ride, changes: [], score: 0 }, throwPoint(target)).ride,
        throwPoint(target) + 0.4,
        target.side,
      ).ride,
    );
    expect(atNought.landed[0]).toMatchObject({ kind: 'no-delivery', points: 0 });
  });

  it('shows a parcel that lands after the round’s end, worth nothing', () => {
    const ride = started();
    const target = ride.throwTargets[0] as ThrowTarget;
    const thrown = rideTo(
      rideTo(ride, throwPoint(target)).ride,
      throwPoint(target) + 0.4,
      target.side,
    );
    // The round settled while the parcel is in the air: nothing after it scores.
    const over: DeliveryRide = {
      ...thrown.ride,
      outcome: { delivered: 0, missed: 0 } as unknown as DeliveryRide['outcome'],
    };
    const { ride: landed, landed: landings } = untilLanded(over);
    expect(landings).toHaveLength(1);
    expect(landings[0]?.points).toBe(0);
    expect(landed.score).toBe(over.score);
  });
});
