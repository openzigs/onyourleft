// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  RIDER_HALF_WIDTH_METRES as BICYCLE_HALF_WIDTH,
} from '../bicycle';
import { LINE_HOME_OFFSET_METRES, LINE_LIMIT_METRES } from '../racing-line';
import {
  AVOIDABLE_FASTEST_METRES_PER_SECOND,
  AVOIDABLE_SLOWEST_METRES_PER_SECOND,
  type Crash,
  CRASH_SCORE_DELTA,
  type Obstacle,
  obstacleAcross,
  OBSTACLE_KINDS,
  OBSTACLE_SIGHT_METRES,
  OBSTACLE_SPACING_METRES,
  ON_TIME_FASTEST_METRES_PER_SECOND,
  ON_TIME_SLOWEST_METRES_PER_SECOND,
  placeObstacles,
  RIDER_AHEAD_METRES,
  RIDER_BEHIND_METRES,
  RIDER_HALF_WIDTH_METRES,
  roundScore,
  startObstacles,
  stepObstacles,
} from './obstacles';
import { recordDelivery, startRound } from './round';
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

  it('takes a point off the round’s score for each crash, never below nought', () => {
    let round = startRound(4);
    round = recordDelivery(recordDelivery(recordDelivery(round, 0), 1), 2);
    const crash: Crash = { scoreDelta: CRASH_SCORE_DELTA };
    expect(roundScore(round, [])).toBe(3);
    expect(roundScore(round, [crash])).toBe(3 + CRASH_SCORE_DELTA);
    expect(roundScore(round, [crash, crash])).toBe(3 + 2 * CRASH_SCORE_DELTA);
    expect(roundScore(round, [crash, crash, crash, crash, crash])).toBe(0);
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

  it('draws every kind and both kerbs from the seed', () => {
    const all = SEEDS.flatMap((seed) => placeObstacles(ROUND, seed));
    expect(new Set(all.map((obstacle) => obstacle.kind))).toEqual(
      new Set(Object.keys(OBSTACLE_KINDS)),
    );
    expect(new Set(all.map((obstacle) => obstacle.from))).toEqual(new Set(['left', 'right']));
  });

  it('can always wait, at the fastest on-time speed, before it crosses', () => {
    for (const shape of Object.values(OBSTACLE_KINDS)) {
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
});
