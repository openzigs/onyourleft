// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A built-in level's moving hazards — #2364, ADR 0065 D-10.2 and D-10.5 to
 * D-10.10: a dog, a car pulling out and another rider coming the other way,
 * each avoidable, each said in words before it can touch the rider, and
 * none ever entering a lane a standing obstacle blocks.
 *
 * The placements are `placeObstacles`' own, on a level mix with moving
 * hazards in it, at many seeds; the rider is stepped once a tick as the
 * simulation steps them, holding one lane at one steady speed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  deliverySpoken,
  MOVING_HAZARD_AHEAD_METRES,
  NOTHING_OWED,
  obstacleAheadSentence,
  oweObstacleAhead,
} from '../hud/delivery-announce';

import { parseLevelFile } from './levels/level-file';
import {
  AVOIDABLE_FASTEST_METRES_PER_SECOND,
  AVOIDABLE_SLOWEST_METRES_PER_SECOND,
  clearOfParkedCars,
  CRASH_SCORE_DELTA,
  FEWER_OBSTACLES_KEEP_ONE_IN,
  levelObstacleMix,
  MOVING_HAZARD_KINDS,
  MOVING_HAZARD_SIGHT_METRES,
  MOVING_HAZARD_WARNING_SECONDS,
  OBSTACLE_KINDS,
  obstacleAcross,
  obstacleAlong,
  PARKED_CAR_CLEARANCE_METRES,
  parkedCarStands,
  placeObstacles,
  RIDER_BEHIND_METRES,
  RIDER_HALF_WIDTH_METRES,
  startObstacles,
  stepObstacles,
  type Obstacle,
  type ObstacleKind,
} from './obstacles';
import { LANE_OFFSETS_METRES } from './steer';
import { CARRIAGEWAY_HALF_WIDTH_METRES, DELIVERY_TICK_SECONDS } from './throw';

/** The synthetic fixture level (ADR 0065 D-7.5), with moving hazards in its round. */
const FIXTURE = parseLevelFile(
  JSON.parse(
    readFileSync(
      join(fileURLToPath(new URL('./levels/fixtures/', import.meta.url)), 'fixture-level.json'),
      'utf8',
    ),
  ),
  'fixture-level',
);
const MIXES = [
  { static: 2, moving: 2 },
  { static: 1, moving: 4 },
  { static: 0, moving: 3 },
].map((hazardsPerKilometre) => levelObstacleMix({ hazardsPerKilometre }, FIXTURE.lengthMetres));
const SPAN = { from: 0, to: FIXTURE.lengthMetres };
const SEEDS = Array.from({ length: 24 }, (_, index) => (index * 2_654_435_761) >>> 0);

/** Every placement the sweeps read: each mix at each seed, steering, on the normal setting. */
const PLACEMENTS: readonly (readonly Obstacle[])[] = MIXES.flatMap((mix) =>
  SEEDS.map((seed) => placeObstacles(SPAN, seed, 'normal', true, mix)),
);

const isMoving = (obstacle: Obstacle): boolean => MOVING_HAZARD_KINDS.includes(obstacle.kind);

/** Speeds from the slowest avoidable to the fastest, half a metre a second apart, ends included. */
const SPEEDS = Array.from(
  {
    length:
      Math.round(
        (AVOIDABLE_FASTEST_METRES_PER_SECOND - AVOIDABLE_SLOWEST_METRES_PER_SECOND) / 0.5,
      ) + 1,
  },
  (_, index) => AVOIDABLE_SLOWEST_METRES_PER_SECOND + index * 0.5,
);

interface Ridden {
  /** The tick each obstacle, by index, was first owed as a warning; absent if never. */
  readonly warnedAt: ReadonlyMap<number, number>;
  /** The tick each obstacle, by index, was first touched; absent if never. */
  readonly crashedAt: ReadonlyMap<number, number>;
}

/**
 * Ride `obstacles` at a steady `speed` in the lane `lateral` m right of the
 * centre, from `from` to `to`, a tick at a time; each warning owed is said at
 * once, as a quiet live region would say it.
 */
function ride(
  obstacles: readonly Obstacle[],
  speed: number,
  lateral: number,
  from: number,
  to: number,
): Ridden {
  let state = startObstacles(obstacles);
  let owed = NOTHING_OWED;
  const warnedAt = new Map<number, number>();
  const crashedAt = new Map<number, number>();
  let along = from;
  for (let tick = 1; along < to; tick += 1) {
    along += speed * DELIVERY_TICK_SECONDS;
    const before = state.crashed;
    const step = stepObstacles(state, { rider: { along, lateral, speed }, obstacles });
    state = step.state;
    state.crashed.forEach((crashed, index) => {
      if (crashed && before[index] !== true) crashedAt.set(index, tick);
    });
    owed = oweObstacleAhead(owed, obstacles, along);
    if (owed.ahead !== undefined) {
      if (!warnedAt.has(owed.ahead.index)) warnedAt.set(owed.ahead.index, tick);
      owed = deliverySpoken(owed, 'delivery-obstacle-ahead');
    }
  }
  return { warnedAt, crashedAt };
}

/** One hazard alone, ridden from out of its sight to past it. */
function rideAlone(hazard: Obstacle, speed: number, lateral: number): boolean {
  const { crashedAt } = ride(
    [hazard],
    speed,
    lateral,
    hazard.along - MOVING_HAZARD_SIGHT_METRES - 1,
    hazard.along + 5,
  );
  return crashedAt.size > 0;
}

describe('the moving hazards are placed on a level — #2364', () => {
  it('places every kind, from both kerbs, only where the level asks for them', () => {
    const moving = PLACEMENTS.flat().filter(isMoving);
    expect(new Set(moving.map((hazard) => hazard.kind))).toStrictEqual(
      new Set(MOVING_HAZARD_KINDS),
    );
    expect(new Set(moving.map((hazard) => hazard.from))).toStrictEqual(new Set(['left', 'right']));
    // None on a rider's own route, and none on a level that asks for none.
    for (const seed of SEEDS) {
      expect(placeObstacles({ from: 0, to: 5_000 }, seed, 'normal', true).filter(isMoving)).toEqual(
        [],
      );
      const still = levelObstacleMix({ hazardsPerKilometre: { static: 2, moving: 0 } }, 3_000);
      expect(placeObstacles(SPAN, seed, 'normal', true, still).filter(isMoving)).toEqual([]);
    }
  });

  it('brings each one onto the carriageway from off it, never into a lane from nowhere', () => {
    for (const hazard of PLACEMENTS.flat().filter(isMoving)) {
      const shape = OBSTACLE_KINDS[hazard.kind];
      const start = obstacleAcross(hazard, 0);
      // Its whole width off the carriageway, on its own kerb's side.
      expect(Math.abs(start) - shape.halfWidth).toBeGreaterThanOrEqual(
        CARRIAGEWAY_HALF_WIDTH_METRES - 1e-9,
      );
      expect(Math.sign(start)).toBe(hazard.from === 'left' ? -1 : 1);
    }
  });

  it('keeps the assist’s “fewer” to one in FEWER_OBSTACLES_KEEP_ONE_IN, each where it was, and “none” to none', () => {
    for (const mix of MIXES) {
      for (const seed of SEEDS) {
        const normal = placeObstacles(SPAN, seed, 'normal', true, mix);
        const fewer = placeObstacles(SPAN, seed, 'fewer', true, mix);
        expect(fewer).toStrictEqual(
          normal.filter((_, slot) => slot % FEWER_OBSTACLES_KEEP_ONE_IN === 0),
        );
        expect(placeObstacles(SPAN, seed, 'none', true, mix)).toEqual([]);
      }
    }
    expect(PLACEMENTS.flat().filter(isMoving).length).toBeGreaterThan(30);
  });
});

describe('every moving hazard is avoidable — #2364, ADR 0065 D-10.8', () => {
  it('leaves a clear lane at every speed from the slowest avoidable to the fastest', () => {
    const hit = new Set<ObstacleKind>();
    for (const hazard of PLACEMENTS.flat().filter(isMoving)) {
      for (const speed of SPEEDS) {
        const crashes = LANE_OFFSETS_METRES.map((lane) => rideAlone(hazard, speed, lane));
        expect(
          crashes.includes(false),
          `a ${hazard.kind} leaves no clear lane at ${String(speed)} m/s`,
        ).toBe(true);
        if (crashes.includes(true)) hit.add(hazard.kind);
      }
    }
    // Each kind is a hazard: somewhere, at some speed, a lane meets it.
    expect(hit).toStrictEqual(new Set(MOVING_HAZARD_KINDS));
  });

  it('rides another rider toward the rider once in their lane, so the two meet short of where they came out', () => {
    const riders = PLACEMENTS.flat().filter((each) => each.kind === 'oncoming-rider');
    expect(riders.length).toBeGreaterThan(0);
    for (const hazard of riders) {
      // Still at the kerb on the first tick, then in the lane and coming on.
      expect(obstacleAlong(hazard, 0)).toBe(hazard.along);
      expect(obstacleAlong(hazard, 4)).toBeLessThan(hazard.along - 10);
      expect(obstacleAcross(hazard, 4)).toBe(hazard.to);
      // Met in their lane at the slowest speed well before the place they came out at.
      const speed = AVOIDABLE_SLOWEST_METRES_PER_SECOND;
      const from = hazard.along - MOVING_HAZARD_SIGHT_METRES - 1;
      const { crashedAt } = ride([hazard], speed, hazard.to as number, from, hazard.along + 5);
      const tick = crashedAt.get(0);
      expect(tick).toBeDefined();
      expect(from + (tick ?? 0) * speed * DELIVERY_TICK_SECONDS).toBeLessThan(hazard.along - 30);
    }
  });

  it('draws a crash into a car pulling out as one into a parked car: the rider moved to its road side', () => {
    const car: Obstacle = {
      kind: 'car-pulling-out',
      along: 500,
      from: 'right',
      startAfter: 0,
      to: parkedCarStands('right'),
      rides: 0,
    };
    const lane = LANE_OFFSETS_METRES.length - 1;
    const lateral = LANE_OFFSETS_METRES[lane] as number;
    let state = startObstacles([car]);
    let along = car.along - MOVING_HAZARD_SIGHT_METRES;
    while (state.crashed[0] !== true) {
      along += 6 * DELIVERY_TICK_SECONDS;
      state = stepObstacles(state, { rider: { along, lateral, speed: 6 }, obstacles: [car] }).state;
      expect(along).toBeLessThan(car.along + 5);
    }
    const reach = OBSTACLE_KINDS['car-pulling-out'].halfWidth + RIDER_HALF_WIDTH_METRES;
    expect(clearOfParkedCars([car], state, { along, lane, offset: lateral })).toStrictEqual({
      lane,
      offset: parkedCarStands('right') - reach - PARKED_CAR_CLEARANCE_METRES,
    });
  });

  it('costs a crash its one point and nothing else', () => {
    const [hazard] = PLACEMENTS.flat().filter((each) => each.kind === 'oncoming-rider');
    if (hazard === undefined) throw new Error('no rider coming the other way was placed');
    const lane = hazard.to as number;
    let state = startObstacles([hazard]);
    const crashes = [];
    for (
      let along = hazard.along - MOVING_HAZARD_SIGHT_METRES;
      along < hazard.along;
      along += 0.4
    ) {
      const step = stepObstacles(state, {
        rider: { along, lateral: lane, speed: 8 },
        obstacles: [hazard],
      });
      state = step.state;
      crashes.push(...step.crashes);
    }
    expect(crashes).toStrictEqual([{ scoreDelta: CRASH_SCORE_DELTA }]);
  });
});

describe('every moving hazard is said before it can touch the rider — #2364, ADR 0065 D-10.9', () => {
  it(
    `owes its warning at least MOVING_HAZARD_WARNING_SECONDS (${String(MOVING_HAZARD_WARNING_SECONDS)} s) before its earliest contact, at every speed and lane`,
    { timeout: 60_000 },
    () => {
      const met = new Set<ObstacleKind>();
      let least = Infinity;
      for (const placed of PLACEMENTS) {
        placed.forEach((hazard, index) => {
          if (!isMoving(hazard)) return;
          // Every obstacle the rider meets on the way, a standing one ahead of it
          // among them, so a warning waiting behind another is counted as late.
          const from = hazard.along - MOVING_HAZARD_SIGHT_METRES - 80;
          // A metre a second apart, the fastest included: it is the latest warning.
          for (const speed of SPEEDS.filter((each) => Number.isInteger(each))) {
            for (const lane of LANE_OFFSETS_METRES) {
              const { warnedAt, crashedAt } = ride(placed, speed, lane, from, hazard.along + 5);
              const crashed = crashedAt.get(index);
              if (crashed === undefined) continue;
              met.add(hazard.kind);
              const warned = warnedAt.get(index);
              expect(warned, `a ${hazard.kind} met unsaid`).toBeDefined();
              const lead = (crashed - (warned ?? crashed)) * DELIVERY_TICK_SECONDS;
              least = Math.min(least, lead);
              expect(lead, `a ${hazard.kind} at ${String(speed)} m/s`).toBeGreaterThanOrEqual(
                MOVING_HAZARD_WARNING_SECONDS,
              );
            }
          }
        });
      }
      expect(met).toStrictEqual(new Set(MOVING_HAZARD_KINDS));
      expect(least).toBeLessThan(Infinity);
    },
  );

  it('says it where it is set going, in words that name where it comes from', () => {
    expect(MOVING_HAZARD_AHEAD_METRES).toBe(MOVING_HAZARD_SIGHT_METRES);
    const said = new Map<ObstacleKind, Set<string>>();
    for (const hazard of PLACEMENTS.flat().filter(isMoving)) {
      const words = said.get(hazard.kind) ?? new Set<string>();
      words.add(obstacleAheadSentence(hazard));
      said.set(hazard.kind, words);
    }
    expect([...(said.get('dog') ?? [])].sort()).toStrictEqual([
      'A dog ahead, from the left.',
      'A dog ahead, from the right.',
    ]);
    expect([...(said.get('car-pulling-out') ?? [])].sort()).toStrictEqual([
      'A car pulling out ahead, on the left.',
      'A car pulling out ahead, on the right.',
    ]);
    expect([...(said.get('oncoming-rider') ?? [])].sort()).toStrictEqual([
      'A rider coming the other way, in the left lane.',
      'A rider coming the other way, in the right lane.',
    ]);
  });
});

describe('no moving hazard enters a lane a standing obstacle blocks — #2364', () => {
  it('finds no distance where a moving hazard and a standing obstacle hold one lane, at any speed', () => {
    let swept = 0;
    for (const placed of PLACEMENTS) {
      const standing = placed.filter((obstacle) => obstacle.stands !== undefined);
      for (const hazard of placed.filter(isMoving)) {
        const shape = OBSTACLE_KINDS[hazard.kind];
        for (const speed of [
          AVOIDABLE_SLOWEST_METRES_PER_SECOND,
          AVOIDABLE_FASTEST_METRES_PER_SECOND,
        ]) {
          // From the moment it is set going until the rider, in the middle of
          // the road, has passed it: where it is, along and across.
          let along = hazard.along - MOVING_HAZARD_SIGHT_METRES;
          for (let seconds = 0; ; seconds += DELIVERY_TICK_SECONDS) {
            const at = obstacleAlong(hazard, seconds);
            if (along - RIDER_BEHIND_METRES > at + shape.halfLength) break;
            const across = obstacleAcross(hazard, seconds);
            swept += 1;
            for (const other of standing) {
              const otherShape = OBSTACLE_KINDS[other.kind];
              const sameStretch =
                Math.abs(at - other.along) < shape.halfLength + otherShape.halfLength;
              const sameLane =
                Math.abs(across - other.stands) <
                shape.halfWidth + otherShape.halfWidth + 2 * RIDER_HALF_WIDTH_METRES;
              expect(
                sameStretch && sameLane,
                `a ${hazard.kind} meets a standing ${other.kind}`,
              ).toBe(false);
            }
            along += speed * DELIVERY_TICK_SECONDS;
          }
        }
      }
    }
    expect(swept).toBeGreaterThan(1_000);
  });
});
