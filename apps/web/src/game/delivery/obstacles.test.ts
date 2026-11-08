// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  RIDER_HALF_WIDTH_METRES as BICYCLE_HALF_WIDTH,
} from '../bicycle';
import type { PreferenceStorage } from '../hud/announce-preference';
import { LINE_HOME_OFFSET_METRES, LINE_LIMIT_METRES } from '../racing-line';
import {
  AVOIDABLE_FASTEST_METRES_PER_SECOND,
  AVOIDABLE_SLOWEST_METRES_PER_SECOND,
  type Crash,
  CRASH_SCORE_DELTA,
  CROSSING_OBSTACLE_KINDS,
  LEVEL_STANDING_KINDS,
  levelObstacleMix,
  FEWER_OBSTACLES_KEEP_ONE_IN,
  type Obstacle,
  obstacleAcross,
  OBSTACLE_KINDS,
  OBSTACLE_SIGHT_METRES,
  OBSTACLE_SPACING_METRES,
  clearOfParkedCars,
  ON_TIME_FASTEST_METRES_PER_SECOND,
  PARKED_CAR_CLEARANCE_METRES,
  PARKED_CAR_KERB_GAP_METRES,
  parkedCarStands,
  ON_TIME_SLOWEST_METRES_PER_SECOND,
  placeObstacles,
  RIDER_AHEAD_METRES,
  RIDER_BEHIND_METRES,
  RIDER_HALF_WIDTH_METRES,
  roundScore,
  type ScoreChange,
  scoreAfter,
  startObstacles,
  stepObstacles,
} from './obstacles';
import { readDeliveryProgress, writeDeliveryProgress } from './delivery-progress';
import { parseLevelFile, type LevelFile } from './levels/level-file';
import { LANE_OFFSETS_METRES } from './steer';
import { endRound, FRESH_WEEK, recordDelivery, type Round, startRound } from './round';
import { CARRIAGEWAY_HALF_WIDTH_METRES, DELIVERY_TICK_SECONDS } from './throw';

/**
 * Ride at a steady `speed` along a line `lateral` m right of the centre, from
 * just short of the first obstacle's sight distance until the rider is past
 * the last, stepping once a tick as the simulation does; return every crash.
 */
function ride(
  obstacles: readonly Obstacle[],
  speed: number,
  lateral: number,
): { crashes: Crash[]; crashed: readonly boolean[] } {
  const first = Math.min(...obstacles.map((obstacle) => obstacle.along));
  const last = Math.max(...obstacles.map((obstacle) => obstacle.along));
  let along = first - OBSTACLE_SIGHT_METRES - 1;
  let state = startObstacles(obstacles);
  const crashes: Crash[] = [];
  while (along < last + 5) {
    along += speed * DELIVERY_TICK_SECONDS;
    const step = stepObstacles(state, { rider: { along, lateral, speed }, obstacles });
    state = step.state;
    crashes.push(...step.crashes);
  }
  return { crashes, crashed: state.crashed };
}

/** A wheelie bin from the left kerb, timed so a rider at 7.5 m/s meets it on the centre line. */
const BIN: Obstacle = {
  kind: 'bin',
  along: 1000,
  from: 'left',
  startAfter:
    OBSTACLE_SIGHT_METRES / 7.5 -
    (CARRIAGEWAY_HALF_WIDTH_METRES + OBSTACLE_KINDS.bin.halfWidth) / OBSTACLE_KINDS.bin.speed,
};

/** Every speed the sweep tries, a quarter of a metre a second apart, ends included. */
const SWEPT_SPEEDS = Array.from(
  {
    length:
      Math.round(
        (AVOIDABLE_FASTEST_METRES_PER_SECOND - AVOIDABLE_SLOWEST_METRES_PER_SECOND) / 0.25,
      ) + 1,
  },
  (_, index) => AVOIDABLE_SLOWEST_METRES_PER_SECOND + index * 0.25,
);

/** Every drawn line a rider can hold: both limits, both lanes' middles and the centre. */
const DRAWN_LINES = [
  -LINE_LIMIT_METRES,
  -LINE_HOME_OFFSET_METRES,
  0,
  LINE_HOME_OFFSET_METRES,
  LINE_LIMIT_METRES,
];

describe('the rider is the bicycle the scene draws', () => {
  it('pins its reach ahead, behind and across to bicycle.ts', () => {
    expect(RIDER_AHEAD_METRES).toBeCloseTo(BICYCLE_FRONT_METRES, 10);
    expect(RIDER_BEHIND_METRES).toBeCloseTo(BICYCLE_LENGTH_METRES - BICYCLE_FRONT_METRES, 10);
    expect(RIDER_HALF_WIDTH_METRES).toBeCloseTo(BICYCLE_HALF_WIDTH, 10);
  });
});

describe('a crossing obstacle is dodged by timing', () => {
  it('lets a rider who arrives early pass in front of it', () => {
    expect(ride([BIN], 12, 0).crashes).toEqual([]);
  });

  it('crashes a rider who arrives on time', () => {
    expect(ride([BIN], 7.5, 0).crashes).toEqual([{ scoreDelta: CRASH_SCORE_DELTA }]);
  });

  it('lets a rider who arrives late pass behind it', () => {
    expect(ride([BIN], 4, 0).crashes).toEqual([]);
  });

  it('crosses the rider’s drawn line, not only the centre: on time at the home line is a crash', () => {
    // The bin reaches the home line, right of centre, a little after the centre line.
    const atHome = SWEPT_SPEEDS.filter(
      (speed) => ride([BIN], speed, LINE_HOME_OFFSET_METRES).crashes.length > 0,
    );
    const atCentre = SWEPT_SPEEDS.filter((speed) => ride([BIN], speed, 0).crashes.length > 0);
    expect(atHome.length).toBeGreaterThan(0);
    expect(atCentre.length).toBeGreaterThan(0);
    expect(Math.max(...atHome)).toBeLessThan(Math.max(...atCentre));
  });

  it('waits off the near kerb until it is due, then rests off the far kerb', () => {
    const kerb = CARRIAGEWAY_HALF_WIDTH_METRES + OBSTACLE_KINDS.bin.halfWidth;
    expect(obstacleAcross(BIN, 0)).toBeCloseTo(-kerb, 10);
    expect(obstacleAcross(BIN, BIN.startAfter)).toBeCloseTo(-kerb, 10);
    expect(obstacleAcross(BIN, BIN.startAfter + 1)).toBeCloseTo(
      -kerb + OBSTACLE_KINDS.bin.speed,
      10,
    );
    expect(obstacleAcross(BIN, 1e6)).toBeCloseTo(kerb, 10);
    expect(obstacleAcross({ ...BIN, from: 'right' }, 0)).toBeCloseTo(kerb, 10);
    expect(obstacleAcross({ ...BIN, from: 'right' }, 1e6)).toBeCloseTo(-kerb, 10);
  });

  it('is set going only when the rider comes within sight of it', () => {
    const short = stepObstacles(startObstacles([BIN]), {
      rider: { along: BIN.along - OBSTACLE_SIGHT_METRES - 0.01, lateral: 0, speed: 8 },
      obstacles: [BIN],
    });
    expect(short.state.startedAt).toEqual([undefined]);
    const seen = stepObstacles(short.state, {
      rider: { along: BIN.along - OBSTACLE_SIGHT_METRES, lateral: 0, speed: 8 },
      obstacles: [BIN],
    });
    expect(seen.state.startedAt).toEqual([2]);
    expect(seen.state.tick).toBe(2);
  });

  it('sweeps the rider over the road it covered on the tick, so no speed jumps an obstacle', () => {
    // Already on the centre line when it is set going: from this far behind, one tick at 60 m/s carries the
    // rider's front 3 m clear past it, so only the swept stretch can touch it.
    const midRoad: Obstacle = {
      ...BIN,
      startAfter:
        -(CARRIAGEWAY_HALF_WIDTH_METRES + OBSTACLE_KINDS.bin.halfWidth) / OBSTACLE_KINDS.bin.speed,
    };
    expect(obstacleAcross(midRoad, 0)).toBeCloseTo(0, 10);
    const near = stepObstacles(startObstacles([midRoad]), {
      rider: { along: midRoad.along - 1.5, lateral: 0, speed: 0 },
      obstacles: [midRoad],
    });
    expect(near.crashes).toEqual([]);
    const jump = stepObstacles(near.state, {
      rider: { along: midRoad.along + 3 + RIDER_BEHIND_METRES, lateral: 0, speed: 60 },
      obstacles: [midRoad],
    });
    expect(jump.crashes).toEqual([{ scoreDelta: CRASH_SCORE_DELTA }]);
  });
});

describe('a crash is counted once per obstacle', () => {
  it('counts a rider held against an obstacle for many ticks once', () => {
    // Stopped on the bin's path: it rolls into the rider and is against it for
    // about a second, twenty ticks running, before it is clear on the far side.
    let state = startObstacles([BIN]);
    const crashes: Crash[] = [];
    let touching = 0;
    for (let tick = 0; tick < 1000; tick += 1) {
      const step = stepObstacles(state, {
        rider: { along: BIN.along, lateral: 0, speed: 0 },
        obstacles: [BIN],
      });
      const across = obstacleAcross(BIN, (step.state.tick - 1) * DELIVERY_TICK_SECONDS);
      if (Math.abs(across) < OBSTACLE_KINDS.bin.halfWidth + RIDER_HALF_WIDTH_METRES) touching += 1;
      state = step.state;
      crashes.push(...step.crashes);
    }
    expect(touching).toBeGreaterThan(10);
    expect(crashes).toHaveLength(1);
    expect(state.crashed).toEqual([true]);
  });

  it('counts each obstacle hit on its own', () => {
    const second: Obstacle = { ...BIN, along: BIN.along + OBSTACLE_SPACING_METRES };
    const both = ride([BIN, second], 7.5, 0);
    expect(both.crashes).toHaveLength(2);
    expect(both.crashed).toEqual([true, true]);
  });

  it('leaves an obstacle the rider dodged uncrashed', () => {
    expect(ride([BIN], 12, 0).crashed).toEqual([false]);
  });
});

describe('the crash carries points and nothing for the trainer (DL5, ADR 0059 D-2)', () => {
  it('has exactly the score delta: no grade, no power, no resistance, no virtual speed', () => {
    const [crash] = ride([BIN], 7.5, 0).crashes;
    expect(crash).toBeDefined();
    expect(Object.keys(crash as Crash).sort()).toEqual(['scoreDelta']);
    expect(crash?.scoreDelta).toBe(CRASH_SCORE_DELTA);
    expect(CRASH_SCORE_DELTA).toBeLessThan(0);
  });

  it('takes a point off the round’s score for each crash', () => {
    const crash: Crash = { scoreDelta: CRASH_SCORE_DELTA };
    expect(roundScore(['delivery', 'delivery', 'delivery'])).toBe(3);
    expect(roundScore(['delivery', 'delivery', 'delivery', crash])).toBe(3 + CRASH_SCORE_DELTA);
    expect(scoreAfter(3, crash)).toBe(3 + CRASH_SCORE_DELTA);
    expect(scoreAfter(3, 'delivery')).toBe(4);
  });
});

describe('the round’s score is never below nought at any moment (owner’s ruling, 2026-10-28)', () => {
  const crash: Crash = { scoreDelta: CRASH_SCORE_DELTA };

  it('costs nothing for a crash at nought: two crashes, then three deliveries, score 3', () => {
    expect(roundScore([crash, crash, 'delivery', 'delivery', 'delivery'])).toBe(3);
    expect(scoreAfter(0, crash)).toBe(0);
  });

  it('and the reverse, three deliveries then two crashes, scores 1', () => {
    expect(roundScore(['delivery', 'delivery', 'delivery', crash, crash])).toBe(1);
  });
});

/** Disk-backed storage: strings under keys, a fresh object over them on each call, as a reload. */
function deviceOver(disk: Map<string, string>): PreferenceStorage {
  return {
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => {
      disk.set(key, value);
    },
  };
}

describe('crashes come off the day’s round only, never the week’s (owner’s ruling, 2026-10-28)', () => {
  it('keeps every delivery in the week’s score after crashes, read back from the device', () => {
    const second: Obstacle = { ...BIN, along: BIN.along + OBSTACLE_SPACING_METRES };
    const { crashes } = ride([BIN, second], 7.5, 0);
    expect(crashes).toHaveLength(2);

    let round: Round = startRound(4);
    const changes: ScoreChange[] = [...crashes];
    for (const position of [0, 1, 2]) {
      round = recordDelivery(round, position);
      changes.push('delivery');
    }
    changes.push(...crashes);
    // The day's round: 0, 0, then 3 deliveries, then two crashes off.
    expect(roundScore(changes)).toBe(1);

    const disk = new Map<string, string>();
    const week = readDeliveryProgress(deviceOver(disk));
    expect(week).toEqual(FRESH_WEEK);
    const outcome = endRound(week, round);
    expect(outcome.weekScore).toBe(3);
    expect(writeDeliveryProgress(deviceOver(disk), outcome.next)).toBe(true);
    expect(readDeliveryProgress(deviceOver(disk)).score).toBe(3);
  });
});

describe('placement is seeded, and every obstacle is avoidable in phase 0', () => {
  const ROUND = { from: 2000, to: 2000 + 12 * OBSTACLE_SPACING_METRES + 30 };
  const SEEDS = [0, 1, 2, 7, 1811, 0xdead_beef, 0xffff_ffff];

  it('gives the same obstacles for the same seed, and others for another', () => {
    expect(placeObstacles(ROUND, 1811)).toEqual(placeObstacles(ROUND, 1811));
    expect(placeObstacles(ROUND, 1811)).not.toEqual(placeObstacles(ROUND, 1812));
  });

  it('puts one in each stretch, none in sight at the start, none closer than the sight distance', () => {
    for (const seed of SEEDS) {
      const obstacles = placeObstacles(ROUND, seed);
      expect(obstacles).toHaveLength(12);
      expect(obstacles[0]?.along).toBeGreaterThanOrEqual(ROUND.from + OBSTACLE_SIGHT_METRES);
      obstacles.forEach((obstacle, index) => {
        expect(obstacle.along).toBeLessThanOrEqual(ROUND.to);
        expect(obstacle.startAfter).toBeGreaterThanOrEqual(0);
        const next = obstacles[index + 1];
        if (next !== undefined) {
          expect(next.along - obstacle.along).toBeGreaterThanOrEqual(OBSTACLE_SIGHT_METRES);
        }
      });
    }
    expect(placeObstacles({ from: 0, to: OBSTACLE_SPACING_METRES - 1 }, 3)).toEqual([]);
  });

  it('draws every crossing kind and both kerbs from the seed', () => {
    const all = SEEDS.flatMap((seed) => placeObstacles(ROUND, seed));
    expect(new Set(all.map((obstacle) => obstacle.kind))).toEqual(new Set(CROSSING_OBSTACLE_KINDS));
    expect(new Set(all.map((obstacle) => obstacle.from))).toEqual(new Set(['left', 'right']));
  });

  it('can always wait, at the fastest on-time speed, before it crosses', () => {
    for (const shape of CROSSING_OBSTACLE_KINDS.map((kind) => OBSTACLE_KINDS[kind])) {
      const crossToCentre = (CARRIAGEWAY_HALF_WIDTH_METRES + shape.halfWidth) / shape.speed;
      expect(OBSTACLE_SIGHT_METRES / ON_TIME_FASTEST_METRES_PER_SECOND).toBeGreaterThanOrEqual(
        crossToCentre,
      );
    }
    expect(ON_TIME_SLOWEST_METRES_PER_SECOND).toBeGreaterThan(AVOIDABLE_SLOWEST_METRES_PER_SECOND);
    expect(ON_TIME_FASTEST_METRES_PER_SECOND).toBeLessThan(AVOIDABLE_FASTEST_METRES_PER_SECOND);
  });

  it('sweeps rider speeds over every placed obstacle: each is avoidable at some speed on every drawn line', () => {
    for (const seed of SEEDS) {
      for (const obstacle of placeObstacles(ROUND, seed)) {
        for (const lateral of DRAWN_LINES) {
          const avoided = SWEPT_SPEEDS.some(
            (speed) => ride([obstacle], speed, lateral).crashes.length === 0,
          );
          expect(avoided, `${obstacle.kind} unavoidable on a drawn line`).toBe(true);
        }
      }
    }
  });

  it('and each is a hazard at some speed on the rider’s home line', () => {
    for (const seed of SEEDS) {
      for (const obstacle of placeObstacles(ROUND, seed)) {
        const hit = SWEPT_SPEEDS.some(
          (speed) => ride([obstacle], speed, LINE_HOME_OFFSET_METRES).crashes.length > 0,
        );
        expect(hit, `${obstacle.kind} never in the way`).toBe(true);
      }
    }
  });
});

describe('no message formats a position, a speed or a seed (CLAUDE.md §6)', () => {
  it('refuses a bad seed or span by naming the constraint only', () => {
    expect(() => placeObstacles({ from: 0, to: 1000 }, 1.5)).toThrow(RangeError);
    expect(() => placeObstacles({ from: 0, to: 1000 }, -1)).toThrow(RangeError);
    let message = '';
    try {
      placeObstacles({ from: 4321.25, to: 1234.75 }, 9);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Delivery obstacles: /);
    expect(message).not.toMatch(/4321|1234/);
  });

  it('refuses a rider that cannot be placed by naming the fields only', () => {
    const state = startObstacles([BIN]);
    for (const rider of [
      { along: Number.NaN, lateral: 1.2345, speed: 7.875 },
      { along: 987.625, lateral: Number.POSITIVE_INFINITY, speed: 7.875 },
      { along: 987.625, lateral: 1.2345, speed: -7.875 },
    ]) {
      let message = '';
      try {
        stepObstacles(state, { rider, obstacles: [BIN] });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/^Delivery obstacles: /);
      expect(message).not.toMatch(/987|1\.23|7\.87|NaN|Infinity/);
    }
  });

  it('refuses a state kept for another round’s obstacles', () => {
    expect(() =>
      stepObstacles(startObstacles([BIN]), {
        rider: { along: 0, lateral: 0, speed: 1 },
        obstacles: [BIN, BIN],
      }),
    ).toThrow(/different number of obstacles/);
  });

  it('refuses a state whose set-going record is for another round’s obstacles', () => {
    const state = { ...startObstacles([BIN]), startedAt: [undefined, undefined] };
    expect(() =>
      stepObstacles(state, { rider: { along: 0, lateral: 0, speed: 1 }, obstacles: [BIN] }),
    ).toThrow(/different number of obstacles/);
  });
});

describe('the assist setting places fewer obstacles, or none — #1813, DL10', () => {
  const span = { from: 1_000, to: 1_000 + 12 * OBSTACLE_SPACING_METRES };

  it('places as usual unless asked, and the same for `normal`', () => {
    expect(placeObstacles(span, 7, 'normal')).toEqual(placeObstacles(span, 7));
    expect(placeObstacles(span, 7)).toHaveLength(12);
  });

  it('keeps one in two for `fewer`, each exactly where `normal` puts it', () => {
    expect(FEWER_OBSTACLES_KEEP_ONE_IN).toBe(2);
    for (const seed of [1, 7, 0xdead_beef]) {
      const usual = placeObstacles(span, seed);
      const fewer = placeObstacles(span, seed, 'fewer');
      expect(fewer).toEqual(usual.filter((_, slot) => slot % 2 === 0));
      expect(fewer).toHaveLength(6);
    }
  });

  it('places none for `none`, and still refuses a seed it could not use', () => {
    expect(placeObstacles(span, 7, 'none')).toEqual([]);
    expect(() => placeObstacles(span, -1, 'none')).toThrow(RangeError);
  });
});

describe('a level’s obstacles: parked cars and bins, standing — #2362, ADR 0065 D-10.1', () => {
  const SEEDS = [0, 1, 2, 7, 1811, 0xdead_beef, 0xffff_ffff];
  const LEVELS = fileURLToPath(new URL('./levels/', import.meta.url));
  const read = (path: string, id: string): LevelFile =>
    parseLevelFile(JSON.parse(readFileSync(path, 'utf8')), id);
  /** Both shipped levels and the synthetic fixture: their rounds, read through the app's reader. */
  const ROUNDS: readonly LevelFile[] = [
    ...readdirSync(join(LEVELS, 'data'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => read(join(LEVELS, 'data', name), name.slice(0, -5))),
    read(join(LEVELS, 'fixtures', 'fixture-level.json'), 'fixture-level'),
  ];

  it('places on a rider’s own route exactly what it placed before #2362', () => {
    // Read off `main` before this change, at 1811 steering and 0xdeadbeef not.
    const before = [
      [
        { kind: 'cone', along: 363.51587194250897, from: 'right', startAfter: 5.04082865381344 },
        { kind: 'bin', along: 469.42196573130786, stands: 0 },
        { kind: 'cone', along: 748.5444466397166, from: 'right', startAfter: 6.547552529245429 },
        { kind: 'cone', along: 1076.0265072761104, from: 'right', startAfter: 6.551672426682618 },
        { kind: 'trolley', along: 1333.5871737101115, stands: 1.75 },
      ],
      [
        { kind: 'cone', along: 306.567940779496, from: 'left', startAfter: 6.504658522818104 },
        { kind: 'bin', along: 489.7116304957308, from: 'left', startAfter: 3.313342055894057 },
        { kind: 'trolley', along: 741.4796406729147, from: 'right', startAfter: 6.937353879340478 },
        { kind: 'cone', along: 1087.9142953688279, from: 'left', startAfter: 7.276748957743736 },
        {
          kind: 'trolley',
          along: 1267.3080200492404,
          from: 'right',
          startAfter: 5.031714470547043,
        },
      ],
    ] as const;
    expect(placeObstacles({ from: 120, to: 1400 }, 1811, 'normal', true)).toStrictEqual(before[0]);
    expect(placeObstacles({ from: 120, to: 1400 }, 0xdead_beef)).toStrictEqual(before[1]);
  });

  it('reads the shipped levels and the fixture, every one of them with static hazards', () => {
    expect(ROUNDS.length).toBeGreaterThanOrEqual(3);
    for (const level of ROUNDS) expect(level.round.hazardsPerKilometre.static).toBeGreaterThan(0);
  });

  it('places the level’s density, every one standing, a parked car or a bin, a car only at the kerb', () => {
    const kinds = new Set<string>();
    const carLanes = new Set<number>();
    for (const level of ROUNDS) {
      const mix = levelObstacleMix(level.round);
      const span = { from: 0, to: level.lengthMetres };
      for (const seed of SEEDS) {
        const placed = placeObstacles(span, seed, 'normal', true, mix);
        expect(placed).toHaveLength(Math.floor(level.lengthMetres / (1000 / mix.perKilometre)));
        // None in sight at the start, none past the end, none in sight of the one before.
        expect(placed[0]?.along).toBeGreaterThanOrEqual(span.from + OBSTACLE_SIGHT_METRES);
        placed.forEach((obstacle, index) => {
          expect(obstacle.along).toBeLessThanOrEqual(span.to);
          const next = placed[index + 1];
          if (next !== undefined) {
            expect(next.along - obstacle.along).toBeGreaterThanOrEqual(OBSTACLE_SIGHT_METRES);
          }
        });
        for (const obstacle of placed) {
          expect(obstacle.stands, level.id).toBeDefined();
          expect(LEVEL_STANDING_KINDS).toContain(obstacle.kind);
          kinds.add(obstacle.kind);
          if (obstacle.kind === 'parked-car') {
            carLanes.add(obstacle.stands as number);
            expect([parkedCarStands('left'), parkedCarStands('right')]).toContain(obstacle.stands);
          }
        }
      }
    }
    expect(kinds).toEqual(new Set(['parked-car', 'bin']));
    expect(carLanes).toEqual(new Set([parkedCarStands('left'), parkedCarStands('right')]));
  });

  it('stands a parked car at the kerb side of its kerb lane, not its middle, and it still blocks that lane alone', () => {
    const car = OBSTACLE_KINDS['parked-car'];
    const reach = car.halfWidth + RIDER_HALF_WIDTH_METRES;
    for (const [side, lane] of [
      ['left', 0],
      ['right', LANE_OFFSETS_METRES.length - 1],
    ] as const) {
      const stands = parkedCarStands(side);
      const middle = LANE_OFFSETS_METRES[lane] as number;
      // Nearer the kerb than its lane's middle, its outer side the gap off the kerb.
      expect(Math.abs(stands)).toBeGreaterThan(Math.abs(middle) + 0.5);
      expect(Math.abs(stands) + car.halfWidth).toBeCloseTo(
        CARRIAGEWAY_HALF_WIDTH_METRES - PARKED_CAR_KERB_GAP_METRES,
        9,
      );
      // No bicycle fits between it and the kerb.
      expect(PARKED_CAR_KERB_GAP_METRES).toBeLessThan(2 * RIDER_HALF_WIDTH_METRES);
      // A rider on its lane's middle meets it; on any other lane, does not.
      LANE_OFFSETS_METRES.forEach((each, at) => {
        expect(Math.abs(each - stands) < reach, `${side} car, lane ${String(at)}`).toBe(
          at === lane,
        );
      });
      // And the crash is counted: ridden straight at it down the middle of its lane.
      const obstacles: Obstacle[] = [{ kind: 'parked-car', along: 100, stands }];
      let state = startObstacles(obstacles);
      let crashes = 0;
      for (let along = 30; along < 110; along += 0.4) {
        const step = stepObstacles(state, {
          rider: { along, lateral: middle, speed: 8 },
          obstacles,
        });
        state = step.state;
        crashes += step.crashes.length;
      }
      expect(crashes, `${side} car`).toBe(1);
    }
  });

  it('moves a rider beside a crashed parked car to its road side, and leaves any other rider be', () => {
    const car = OBSTACLE_KINDS['parked-car'];
    const reach = car.halfWidth + RIDER_HALF_WIDTH_METRES;
    for (const side of ['left', 'right'] as const) {
      const stands = parkedCarStands(side);
      const kerbLane = side === 'left' ? 0 : LANE_OFFSETS_METRES.length - 1;
      const obstacles: Obstacle[] = [{ kind: 'parked-car', along: 100, stands }];
      const fresh = startObstacles(obstacles);
      const crashed = { ...fresh, crashed: [true] };
      const rider = { along: 99, lane: kerbLane, offset: LANE_OFFSETS_METRES[kerbLane] as number };
      // Not yet touched: left to `stepObstacles`, which counts it.
      expect(clearOfParkedCars(obstacles, fresh, rider)).toBeUndefined();
      const moved = clearOfParkedCars(obstacles, crashed, rider);
      expect(moved, side).toBeDefined();
      // On the road side, clear of it by the clearance, still steering for their own lane.
      expect(Math.abs((moved?.offset ?? 0) - stands)).toBeCloseTo(
        reach + PARKED_CAR_CLEARANCE_METRES,
        9,
      );
      expect(Math.abs(moved?.offset ?? 0)).toBeLessThan(Math.abs(stands));
      expect(moved?.lane).toBe(kerbLane);
      // Past it, or a lane away, nothing moves.
      expect(
        clearOfParkedCars(obstacles, crashed, { ...rider, along: 100 + car.halfLength + 1 }),
      ).toBeUndefined();
      expect(
        clearOfParkedCars(obstacles, crashed, { along: 99, lane: 1, offset: 0 }),
      ).toBeUndefined();
      // A rider steering for another lane keeps steering for it.
      expect(clearOfParkedCars(obstacles, crashed, { ...rider, lane: 1 })?.lane).toBe(1);
    }
    // A crashed bin moves nobody: only a parked car.
    const bins: Obstacle[] = [{ kind: 'bin', along: 100, stands: 0 }];
    expect(
      clearOfParkedCars(
        bins,
        { ...startObstacles(bins), crashed: [true] },
        { along: 100, lane: 1, offset: 0 },
      ),
    ).toBeUndefined();
  });

  it('blocks at most one lane at every distance of every level, a parked car’s whole length counted', () => {
    let cars = 0;
    for (const level of ROUNDS) {
      for (const seed of SEEDS) {
        const placed = placeObstacles(
          { from: 0, to: level.lengthMetres },
          seed,
          'normal',
          true,
          levelObstacleMix(level.round),
        );
        // Every distance a rider's bicycle can be at, exactly: which obstacles it
        // overlaps changes only where it starts or stops overlapping one, so
        // each stretch between two such distances is read once, at its middle.
        const reach = (obstacle: Obstacle): readonly [number, number] => {
          const shape = OBSTACLE_KINDS[obstacle.kind];
          return [
            obstacle.along - shape.halfLength - RIDER_AHEAD_METRES,
            obstacle.along + shape.halfLength + RIDER_BEHIND_METRES,
          ];
        };
        const edges = placed.flatMap(reach).sort((a, b) => a - b);
        expect(edges.length).toBe(2 * placed.length);
        for (let at = 0; at + 1 < edges.length; at += 1) {
          const along = ((edges[at] as number) + (edges[at + 1] as number)) / 2;
          const blocked = new Set<number>();
          for (const obstacle of placed) {
            const [from, to] = reach(obstacle);
            if (!(along > from && along < to)) continue;
            const shape = OBSTACLE_KINDS[obstacle.kind];
            LANE_OFFSETS_METRES.forEach((lane, index) => {
              if (
                Math.abs(lane - (obstacle.stands as number)) <
                shape.halfWidth + RIDER_HALF_WIDTH_METRES
              ) {
                blocked.add(index);
              }
            });
          }
          expect(blocked.size, `${level.id} at seed ${String(seed)}`).toBeLessThanOrEqual(1);
        }
        cars += placed.filter((obstacle) => obstacle.kind === 'parked-car').length;
      }
    }
    expect(cars).toBeGreaterThan(0);
  });

  it('keeps every level obstacle out of sight at the start and of the one before, at every density', () => {
    const span = { from: 120, to: 120 + 5000 };
    for (const perKilometre of [0.5, 1, 2, 3, 4]) {
      for (let seed = 0; seed < 200; seed += 1) {
        const placed = placeObstacles(span, (seed * 2_654_435_761) >>> 0, 'normal', true, {
          perKilometre,
          standingShare: 1,
        });
        expect(placed.length).toBeGreaterThan(0);
        expect(placed[0]?.along).toBeGreaterThanOrEqual(span.from + OBSTACLE_SIGHT_METRES);
        placed.forEach((obstacle, index) => {
          expect(obstacle.along).toBeLessThanOrEqual(span.to);
          const next = placed[index + 1];
          if (next !== undefined) {
            expect(next.along - obstacle.along).toBeGreaterThanOrEqual(OBSTACLE_SIGHT_METRES);
          }
        });
      }
    }
  });

  it('places none for a level with no static hazards, and none with the assist at none', () => {
    const span = { from: 0, to: 3000 };
    expect(placeObstacles(span, 7, 'normal', true, { perKilometre: 0, standingShare: 1 })).toEqual(
      [],
    );
    expect(
      placeObstacles(span, 7, 'none', true, levelObstacleMix((ROUNDS[0] as LevelFile).round)),
    ).toEqual([]);
  });
});
