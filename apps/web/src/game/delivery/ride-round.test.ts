// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1816's round inside a ride, as pure logic: what `GameView` steps on each
 * simulation step. The town is synthetic (`delivery-town-testing.ts`), the
 * seed is fixed by stubbing the platform's random source, and no test name or
 * message carries a coordinate. That the trainer is sent the same with a
 * round as without is `delivery-wiring.test.tsx`'s, through the real ride.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';
import { roadCorridor } from '../terrain';

import { DELIVERY_ASSIST_STORAGE_KEY, type DeliveryAssist } from './assist-preference';
import { DELIVERY_PROGRESS_STORAGE_KEY, readDeliveryProgress } from './delivery-progress';
import { deliveryTown } from './delivery-town-testing';
import {
  CRASH_SCORE_DELTA,
  OBSTACLE_KINDS,
  OBSTACLE_SIGHT_METRES,
  startObstacles,
  type Obstacle,
} from './obstacles';
import { LANE_CHANGE_SECONDS, LANE_OFFSETS_METRES, steerToward } from './steer';
import {
  endDeliveryRide,
  keepDeliveryWeek,
  startDeliveryRide,
  stepDeliveryRide,
  type DeliveryRide,
} from './ride-round';
import { deliveryInView } from './in-view';
import { FIRST_DAY_HOUSES, FRESH_WEEK, roundTally, type WeekProgress } from './round';
import type { DeliveryTarget } from './targets';
import {
  ASSISTED_THROW_SCALE,
  CARRIAGEWAY_HALF_WIDTH_METRES,
  DELIVERY_TICK_SECONDS,
  PARCEL_FLIGHT_TICKS,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  TARGET_CATCH_RADIUS_METRES,
  THROW_WINDOW_AFTER_METRES,
  type ThrowTarget,
} from './throw';

const town = deliveryTown();

/** A device's storage, as a map. */
function storageOf(entries: Record<string, unknown> = {}): PreferenceStorage & {
  readonly items: Map<string, string>;
} {
  const items = new Map(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const SEED = 1_816;

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = SEED;
      return array;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A round in the town, from the rider at `riderDistance`, with what the device keeps. */
function started(storage = storageOf(), riderDistance = 0): DeliveryRide {
  const ride = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance,
    lineOffset: 0,
    storage,
  });
  if (ride === undefined) throw new Error('the town gave no round');
  return ride;
}

const SPEED = 8;

/** Ride `ride` on at {@link SPEED}, one step a call, to `along`, throwing `throwTo` on the first. */
function rideTo(
  ride: DeliveryRide,
  along: number,
  throwTo?: 'left' | 'right',
): { ride: DeliveryRide; crashes: number } {
  let now = ride;
  let crashes = 0;
  let first = true;
  while (now.along < along - 1e-9) {
    const next = Math.min(along, now.along + SPEED * DELIVERY_TICK_SECONDS);
    const stepped = stepDeliveryRide(now, {
      ticks: 1,
      along: next,
      speed: SPEED,
      ...(first && throwTo !== undefined ? { throwTo } : {}),
    });
    first = false;
    now = stepped.ride;
    crashes += stepped.crashes;
  }
  return { ride: now, crashes };
}

/** Where to throw from for a parcel at {@link SPEED} to land on `target`'s step. */
function throwPoint(target: ThrowTarget): number {
  const across = CARRIAGEWAY_HALF_WIDTH_METRES + target.clear;
  return target.along - SPEED * (across / PARCEL_THROW_SPEED_METRES_PER_SECOND);
}

/** The ride with no obstacle on it, so a test of the throw is not also one of a crash. */
function withoutObstacles(ride: DeliveryRide): DeliveryRide {
  return { ...ride, obstacles: [], obstacleState: { tick: 0, startedAt: [], crashed: [] } };
}

describe('a round at the press — #1816', () => {
  it('picks the week’s houses from the town, every one expecting, and scores nought', () => {
    const ride = started();
    expect(ride.week).toEqual(FRESH_WEEK);
    expect(ride.round.houses).toEqual(Array(FIRST_DAY_HOUSES).fill('expecting'));
    expect(ride.targets).toHaveLength(FIRST_DAY_HOUSES);
    expect(ride.throwTargets.map((each) => each.position)).toEqual(
      ride.targets.map((each) => each.position),
    );
    expect(ride.score).toBe(0);
    expect(ride.outcome).toBeUndefined();
    expect(ride.obstacles.length).toBeGreaterThan(0);
  });

  it('throws at each house on its own side, from its own distance, at its own depth', () => {
    const ride = started();
    ride.targets.forEach((target, index) => {
      const thrown = ride.throwTargets[index];
      expect(thrown?.along).toBe(target.distance);
      expect(thrown?.side).toBe(target.side === 1 ? 'right' : 'left');
      expect(CARRIAGEWAY_HALF_WIDTH_METRES + (thrown?.clear ?? -1)).toBeCloseTo(target.fromRoad, 9);
    });
    expect(new Set(ride.throwTargets.map((each) => each.side))).toEqual(new Set(['left', 'right']));
  });

  it('draws a delivered parcel coming down on the doorstep it was thrown to, on its side of the road', () => {
    const ride = withoutObstacles(started());
    for (const [index, target] of ride.throwTargets.slice(0, 2).entries()) {
      const house = ride.targets[index] as DeliveryTarget;
      let now = rideTo(ride, throwPoint(target)).ride;
      now = stepDeliveryRide(now, {
        ticks: 1,
        along: now.along + SPEED * DELIVERY_TICK_SECONDS,
        speed: SPEED,
        throwTo: target.side,
      }).ride;
      // The last tick the parcel is in the air, and where the frame draws it then.
      let last: DeliveryRide = now;
      while (now.throws.inFlight.length > 0) {
        last = now;
        now = rideTo(now, now.along + SPEED * DELIVERY_TICK_SECONDS).ride;
      }
      expect(now.round.houses[target.position]).toBe('delivered');
      const drawn = deliveryInView({
        corridor: roadCorridor(town.profile, town.origin, last.along),
        targets: last.targets,
        round: last.round,
        throws: last.throws,
        obstacles: [],
        obstacleState: last.obstacleState,
      });
      const parcel = drawn.parcels[0];
      expect(parcel).toBeDefined();
      const off = Math.hypot((parcel?.x ?? 0) - house.x, (parcel?.z ?? 0) - house.z);
      // Within a tick's flight and the catch radius, never across the road.
      expect(off).toBeLessThan(TARGET_CATCH_RADIUS_METRES + 1);
    }
  });

  it('keeps no seed on the round (DL11): the ride is counts, positions and points only', () => {
    const ride = started();
    expect(JSON.stringify(ride)).not.toContain(String(SEED));
    expect(Object.keys(ride)).not.toContain('seed');
  });

  it('starts the round the device kept, and the assist setting it kept', () => {
    const week: WeekProgress = { day: 4, houses: 5, score: 17 };
    const assist: DeliveryAssist = { widerWindows: true, obstacles: 'none', noFail: true };
    const ride = started(
      storageOf({ [DELIVERY_PROGRESS_STORAGE_KEY]: week, [DELIVERY_ASSIST_STORAGE_KEY]: assist }),
    );
    expect(ride.week).toEqual(week);
    expect(ride.round.houses).toHaveLength(5);
    expect(ride.round.assisted).toBe(true);
    expect(ride.widerWindows).toBe(true);
    expect(ride.obstacles).toEqual([]);
  });

  it('is no round in a town with no house to pick', () => {
    const empty = deliveryTown();
    const none = startDeliveryRide({
      buildings: { ...empty.buildings, plans: [], radii: new Float32Array(0), cells: new Map() },
      profile: empty.profile,
      origin: empty.origin,
      riderDistance: 0,
      lineOffset: 0,
      storage: storageOf(),
    });
    expect(none).toBeUndefined();
  });

  it('is no round in a town with fewer houses than the week’s round, and keeps nothing (#1818)', () => {
    // Houses for the first 300 m only: a few targets, fewer than the first day's round.
    const short = deliveryTown('delivery-short', { lastAlong: 300 });
    const pick = (houses: number): DeliveryRide | undefined => {
      const storage = storageOf({
        [DELIVERY_PROGRESS_STORAGE_KEY]: { day: 3, houses, score: 9 },
      });
      const ride = startDeliveryRide({
        buildings: short.buildings,
        profile: short.profile,
        origin: short.origin,
        riderDistance: 0,
        lineOffset: 0,
        storage,
      });
      // Nothing is kept at the press, round or none.
      expect(readDeliveryProgress(storage)).toEqual({ day: 3, houses, score: 9 });
      return ride;
    };
    // The control: the town holds a round of two, so the refusal below is about the count.
    expect(pick(2)?.round.houses).toHaveLength(2);
    expect(pick(FIRST_DAY_HOUSES)).toBeUndefined();
  });
});

describe('a round ridden, step by step — #1816', () => {
  it('delivers a parcel thrown from the right place, and scores it', () => {
    const ride = withoutObstacles(started());
    const first = ride.throwTargets[0] as ThrowTarget;
    const aimed = rideTo(ride, throwPoint(first));
    const thrown = rideTo(aimed.ride, aimed.ride.along + SPEED * 1.5, first.side);
    expect(thrown.ride.round.houses[first.position]).toBe('delivered');
    expect(thrown.ride.score).toBe(1);
    expect(roundTally(thrown.ride.round).delivered).toBe(1);
  });

  it('misses a house the rider passes with no throw, once its window has closed and not before', () => {
    const ride = withoutObstacles(started());
    const first = ride.throwTargets[0] as ThrowTarget;
    const atClose = rideTo(ride, first.along + THROW_WINDOW_AFTER_METRES);
    expect(atClose.ride.round.houses[first.position]).toBe('expecting');
    const past = rideTo(atClose.ride, first.along + THROW_WINDOW_AFTER_METRES + 0.2);
    expect(past.ride.round.houses[first.position]).toBe('missed');
    expect(past.ride.score).toBe(0);
  });

  it('closes the window later with the assist’s wider windows', () => {
    const ride = withoutObstacles({ ...started(), widerWindows: true });
    const first = ride.throwTargets[0] as ThrowTarget;
    const wider = THROW_WINDOW_AFTER_METRES * ASSISTED_THROW_SCALE;
    const before = rideTo(ride, first.along + wider - 0.1);
    expect(before.ride.round.houses[first.position]).toBe('expecting');
    const after = rideTo(before.ride, first.along + wider + 0.2);
    expect(after.ride.round.houses[first.position]).toBe('missed');
  });

  it('waits for a parcel still in the air before counting its house missed', () => {
    const ride = withoutObstacles(started());
    const first = ride.throwTargets[0] as ThrowTarget;
    // Thrown at the window's very edge: inside it, and landing past the house.
    const atEdge = rideTo(ride, first.along + THROW_WINDOW_AFTER_METRES);
    const thrown = stepDeliveryRide(atEdge.ride, {
      ticks: 1,
      along: atEdge.ride.along + SPEED * DELIVERY_TICK_SECONDS,
      speed: SPEED,
      throwTo: first.side,
    });
    expect(thrown.thrown).toBe(true);
    expect(thrown.ride.round.houses[first.position]).toBe('expecting');
    // It lands wasted, too far along, and only then is the house missed.
    const landed = rideTo(thrown.ride, thrown.ride.along + SPEED * 1.3);
    expect(landed.ride.throws.inFlight).toEqual([]);
    expect(landed.ride.round.houses[first.position]).toBe('missed');
  });

  it('takes a crash off the round’s score, and never below nought', () => {
    const ride = withoutObstacles(started());
    const first = ride.throwTargets[0] as ThrowTarget;
    const delivered = rideTo(
      rideTo(ride, throwPoint(first)).ride,
      throwPoint(first) + 12,
      first.side,
    );
    expect(delivered.ride.score).toBe(1);
    // A bin 30 m on, already in sight, timed to be on the centre line as the
    // rider reaches it at their speed: they ride into it.
    const bin = OBSTACLE_KINDS.bin;
    const rolling: Obstacle = {
      kind: 'bin',
      along: delivered.ride.along + 30,
      from: 'left',
      startAfter: 30 / SPEED - (CARRIAGEWAY_HALF_WIDTH_METRES + bin.halfWidth) / bin.speed,
    };
    const onCourse: DeliveryRide = {
      ...delivered.ride,
      obstacles: [rolling],
      obstacleState: {
        tick: delivered.ride.obstacleState.tick,
        startedAt: [undefined],
        crashed: [false],
      },
    };
    const once = rideTo(onCourse, rolling.along + 2);
    expect(once.crashes).toBe(1);
    expect(once.ride.score).toBe(1 + CRASH_SCORE_DELTA);
    // A second crash at nought costs nothing.
    const again: DeliveryRide = {
      ...once.ride,
      obstacles: [rolling, { ...rolling, along: once.ride.along + 30 }],
      obstacleState: {
        tick: once.ride.obstacleState.tick,
        startedAt: [...once.ride.obstacleState.startedAt, undefined],
        crashed: [...once.ride.obstacleState.crashed, false],
      },
    };
    const twice = rideTo(again, once.ride.along + 32);
    expect(twice.crashes).toBe(1);
    expect(twice.ride.score).toBe(0);
    expect(OBSTACLE_SIGHT_METRES).toBeGreaterThan(30);
  });

  it('sweeps the road a step covered, from the distance it moved and not the speed it ends on', () => {
    const bin = OBSTACLE_KINDS.bin;
    const crossing = (along: number): DeliveryRide => ({
      ...withoutObstacles(started()),
      obstacles: [
        {
          kind: 'bin',
          along,
          from: 'left',
          // Across the centre line on the step this test takes.
          startAfter: -(CARRIAGEWAY_HALF_WIDTH_METRES + bin.halfWidth) / bin.speed,
        },
      ],
      obstacleState: { tick: 0, startedAt: [0], crashed: [false] },
    });
    // A rider who covers 5 m in one step, ending it at a speed (1 m/s) that
    // alone would sweep nothing behind them, still crashes into the bin 3 m
    // back: the 5 m they covered say so.
    const ridden = stepDeliveryRide(crossing(3), {
      ticks: 1,
      along: 5,
      speed: 1,
    });
    expect(ridden.crashes).toBe(1);
    // And a rider who covered almost nothing, whatever speed they end on, has
    // not run into a bin 3 m behind them.
    const near = stepDeliveryRide(
      { ...crossing(2), along: 5 },
      { ticks: 1, along: 5.01, speed: 100 },
    );
    expect(near.crashes).toBe(0);
  });

  it('steps nothing on a frame no simulation step ran on', () => {
    const ride = started();
    const stepped = stepDeliveryRide(ride, {
      ticks: 0,
      along: 500,
      speed: SPEED,
      throwTo: 'left',
    });
    expect(stepped.ride).toBe(ride);
    expect(stepped.thrown).toBe(false);
  });

  it('places the rider at each of a frame’s steps: four in one call ride as four calls do', () => {
    const ride = started(storageOf(), 0);
    let apart = ride;
    for (let step = 1; step <= 4; step += 1) {
      apart = stepDeliveryRide(apart, {
        ticks: 1,
        along: (300 * step) / 4,
        speed: SPEED,
      }).ride;
    }
    const together = stepDeliveryRide(ride, {
      ticks: 4,
      along: 300,
      speed: SPEED,
    });
    expect(together.ride).toEqual(apart);
  });

  it('refuses a step of a part or a negative number of ticks, naming no position', () => {
    const ride = started();
    for (const ticks of [-1, 0.5]) {
      expect(() => stepDeliveryRide(ride, { ticks, along: 1, speed: 1 })).toThrow(
        'a Delivery ride step runs a whole number of ticks, 0 or more',
      );
    }
  });
});

describe('a round the rider steers — #1853', () => {
  /** The ride with one bin standing in `stands`, 40 m ahead, and nothing else in the road. */
  function binIn(stands: number): DeliveryRide {
    const ride = started();
    return {
      ...ride,
      obstacles: [{ kind: 'bin', along: 40, stands }],
      obstacleState: startObstacles([{ kind: 'bin', along: 40, stands }]),
    };
  }

  it('places obstacles that stand in a lane, as a ride the rider can steer has', () => {
    const { obstacles } = started();
    expect(obstacles.length).toBeGreaterThan(0);
    const standing = obstacles.filter((obstacle) => obstacle.stands !== undefined);
    expect(standing.length).toBeGreaterThan(0);
    for (const obstacle of standing) expect(LANE_OFFSETS_METRES).toContain(obstacle.stands);
  });

  it('starts in the lane nearest the racing line at the press, and from where the line is', () => {
    const ride = startDeliveryRide({
      buildings: town.buildings,
      profile: town.profile,
      origin: town.origin,
      riderDistance: 0,
      lineOffset: 1.5,
      storage: storageOf(),
    });
    expect(ride?.steer).toEqual({ lane: 2, offset: 1.5 });
  });

  it('meets the obstacles at the steered offset: in the bin’s lane a crash, a lane away none', () => {
    // The rider starts on the centre line, lane 1. A bin standing there is hit…
    expect(rideTo(binIn(0), 60).crashes).toBe(1);
    // …a bin a lane to the left is not, until the rider steers into it.
    const left = LANE_OFFSETS_METRES[0] as number;
    expect(rideTo(binIn(left), 60).crashes).toBe(0);
    const steered = binIn(left);
    expect(rideTo({ ...steered, steer: steerToward(steered.steer, 'lane-left') }, 60).crashes).toBe(
      1,
    );
  });

  it('steps the steering on each step that ran, so four in one call move it four steps’ worth', () => {
    const ride = started();
    const pressed = { ...ride, steer: steerToward(ride.steer, 'lane-left') };
    const one = stepDeliveryRide(pressed, { ticks: 1, along: 0.4, speed: SPEED }).ride;
    const four = stepDeliveryRide(pressed, { ticks: 4, along: 1.6, speed: SPEED }).ride;
    const lane = (LANE_OFFSETS_METRES[1] as number) - (LANE_OFFSETS_METRES[0] as number);
    const perStep = (lane * DELIVERY_TICK_SECONDS) / LANE_CHANGE_SECONDS;
    expect(one.steer.offset).toBeCloseTo(-perStep, 9);
    expect(four.steer.offset).toBeCloseTo(-4 * perStep, 9);
    // A frame no step ran on moves it not at all.
    expect(stepDeliveryRide(pressed, { ticks: 0, along: 5, speed: SPEED }).ride.steer).toBe(
      pressed.steer,
    );
  });
});

describe('the round’s end — #1816', () => {
  /** Ride the whole round, delivering to every house but the ones in `skip`. */
  function rideRound(skip: ReadonlySet<number>): DeliveryRide {
    let ride = withoutObstacles(started());
    for (const target of ride.throwTargets) {
      if (skip.has(target.position)) continue;
      ride = rideTo(ride, throwPoint(target)).ride;
      ride = rideTo(ride, ride.along + 1, target.side).ride;
    }
    return rideTo(ride, (ride.throwTargets.at(-1)?.along ?? 0) + 20).ride;
  }

  it('ends once every house is settled, and holds that end however the ride goes on', () => {
    const ride = rideRound(new Set([2]));
    expect(roundTally(ride.round)).toMatchObject({ expecting: 0, delivered: 7, missed: 1 });
    expect(ride.outcome).toMatchObject({ delivered: 7, missed: 1, nextHouses: 7 });
    expect(endDeliveryRide(ride)).toBe(ride.outcome);
    // Nothing scores after it: a parcel thrown now, a crash now.
    const later = rideTo(ride, ride.along + 40, 'left');
    expect(later.ride.outcome).toBe(ride.outcome);
    expect(later.ride.score).toBe(ride.score);
  });

  it('ends a round the ride ends first, counting no house the rider has not reached (#1857)', () => {
    const ride = withoutObstacles(started());
    const first = ride.throwTargets[0] as ThrowTarget;
    const one = rideTo(rideTo(ride, throwPoint(first)).ride, throwPoint(first) + 12, first.side);
    expect(one.ride.outcome).toBeUndefined();
    const outcome = endDeliveryRide(one.ride);
    expect(outcome).toMatchObject({ delivered: 1, missed: 0, perfect: false });
    // Not perfect, so no house is added; nothing missed, so none is dropped.
    expect(outcome.next).toEqual({ day: 2, houses: FIRST_DAY_HOUSES, score: 1 });
  });

  it('keeps a day-2 round ended after two deliveries and one passed house as just those, read back from the device (#1857)', () => {
    const week: WeekProgress = { day: 2, houses: FIRST_DAY_HOUSES, score: 4 };
    const storage = storageOf({ [DELIVERY_PROGRESS_STORAGE_KEY]: week });
    let ride = withoutObstacles(started(storage));
    expect(ride.week).toEqual(week);
    const [first, second, third, fourth] = ride.throwTargets as [
      ThrowTarget,
      ThrowTarget,
      ThrowTarget,
      ThrowTarget,
    ];
    for (const target of [first, second]) {
      ride = rideTo(ride, throwPoint(target)).ride;
      ride = rideTo(ride, ride.along + 1, target.side).ride;
    }
    // The third house passed with no throw, and the ride ended short of the fourth's window.
    ride = rideTo(ride, third.along + THROW_WINDOW_AFTER_METRES + 2).ride;
    expect(ride.along).toBeLessThan(fourth.along);
    expect(roundTally(ride.round)).toEqual({
      expecting: FIRST_DAY_HOUSES - 3,
      delivered: 2,
      missed: 1,
      score: 2,
    });
    expect(ride.outcome).toBeUndefined();
    const outcome = endDeliveryRide(ride);
    expect(outcome).toMatchObject({ delivered: 2, missed: 1, perfect: false, weekOver: false });
    expect(keepDeliveryWeek(storage, outcome)).toBe(true);
    // Tomorrow, one house fewer for the one missed, and the two delivered scored:
    // no fresh week from the five never reached.
    expect(readDeliveryProgress(storage)).toEqual({
      day: 3,
      houses: FIRST_DAY_HOUSES - 1,
      score: week.score + 2,
    });
  });

  it('counts a house passed with a parcel still in the air as missed when the ride ends (#1857)', () => {
    let ride = withoutObstacles(started());
    const first = ride.throwTargets[0] as ThrowTarget;
    // Thrown from the doorstep's own distance, inside the window but too late
    // to land on it, and the rider past the window before the parcel comes down.
    ride = rideTo(ride, first.along).ride;
    ride = rideTo(ride, first.along + THROW_WINDOW_AFTER_METRES + 0.5, first.side).ride;
    expect(ride.throws.inFlight).toHaveLength(1);
    expect(ride.round.houses[first.position]).toBe('expecting');
    expect(endDeliveryRide(ride)).toMatchObject({ delivered: 0, missed: 1 });
  });

  it('counts no house missed whose widened window the rider is still in when the ride ends (#1857)', () => {
    const ride = withoutObstacles({ ...started(), widerWindows: true });
    const first = ride.throwTargets[0] as ThrowTarget;
    // Past the usual window's closing edge, inside the assist's wider one.
    const along = first.along + THROW_WINDOW_AFTER_METRES + 1;
    expect(along).toBeLessThan(first.along + THROW_WINDOW_AFTER_METRES * ASSISTED_THROW_SCALE);
    const riding = rideTo(ride, along).ride;
    expect(endDeliveryRide(riding)).toMatchObject({ delivered: 0, missed: 0 });
    // Without the assist the same place has closed the window: the house is missed.
    const plain = rideTo(withoutObstacles(started()), along).ride;
    expect(endDeliveryRide(plain)).toMatchObject({ delivered: 0, missed: 1 });
  });

  it('leaves the week as it was when the ride ends before any house is reached (#1857)', () => {
    const week: WeekProgress = { day: 2, houses: FIRST_DAY_HOUSES, score: 4 };
    const storage = storageOf({ [DELIVERY_PROGRESS_STORAGE_KEY]: week });
    const ride = started(storage);
    const first = ride.throwTargets[0] as ThrowTarget;
    const short = rideTo(ride, first.along - 30).ride;
    const outcome = endDeliveryRide(short);
    expect(outcome).toMatchObject({ delivered: 0, missed: 0, weekOver: false });
    expect(keepDeliveryWeek(storage, outcome)).toBe(true);
    expect(readDeliveryProgress(storage)).toEqual(week);
  });

  it('keeps the next day’s counts, which a fresh reader of the device reads back', () => {
    const storage = storageOf();
    const ride = rideRound(new Set([2]));
    expect(keepDeliveryWeek(storage, endDeliveryRide(ride))).toBe(true);
    expect(readDeliveryProgress(storage)).toEqual({ day: 2, houses: 7, score: 7 });
    expect([...storage.items.keys()]).toEqual([DELIVERY_PROGRESS_STORAGE_KEY]);
  });

  it('flies every parcel within its flight, so a miss waits a bounded time', () => {
    expect(PARCEL_FLIGHT_TICKS * DELIVERY_TICK_SECONDS).toBeLessThan(2);
  });
});
