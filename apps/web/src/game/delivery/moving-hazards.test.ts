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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  deliverySpoken,
  MOVING_HAZARD_AHEAD_METRES,
  NOTHING_OWED,
  OBSTACLE_AHEAD_METRES,
  obstacleAheadSentence,
  oweObstacleAhead,
} from '../hud/delivery-announce';

import { parseLevelFile } from './levels/level-file';
import {
  AVOIDABLE_FASTEST_METRES_PER_SECOND,
  AVOIDABLE_SLOWEST_METRES_PER_SECOND,
  carPullingOut,
  clearOfParkedCars,
  CRASH_SCORE_DELTA,
  drawnObstacleAcross,
  FEWER_OBSTACLES_KEEP_ONE_IN,
  levelObstacleMix,
  MOVING_HAZARD_KINDS,
  MOVING_HAZARD_SIGHT_METRES,
  MOVING_HAZARD_WARNING_SECONDS,
  OBSTACLE_KINDS,
  obstacleAcross,
  obstacleAlong,
  obstacleFootprint,
  ONCOMING_PASSING_GAP_METRES,
  ONCOMING_RIDER_METRES_PER_SECOND,
  ONCOMING_SWERVE_METRES,
  ONCOMING_SWERVE_SECONDS,
  PARKED_CAR_CLEARANCE_METRES,
  parkedCarStands,
  placeObstacles,
  PULL_OUT_RUN_METRES,
  PULL_OUT_SECONDS,
  PULL_OUT_STEER_READY_SECONDS,
  RIDER_AHEAD_METRES,
  RIDER_BEHIND_METRES,
  RIDER_HALF_WIDTH_METRES,
  startObstacles,
  stepObstacles,
  type LaneObstacle,
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
/**
 * #2367: every shipped level's own densities that place a moving hazard, read
 * for their parameters only (ADR 0065 D-6.4, D-7.5) and placed over the
 * fixture's span, so each sweep below runs over every shipped level's mix.
 */
const LEVEL_DATA = fileURLToPath(new URL('./levels/data/', import.meta.url));
const SHIPPED_HAZARDS = readdirSync(LEVEL_DATA)
  .filter((name) => name.endsWith('.json'))
  .map(
    (name) =>
      parseLevelFile(JSON.parse(readFileSync(join(LEVEL_DATA, name), 'utf8')), name.slice(0, -5))
        .round.hazardsPerKilometre,
  )
  .filter((hazards) => hazards.moving > 0);
const mixOf = (hazardsPerKilometre: { static: number; moving: number }) =>
  levelObstacleMix({ hazardsPerKilometre }, FIXTURE.lengthMetres);
const MIXES = [
  { static: 2, moving: 2 },
  { static: 1, moving: 4 },
  { static: 0, moving: 3 },
].map(mixOf);
const SHIPPED_MIXES = SHIPPED_HAZARDS.map(mixOf);
const SPAN = { from: 0, to: FIXTURE.lengthMetres };
const SEEDS = Array.from({ length: 24 }, (_, index) => (index * 2_654_435_761) >>> 0);
/**
 * #2367: a shipped level's mix at a sixth of the seeds. Each sweep below reads
 * one hazard at a time, so a mix adds only its own placements. The clear-lane
 * sweep, on the Mac, Node 26: 731 ms on main, 1 636 ms with `--coverage`; at
 * all 24 seeds 1 193 ms without coverage; at 8, 886 ms and 2 177 ms with it;
 * at these 4, 782 ms and 1 897 ms (#1688: make a case cheaper, never give it
 * longer).
 */
const SHIPPED_SEEDS = SEEDS.slice(0, 4);

/** Every placement the sweeps read: each mix at each of its seeds, steering, on the normal setting. */
const PLACEMENTS: readonly (readonly Obstacle[])[] = [
  ...MIXES.flatMap((mix) => SEEDS.map((seed) => placeObstacles(SPAN, seed, 'normal', true, mix))),
  ...SHIPPED_MIXES.flatMap((mix) =>
    SHIPPED_SEEDS.map((seed) => placeObstacles(SPAN, seed, 'normal', true, mix)),
  ),
];

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

/**
 * One hazard alone, ridden from out of its sight to past it: whether the rider
 * touches it. #3036: `ride`'s loop, stepped through `stepObstacles` as the
 * simulation steps it, but it says no warnings, which this answer never read,
 * and stops at the first touch, after which the answer cannot change.
 */
function rideAlone(hazard: Obstacle, speed: number, lateral: number): boolean {
  const obstacles = [hazard];
  let state = startObstacles(obstacles);
  const to = hazard.along + 5;
  for (let along = hazard.along - MOVING_HAZARD_SIGHT_METRES - 1; along < to;) {
    along += speed * DELIVERY_TICK_SECONDS;
    const step = stepObstacles(state, { rider: { along, lateral, speed }, obstacles });
    if (step.crashes.length > 0) return true;
    state = step.state;
  }
  return false;
}

describe('the moving hazards are placed on a level — #2364', () => {
  it('places every kind, from both kerbs, only where the level asks for them', () => {
    // #2367: levels 3 to 6 each ask for moving hazards, and each is swept.
    expect(SHIPPED_HAZARDS.length).toBeGreaterThanOrEqual(4);
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
    for (const mix of [...MIXES, ...SHIPPED_MIXES]) {
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
        // #3036: the lanes in order, up to the first clear one, which is all
        // the clear-lane answer needs; every lane while this kind has not yet
        // been seen to meet a lane, so the hit set below reads what it read.
        let clear = false;
        for (const lane of LANE_OFFSETS_METRES) {
          if (rideAlone(hazard, speed, lane)) hit.add(hazard.kind);
          else clear = true;
          if (clear && hit.has(hazard.kind)) break;
        }
        expect(clear, `a ${hazard.kind} leaves no clear lane at ${String(speed)} m/s`).toBe(true);
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
    const moved = clearOfParkedCars([car], state, { along, lane, offset: lateral });
    expect(moved?.lane).toBe(lane);
    // To the nanometre: worked from the car's corners, its sums run in another order.
    expect(moved?.offset).toBeCloseTo(
      parkedCarStands('right') - reach - PARKED_CAR_CLEARANCE_METRES,
      9,
    );
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
  // #1688's ruling: cheaper, never a longer timeout. Each ride here was the
  // whole placement's, from 170 m short of the hazard, in all three lanes,
  // with two `expect`s a crash. Every cut below leaves the warning and the
  // crash this case reads on the same tick, so it reads what it read:
  //
  // - **Only the obstacles between the ride's start and the hazard.** One is
  //   owed only while ahead of the rider and in its reach, the nearest first,
  //   and each is said the tick it is owed; a hazard's reach is the longest,
  //   so one further along is never owed before it, and one behind the start
  //   never at all. A crash is each obstacle's own (`stepObstacles`).
  // - **From a metre before the nearest of those can be seen or said.**
  //   Before it nothing is set going and nothing is owed; the rider's
  //   distance is still summed a tick at a time from the same start, so each
  //   tick is where it was. The metre is for rounding: `stepObstacles` and
  //   `oweObstacleAhead` test the same edge by two different subtractions,
  //   and without it one dog's warning, a tick ahead of its start, was lost.
  // - **Only the lanes the hazard can reach.** It moves across from one kerb
  //   toward its lane or the far kerb and no further, so a lane further from
  //   that span than their two half-widths is never touched.
  // - **One `expect` for the lot**: each late warning is written down, and the
  //   case asserts there are none, naming each one if there are.
  //
  // Every crash at every speed and lane, and its lead, is the same 3 028 as
  // before. On this Mac, Node 26: 3 050–3 541 ms → 262–340 ms without
  // coverage, 9 424–10 844 ms → 749–838 ms with `--coverage`; at a load
  // average near 45, 16–17 s → 0.3–1.4 s and 42–47 s → 1.0–1.2 s.
  it(`owes its warning at least MOVING_HAZARD_WARNING_SECONDS (${String(MOVING_HAZARD_WARNING_SECONDS)} s) before its earliest contact, at every speed and lane`, () => {
    const met = new Set<ObstacleKind>();
    const late: string[] = [];
    let least = Infinity;
    for (const placed of PLACEMENTS) {
      placed.forEach((hazard, index) => {
        if (!isMoving(hazard)) return;
        // Every obstacle the rider meets on the way, a standing one ahead of it
        // among them, so a warning waiting behind another is counted as late.
        const from = hazard.along - MOVING_HAZARD_SIGHT_METRES - 80;
        const near = placed.filter(
          (each, slot) => slot === index || (each.along > from && each.along <= hazard.along),
        );
        const at = near.indexOf(hazard);
        const sighted =
          Math.min(...near.map((each) => each.along)) -
          Math.max(MOVING_HAZARD_SIGHT_METRES, MOVING_HAZARD_AHEAD_METRES, OBSTACLE_AHEAD_METRES) -
          1;
        const shape = OBSTACLE_KINDS[hazard.kind];
        const [first, last] = [obstacleAcross(hazard, 0), obstacleAcross(hazard, Infinity)];
        const lanes = LANE_OFFSETS_METRES.filter(
          (lane) =>
            Math.abs(
              lane - Math.min(Math.max(lane, Math.min(first, last)), Math.max(first, last)),
            ) <=
            shape.halfWidth + RIDER_HALF_WIDTH_METRES,
        );
        // A metre a second apart, the fastest included: it is the latest warning.
        for (const speed of SPEEDS.filter((each) => Number.isInteger(each))) {
          let start = from;
          while (start + speed * DELIVERY_TICK_SECONDS < sighted) {
            start += speed * DELIVERY_TICK_SECONDS;
          }
          for (const lane of lanes) {
            const { warnedAt, crashedAt } = ride(near, speed, lane, start, hazard.along + 5);
            const crashed = crashedAt.get(at);
            if (crashed === undefined) continue;
            met.add(hazard.kind);
            const warned = warnedAt.get(at);
            const lead = (crashed - (warned ?? Infinity)) * DELIVERY_TICK_SECONDS;
            least = Math.min(least, lead);
            if (!(lead >= MOVING_HAZARD_WARNING_SECONDS)) {
              late.push(
                warned === undefined
                  ? `a ${hazard.kind} met unsaid`
                  : `a ${hazard.kind} at ${String(speed)} m/s said ${String(lead)} s ahead`,
              );
            }
          }
        }
      });
    }
    expect(late).toStrictEqual([]);
    expect(met).toStrictEqual(new Set(MOVING_HAZARD_KINDS));
    expect(least).toBeLessThan(Infinity);
  });

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
  // #2497's CI timed this case out at 5 s under coverage: it swept every tick
  // twice, once a speed, and called `expect` once a tick for every standing
  // obstacle in the placement, near or not. It now checks the same positions
  // against the same obstacles, each once:
  //
  // - **One speed covers every speed.** Where a hazard is depends on the
  //   seconds since it was set going and not on the rider, and both speeds
  //   walk the same ticks from nought. The sweep stops at the first tick K at
  //   which the rider, at `start + speed·K·tick`, is past the hazard; that
  //   sum grows with speed, so at the slowest speed's K any faster rider is
  //   past it too, and every faster speed stops at or before it. The slowest
  //   speed's ticks hold every tick any avoidable speed sweeps (#1688).
  // - **Only a standing obstacle the hazard can reach along the road is
  //   compared.** Two obstacles in different stretches cannot share a lane, so
  //   one further along than the hazard's whole path, by more than their two
  //   half-lengths, is the same `false` it was.
  // - **One `expect` for the lot**: each meeting is written down, and the case
  //   asserts there are none, naming each one if there are.
  //
  // Counted on this commit: 414 placed hazards; 256 950 positions over the two
  // speeds before, 198 898 now, the faster speed's 58 052 each among them; and
  // 444 936 `expect` calls before, one now. Placement keeps every standing
  // obstacle out of a hazard's stretch, so none passes the reach filter here:
  // a placement that put one beside a hazard's path would, and is red.
  it('finds no distance where a moving hazard and a standing obstacle hold one lane, at any speed', () => {
    const meetings: string[] = [];
    let swept = 0;
    for (const placed of PLACEMENTS) {
      const standing = placed.filter((obstacle) => obstacle.stands !== undefined);
      for (const hazard of placed.filter(isMoving)) {
        const shape = OBSTACLE_KINDS[hazard.kind];
        // From the moment it is set going until a rider at the slowest
        // avoidable speed, in the middle of the road, has passed it: where it
        // is, along and across.
        const path: (readonly [number, number])[] = [];
        let along = hazard.along - MOVING_HAZARD_SIGHT_METRES;
        for (let seconds = 0; ; seconds += DELIVERY_TICK_SECONDS) {
          const at = obstacleAlong(hazard, seconds);
          if (along - RIDER_BEHIND_METRES > at + shape.halfLength) break;
          path.push([at, obstacleAcross(hazard, seconds)]);
          along += AVOIDABLE_SLOWEST_METRES_PER_SECOND * DELIVERY_TICK_SECONDS;
        }
        swept += path.length;
        const ats = path.map(([at]) => at);
        const nearest = Math.min(...ats);
        const furthest = Math.max(...ats);
        for (const other of standing) {
          const otherShape = OBSTACLE_KINDS[other.kind];
          const reach = shape.halfLength + otherShape.halfLength;
          if (other.along <= nearest - reach || other.along >= furthest + reach) continue;
          const width = shape.halfWidth + otherShape.halfWidth + 2 * RIDER_HALF_WIDTH_METRES;
          for (const [at, across] of path) {
            const sameStretch = Math.abs(at - other.along) < reach;
            const sameLane = Math.abs(across - other.stands) < width;
            if (sameStretch && sameLane) {
              meetings.push(`a ${hazard.kind} at ${hazard.along} m meets a standing ${other.kind}`);
              break;
            }
          }
        }
      }
    }
    expect(meetings).toStrictEqual([]);
    expect(swept).toBeGreaterThan(1_000);
  });
});

/**
 * A car pulling out DRIVES out. Until this it crossed its way sideways,
 * facing along the road with its wheels still: the owner, on the tablet,
 * "just slid sideways onto the road with a strange animation".
 */
describe('a car pulling out drives out, forward and across together', () => {
  const WAIT = 1.5;
  const cars: readonly LaneObstacle[] = (['left', 'right'] as const).map((from) => ({
    kind: 'car-pulling-out',
    along: 500,
    from,
    startAfter: WAIT,
    to: parkedCarStands(from),
    rides: 0,
  }));
  const CAR = OBSTACLE_KINDS['car-pulling-out'];
  /** Every tick from when it is set going until a second after it is out. */
  const TICKS = Array.from(
    { length: Math.round((WAIT + PULL_OUT_SECONDS + 1) / DELIVERY_TICK_SECONDS) + 1 },
    (_, tick) => tick * DELIVERY_TICK_SECONDS,
  );

  it.each(cars)(
    'waits off the kerb a run short of its place, and stops in its lane, straight ($from)',
    (car) => {
      const waiting = carPullingOut(car, 0);
      expect(waiting.along).toBeCloseTo(car.along - PULL_OUT_RUN_METRES, 9);
      // Its whole width clear of the carriageway, parallel to the road, standing.
      expect(Math.abs(waiting.across) - CAR.halfWidth).toBeGreaterThanOrEqual(
        CARRIAGEWAY_HALF_WIDTH_METRES - 1e-9,
      );
      expect(Math.sign(waiting.across)).toBe(car.from === 'left' ? -1 : 1);
      expect(waiting).toMatchObject({ heading: 0, speed: 0, travelled: 0, braking: 0 });
      // Still there the moment before it sets off.
      expect(carPullingOut(car, WAIT).along).toBeCloseTo(waiting.along, 9);
      const out = carPullingOut(car, WAIT + PULL_OUT_SECONDS);
      expect(out.along).toBeCloseTo(car.along, 9);
      expect(out.across).toBeCloseTo(car.to, 9);
      expect(out.heading).toBeCloseTo(0, 9);
      expect(out.speed).toBeCloseTo(0, 9);
      expect(out.braking).toBe(0);
      expect(out.travelled).toBeCloseTo(PULL_OUT_RUN_METRES, 9);
      // Its wheels straight as it stands, and a second later.
      expect(out.steer).toBeCloseTo(0, 6);
      expect(carPullingOut(car, WAIT + PULL_OUT_SECONDS + 1).steer).toBeCloseTo(0, 6);
      // And what meets the rider is that place.
      expect(obstacleAlong(car, WAIT + PULL_OUT_SECONDS)).toBe(out.along);
      expect(obstacleAcross(car, WAIT + PULL_OUT_SECONDS)).toBe(out.across);
      expect(obstacleAlong(car, 0)).toBe(waiting.along);
      expect(obstacleAcross(car, 0)).toBe(waiting.across);
    },
  );

  it.each(cars)('never moves across the road without moving further along it ($from)', (car) => {
    let moved = 0;
    for (let at = 1; at < TICKS.length; at += 1) {
      const before = carPullingOut(car, TICKS[at - 1] as number);
      const now = carPullingOut(car, TICKS[at] as number);
      const across = Math.abs(now.across - before.across);
      const along = now.along - before.along;
      expect(along).toBeGreaterThanOrEqual(0);
      // Toward the road, never back.
      expect(Math.abs(now.across)).toBeLessThanOrEqual(Math.abs(before.across) + 1e-12);
      if (across < 1e-9) continue;
      moved += 1;
      // At most 21 degrees off the road: tan 21 = 0.384.
      expect(across / along).toBeLessThan(0.384);
    }
    // Not vacuous: it was moving for the whole of its way out.
    expect(moved).toBeGreaterThanOrEqual(Math.round(PULL_OUT_SECONDS / DELIVERY_TICK_SECONDS) - 2);
  });

  it.each(cars)(
    'points its nose the way it is going, and steers into the road and back out ($from)',
    (car) => {
      const towardRight = car.from === 'left' ? 1 : -1;
      let turned = 0;
      for (let at = 1; at < TICKS.length; at += 1) {
        const before = carPullingOut(car, (TICKS[at] as number) - 1e-4);
        const after = carPullingOut(car, (TICKS[at] as number) + 1e-4);
        const now = carPullingOut(car, TICKS[at] as number);
        if (after.along - before.along < 1e-7) continue;
        const going = Math.atan2(after.across - before.across, after.along - before.along);
        expect(now.heading).toBeCloseTo(going, 3);
        turned = Math.max(turned, towardRight * now.heading);
        // Under a road car's full lock (`three-renderer.ts` MOST_STEER_RADIANS, 0.6).
        expect(Math.abs(now.steer)).toBeLessThan(0.6);
      }
      expect(turned).toBeGreaterThan((15 * Math.PI) / 180);
      expect(turned).toBeLessThan((21 * Math.PI) / 180);
      // A steer to the car's own left is positive: from the left kerb it turns right first.
      const first = carPullingOut(car, WAIT + 0.2 * PULL_OUT_SECONDS);
      const last = carPullingOut(car, WAIT + 0.8 * PULL_OUT_SECONDS);
      expect(Math.sign(first.steer)).toBe(-towardRight);
      expect(Math.sign(last.steer)).toBe(towardRight);
      expect(Math.abs(first.steer)).toBeGreaterThan(0.15);
      // Braking only on the second half of its way, and its speed a car's nosing out.
      expect(first.braking).toBe(0);
      expect(last.braking).toBeGreaterThan(0.5);
      const fastest = Math.max(...TICKS.map((seconds) => carPullingOut(car, seconds).speed));
      expect(fastest).toBeGreaterThan(3);
      expect(fastest).toBeLessThan(4.5);
    },
  );

  it('turns its front wheels toward the road before it moves, and not while it only waits', () => {
    const car = cars[0] as LaneObstacle;
    expect(carPullingOut(car, 0).steer).toBe(0);
    expect(carPullingOut(car, WAIT - PULL_OUT_STEER_READY_SECONDS).steer).toBeCloseTo(0, 9);
    const half = carPullingOut(car, WAIT - PULL_OUT_STEER_READY_SECONDS / 2).steer;
    const ready = carPullingOut(car, WAIT).steer;
    const moving = carPullingOut(car, WAIT + 1e-6).steer;
    expect(Math.abs(ready)).toBeGreaterThan(0.3);
    expect(half).toBeCloseTo(ready / 2, 6);
    // No jump as it sets off.
    expect(moving).toBeCloseTo(ready, 4);
  });

  it('turns its wheels in over all the time it has when it sets off sooner than that', () => {
    const soon = { ...(cars[0] as LaneObstacle), startAfter: PULL_OUT_STEER_READY_SECONDS / 4 };
    // Straight the moment it is set going, as the view draws it until then.
    expect(carPullingOut(soon, 0).steer).toBeCloseTo(0, 9);
    const ready = carPullingOut(soon, soon.startAfter).steer;
    expect(Math.abs(ready)).toBeGreaterThan(0.3);
    expect(carPullingOut(soon, soon.startAfter / 2).steer).toBeCloseTo(ready / 2, 6);
    // Set going and off at once: there is no time to turn them in.
    const now = { ...soon, startAfter: 0 };
    expect(carPullingOut(now, 0).steer).toBeCloseTo(ready, 9);
  });

  /** The car's four corners as it is drawn, worked here from its middle and heading. */
  function drawnCorners(at: {
    readonly along: number;
    readonly across: number;
    readonly heading: number;
  }): readonly Point[] {
    return (
      [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ] as const
    ).map(([forward, side]) => [
      at.along +
        forward * CAR.halfLength * Math.cos(at.heading) -
        side * CAR.halfWidth * Math.sin(at.heading),
      at.across +
        forward * CAR.halfLength * Math.sin(at.heading) +
        side * CAR.halfWidth * Math.cos(at.heading),
    ]);
  }

  /** A box along the road's four corners, in order round it. */
  function boxCorners(back: number, front: number, low: number, high: number): readonly Point[] {
    return [
      [back, low],
      [front, low],
      [front, high],
      [back, high],
    ];
  }

  /** The step's verdict for a still rider `along`, `lateral`, at `seconds` after it was set going. */
  function stepMeets(car: LaneObstacle, seconds: number, along: number, lateral: number): boolean {
    const tick = Math.round(seconds / DELIVERY_TICK_SECONDS);
    const state = { tick: tick - 1, startedAt: [0], crashed: [false] };
    const step = stepObstacles(state, {
      rider: { along, lateral, speed: 0 },
      obstacles: [car],
    });
    return step.crashes.length > 0;
  }

  it('meets a rider where the drawn turned car is, and only there', () => {
    const car = { ...(cars[0] as LaneObstacle), startAfter: 0 };
    // Half way out, turned its most.
    const seconds =
      Math.round(PULL_OUT_SECONDS / 2 / DELIVERY_TICK_SECONDS) * DELIVERY_TICK_SECONDS;
    const at = carPullingOut(car, seconds);
    expect(at.heading).toBeGreaterThan((20 * Math.PI) / 180);
    const corners = drawnCorners(at);
    // What meets the rider is the drawn car: its place and its heading.
    expect(obstacleFootprint(car, seconds)).toStrictEqual({
      along: at.along,
      across: at.across,
      heading: at.heading,
      halfLength: CAR.halfLength,
      halfWidth: CAR.halfWidth,
    });
    // A rider whose near side is between the roster box's road side and the
    // turned nose's: beside the nose, where a box along the road would not reach.
    const nose = at.across + CAR.halfWidth + RIDER_HALF_WIDTH_METRES + 0.3;
    expect(stepMeets(car, seconds, at.along + CAR.halfLength, nose)).toBe(true);
    // A rider beside the tail on the road side, whom a box grown to hold the
    // whole turned car would have reached, clears it.
    const front = at.along - 0.5;
    const tailSide = Math.max(
      ...corners.filter(([along]) => along <= front).map(([, across]) => across),
      // The road-side long edge, where it crosses the rider's front.
      (corners[3] as Point)[1] + (front - (corners[3] as Point)[0]) * Math.tan(at.heading),
    );
    const grownHigh = Math.max(...corners.map(([, across]) => across));
    const tail = tailSide + RIDER_HALF_WIDTH_METRES + 0.05;
    expect(tail - RIDER_HALF_WIDTH_METRES).toBeLessThan(grownHigh - 0.3);
    expect(stepMeets(car, seconds, front - RIDER_AHEAD_METRES, tail)).toBe(false);
    // Everywhere around it, the step agrees with the drawn car's own outline.
    let met = 0;
    let missed = 0;
    const disagree: string[] = [];
    for (let along = at.along - 4.03; along < at.along + 4; along += 0.13) {
      for (let lateral = at.across - 2.51; lateral < at.across + 2.5; lateral += 0.07) {
        const drawn = outlinesMeet(
          corners,
          boxCorners(
            along - RIDER_BEHIND_METRES,
            along + RIDER_AHEAD_METRES,
            lateral - RIDER_HALF_WIDTH_METRES,
            lateral + RIDER_HALF_WIDTH_METRES,
          ),
        );
        if (stepMeets(car, seconds, along, lateral) !== drawn) {
          disagree.push(`${along.toFixed(2)} along, ${lateral.toFixed(2)} across`);
        }
        if (drawn) met += 1;
        else missed += 1;
      }
    }
    expect(disagree).toStrictEqual([]);
    expect(met).toBeGreaterThan(200);
    expect(missed).toBeGreaterThan(200);
    // Straight, before it sets off: the roster's own box, as any other kind's.
    expect(obstacleFootprint(car, 0)).toMatchObject({
      heading: 0,
      halfLength: CAR.halfLength,
      halfWidth: CAR.halfWidth,
    });
    const dog: Obstacle = { kind: 'dog', along: 500, from: 'left', startAfter: 0 };
    expect(obstacleFootprint(dog, 1)).toStrictEqual({
      along: obstacleAlong(dog, 1),
      across: obstacleAcross(dog, 1),
      heading: 0,
      halfLength: OBSTACLE_KINDS.dog.halfLength,
      halfWidth: OBSTACLE_KINDS.dog.halfWidth,
    });
  });

  /** A rider at `along` drawn at `offset` stands its clearance off the drawn car, to the millimetre. */
  function expectHeldAtClearance(
    at: Parameters<typeof drawnCorners>[0],
    along: number,
    offset: number,
  ): void {
    const rider = (spare: number): readonly Point[] =>
      boxCorners(
        along - RIDER_BEHIND_METRES,
        along + RIDER_AHEAD_METRES,
        offset - RIDER_HALF_WIDTH_METRES - spare,
        offset + RIDER_HALF_WIDTH_METRES + spare,
      );
    expect(outlinesMeet(drawnCorners(at), rider(PARKED_CAR_CLEARANCE_METRES - 1e-3))).toBe(false);
    expect(outlinesMeet(drawnCorners(at), rider(PARKED_CAR_CLEARANCE_METRES + 1e-3))).toBe(true);
  }

  it('holds a rider who rode into the turned car its clearance off the drawn car', () => {
    const car = { ...(cars[0] as LaneObstacle), startAfter: 0 };
    const tick = Math.round(PULL_OUT_SECONDS / 2 / DELIVERY_TICK_SECONDS);
    const at = carPullingOut(car, tick * DELIVERY_TICK_SECONDS);
    const corners = drawnCorners(at);
    const lane = 0;
    const state = { tick, startedAt: [0], crashed: [true] };
    // Beside its nose, and beside its tail.
    for (const along of [at.along + 1.5, at.along - 1.5]) {
      const moved = clearOfParkedCars([car], state, { along, lane, offset: at.across });
      expect(moved?.lane).toBe(lane);
      const offset = moved?.offset as number;
      expectHeldAtClearance(at, along, offset);
      // On the road side of it.
      expect(offset).toBeGreaterThan(Math.max(...corners.map(([, across]) => across)) - 0.6);
      // And held there: steering back toward the car by a little, still held.
      expect(clearOfParkedCars([car], state, { along, lane, offset: offset - 0.05 })).toEqual(
        moved,
      );
    }
  });

  it('holds a rider who rode into it clear of where it has driven to, not of where it will stop', () => {
    const car = { ...(cars[1] as LaneObstacle), startAfter: 0 };
    const tick = Math.round(2.4 / DELIVERY_TICK_SECONDS);
    const seconds = tick * DELIVERY_TICK_SECONDS;
    const at = carPullingOut(car, seconds);
    // Still two car lengths' worth short of its place: the rider there is not beside its place.
    expect(car.along - at.along).toBeGreaterThan(1);
    const lane = LANE_OFFSETS_METRES.length - 1;
    const state = { tick, startedAt: [0], crashed: [true] };
    const along = at.along - CAR.halfLength - RIDER_BEHIND_METRES + 0.4;
    expect(along + 1.2).toBeLessThan(car.along - CAR.halfLength);
    const moved = clearOfParkedCars([car], state, { along, lane, offset: at.across });
    expect(moved?.lane).toBe(lane);
    expectHeldAtClearance(at, along, moved?.offset as number);
  });
});

/** A point on the road, `[along, across]`, metres. */
type Point = readonly [number, number];

/**
 * Whether two convex outlines, each in order round it, overlap by more than a
 * touch: a corner of one strictly inside the other, or two sides crossing.
 * The test's own working, not `obstacles.ts`', so the step is checked against
 * the outline and not against itself. The sweeps avoid exact touches.
 */
function outlinesMeet(a: readonly Point[], b: readonly Point[]): boolean {
  const cross = (o: Point, p: Point, q: Point): number =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const inside = (point: Point, outline: readonly Point[]): boolean => {
    const sides = outline.map((corner, index) =>
      Math.sign(cross(corner, outline[(index + 1) % outline.length] as Point, point)),
    );
    return sides.every((side) => side === sides[0] && side !== 0);
  };
  if (a.some((point) => inside(point, b)) || b.some((point) => inside(point, a))) return true;
  return a.some((p, i) => {
    const q = a[(i + 1) % a.length] as Point;
    return b.some((r, j) => {
      const t = b[(j + 1) % b.length] as Point;
      return cross(p, q, r) * cross(p, q, t) < 0 && cross(r, t, p) * cross(r, t, q) < 0;
    });
  });
}

describe('an oncoming rider steers round a rider a crash holds — #3077, ADR 0094 D-3.3', () => {
  const KERB_LANE = LANE_OFFSETS_METRES.at(-1) as number;
  /** Another rider out from the right kerb into its lane at 100 m, riding toward the rider. */
  const ONCOMING: LaneObstacle = {
    kind: 'oncoming-rider',
    along: 100,
    from: 'right',
    startAfter: 0,
    to: KERB_LANE,
    rides: -ONCOMING_RIDER_METRES_PER_SECOND,
  };
  /** Lying at 80 m in the same kerb lane, fallen to its edge of the road: the right. */
  const HELD = { along: 80, lateral: KERB_LANE, fallenTo: 1, seconds: 1 } as const;
  const { halfLength, halfWidth } = OBSTACLE_KINDS['oncoming-rider'];
  /** Every tick from set going until it is well past the held rider. */
  const TICKS = Array.from({ length: 160 }, (_, tick) => tick * DELIVERY_TICK_SECONDS);
  /** The two are level along the road at `seconds`: their lengths overlap. */
  const level = (seconds: number): boolean => {
    const along = obstacleAlong(ONCOMING, seconds);
    return (
      along - halfLength < HELD.along + RIDER_AHEAD_METRES &&
      along + halfLength > HELD.along - RIDER_BEHIND_METRES
    );
  };

  it('is never drawn through them: level with them it is the gap clear, on the road’s middle side', () => {
    const clear = RIDER_HALF_WIDTH_METRES + halfWidth + ONCOMING_PASSING_GAP_METRES;
    const levelTicks = TICKS.filter(level);
    // Non-vacuity: it rides through where they lie, and would be drawn through them.
    expect(levelTicks.length).toBeGreaterThan(5);
    for (const seconds of levelTicks) {
      expect(obstacleAcross(ONCOMING, seconds)).toBeCloseTo(HELD.lateral, 9);
      const drawn = drawnObstacleAcross(ONCOMING, seconds, HELD);
      // Fallen to the right, passed on the left.
      expect(HELD.lateral - drawn).toBeCloseTo(clear, 9);
    }
    // Fallen to the left, passed on the right.
    const leftFall = { ...HELD, fallenTo: -1 } as const;
    for (const seconds of levelTicks) {
      expect(drawnObstacleAcross(ONCOMING, seconds, leftFall) - HELD.lateral).toBeCloseTo(clear, 9);
    }
  });

  it('eases out before it reaches them and back after, never a jump, and is where it rides beyond that', () => {
    let before = drawnObstacleAcross(ONCOMING, 0, HELD);
    let moved = 0;
    for (const seconds of TICKS) {
      const drawn = drawnObstacleAcross(ONCOMING, seconds, HELD);
      // No more than a third of a metre sideways a tick: drawn steering, not a cut.
      expect(Math.abs(drawn - before)).toBeLessThan(0.35);
      before = drawn;
      const along = obstacleAlong(ONCOMING, seconds);
      const apart = Math.max(
        HELD.along - RIDER_BEHIND_METRES - (along + halfLength),
        along - halfLength - (HELD.along + RIDER_AHEAD_METRES),
      );
      if (apart >= ONCOMING_SWERVE_METRES) {
        expect(drawn).toBe(obstacleAcross(ONCOMING, seconds));
      } else if (drawn !== obstacleAcross(ONCOMING, seconds)) {
        moved += 1;
      }
    }
    // It swerved, over more ticks than it was level for.
    expect(moved).toBeGreaterThan(TICKS.filter(level).length);
  });

  it('eases out over ONCOMING_SWERVE_SECONDS from the crash when it is level with them as it starts', () => {
    const seconds = TICKS.find(level) as number;
    const at = (crashSeconds: number): number =>
      drawnObstacleAcross(ONCOMING, seconds, { ...HELD, seconds: crashSeconds });
    expect(at(0)).toBeCloseTo(obstacleAcross(ONCOMING, seconds), 9);
    expect(at(ONCOMING_SWERVE_SECONDS / 2)).toBeLessThan(obstacleAcross(ONCOMING, seconds) - 0.1);
    expect(at(ONCOMING_SWERVE_SECONDS / 2)).toBeGreaterThan(at(ONCOMING_SWERVE_SECONDS) + 0.1);
    expect(at(ONCOMING_SWERVE_SECONDS)).toBeCloseTo(at(1), 9);
  });

  it('moves nothing with nobody held, nothing but an oncoming rider, and one already clear of them', () => {
    for (const seconds of TICKS) {
      expect(drawnObstacleAcross(ONCOMING, seconds, undefined)).toBe(
        obstacleAcross(ONCOMING, seconds),
      );
      // Held in the other kerb lane: the oncoming rider is clear already.
      const far = { ...HELD, lateral: -KERB_LANE, fallenTo: -1 } as const;
      expect(drawnObstacleAcross(ONCOMING, seconds, far)).toBe(obstacleAcross(ONCOMING, seconds));
    }
    // A dog crossing where the rider lies is drawn where it runs (#3077 leaves it).
    const dog: Obstacle = { kind: 'dog', along: HELD.along, from: 'left', startAfter: 0 };
    for (const seconds of TICKS) {
      expect(drawnObstacleAcross(dog, seconds, HELD)).toBe(obstacleAcross(dog, seconds));
    }
  });
});
