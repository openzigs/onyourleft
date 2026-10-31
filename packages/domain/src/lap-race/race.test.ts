// SPDX-License-Identifier: Apache-2.0

/**
 * #1897: the lap race's model. The fairness rule (ADR 0060 D-4.1) is a seeded
 * property test; the separation of the two distances (D-3.4) is ten thousand
 * offsets read back; the tie rule is a field of identical racers in every
 * order. The laps' agreement with the game's own count is in `apps/web`
 * (`apps/web/src/game/lap-race/race-laps.test.ts`), because that is where
 * `course-laps.ts` lives.
 */

import { describe, expect, it } from 'vitest';

import { LapRaceError } from './errors';
import {
  applyOffset,
  lapsAt,
  RACE_OFFSET_BOUND_METRES,
  raceCourse,
  racePosition,
  settle,
  standings,
  startingRacer,
  withEffortDistance,
  type RaceCourse,
  type RacerState,
} from './race';

const B = RACE_OFFSET_BOUND_METRES;

/**
 * A small seeded generator for the test's own draws (mulberry32). The model
 * draws nothing; this only makes the cases repeatable.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** One tick of a racer: the physics' distance handed in, then any items, then the count. */
function tick(
  racer: RacerState,
  effortDistance: number,
  offsets: readonly number[],
  course: RaceCourse,
  atMs: number,
): RacerState {
  let next = withEffortDistance(racer, effortDistance);
  for (const delta of offsets) {
    next = applyOffset(next, delta);
  }
  return settle(next, course, atMs);
}

describe('effort dominates (ADR 0060 D-4.1)', () => {
  it('a racer leading on effort by more than 2B at the line finishes ahead, under any item sequence', () => {
    let qualifying = 0;
    let reversalsAvailable = 0;
    for (let seed = 1; qualifying < 1_500; seed += 1) {
      const random = seeded(seed);
      const course = raceCourse(200 + random() * 1_800, 1 + Math.floor(random() * 4));
      const speed = { x: 7 + random() * 6, y: 7 + random() * 6 };
      let x = startingRacer('x');
      let y = startingRacer('y');
      let effort = { x: 0, y: 0 };
      let atLine: { x: number; y: number } | undefined;
      for (let atMs = 500; x.finishedAtMs === null || y.finishedAtMs === null; atMs += 500) {
        effort = {
          x: effort.x + speed.x * 0.5 * (0.8 + random() * 0.4),
          y: effort.y + speed.y * 0.5 * (0.8 + random() * 0.4),
        };
        // Items far stronger than B, aimed at random: unclamped, they reverse races.
        const items = (): number[] => (random() < 0.3 ? [(random() - 0.5) * 80] : []);
        x = tick(x, effort.x, items(), course, atMs);
        y = tick(y, effort.y, items(), course, atMs);
        if (atLine === undefined && (x.finishedAtMs !== null || y.finishedAtMs !== null)) {
          atLine = { x: x.effortDistance, y: y.effortDistance };
        }
      }
      if (atLine === undefined) throw new Error('unreachable: both finished');
      const lead = atLine.x - atLine.y;
      if (Math.abs(lead) <= 2 * B) continue;
      qualifying += 1;
      if (Math.abs(lead) < 60) reversalsAvailable += 1;
      expect(standings([x, y])[0], `seed ${String(seed)}`).toBe(lead > 0 ? 'x' : 'y');
      expect(standings([y, x])[0], `seed ${String(seed)}`).toBe(lead > 0 ? 'x' : 'y');
    }
    expect(qualifying).toBeGreaterThanOrEqual(1_000);
    // Enough of the cases are close enough that an unclamped item could reverse them.
    expect(reversalsAvailable).toBeGreaterThan(100);
  });

  it('holds at the edge: a lead of 2B and a hair, the leader knocked back B and the other sent on B', () => {
    const course = raceCourse(1_000, 1);
    const leader = settle(
      applyOffset(withEffortDistance(startingRacer('b'), 1_010), -50),
      course,
      1,
    );
    const trailer = settle(
      applyOffset(withEffortDistance(startingRacer('a'), 1_010 - 2 * B - 0.001), 50),
      course,
      1,
    );
    expect(leader.finishedAtMs).toBe(1);
    expect(trailer.finishedAtMs).toBeNull();
    expect(standings([trailer, leader])).toEqual(['b', 'a']);
  });
});

describe('applyOffset never moves effortDistance (ADR 0060 D-3.4)', () => {
  it('reads effortDistance back unchanged after 10,000 random offsets, and the offset within ±B', () => {
    const random = seeded(1897);
    let racer = withEffortDistance(startingRacer('r'), 1234.5);
    for (let index = 0; index < 10_000; index += 1) {
      racer = applyOffset(racer, (random() - 0.5) * 100);
      expect(racer.effortDistance).toBe(1234.5);
      expect(Math.abs(racer.raceOffset)).toBeLessThanOrEqual(B);
    }
  });

  it('clamps to the bound it is given, and to B by default', () => {
    const racer = startingRacer('r');
    expect(applyOffset(racer, 25).raceOffset).toBe(B);
    expect(applyOffset(racer, -25).raceOffset).toBe(-B);
    expect(applyOffset(racer, 3).raceOffset).toBe(3);
    expect(applyOffset(applyOffset(racer, 8), 4, 5).raceOffset).toBe(5);
  });

  it('withEffortDistance changes the effort and leaves the offset', () => {
    const racer = withEffortDistance(applyOffset(startingRacer('r'), -4), 500);
    expect(racer).toEqual({ ...startingRacer('r'), effortDistance: 500, raceOffset: -4 });
    expect(racePosition(racer)).toBe(496);
  });
});

describe('laps and the finish, at the drawn distance', () => {
  const course = raceCourse(1_000, 3);

  it('counts laps by floor(distance / length), and none at or before the line', () => {
    expect(lapsAt(1_000, 0)).toBe(0);
    expect(lapsAt(1_000, -5)).toBe(0);
    expect(lapsAt(1_000, 999.9)).toBe(0);
    expect(lapsAt(1_000, 1_000)).toBe(1);
    expect(lapsAt(1_000, 2_500)).toBe(2);
    expect(lapsAt(0, 2_500)).toBe(0);
  });

  it('counts a lap an item carried the racer over, and caps laps at the race’s', () => {
    const racer = settle(applyOffset(withEffortDistance(startingRacer('r'), 995), 8), course, 10);
    expect(racer.lapsDone).toBe(1);
    expect(settle(withEffortDistance(racer, 2_500), course, 20).lapsDone).toBe(2);
    expect(settle(withEffortDistance(racer, 9_000), course, 30).lapsDone).toBe(3);
  });

  it('stamps the finish once, at the instant passed in, and freezes the racer there', () => {
    const riding = settle(withEffortDistance(startingRacer('r'), 2_999), course, 10);
    expect(riding.finishedAtMs).toBeNull();
    const finished = settle(withEffortDistance(riding, 3_001), course, 20);
    expect(finished.finishedAtMs).toBe(20);
    expect(finished.lapsDone).toBe(3);
    const later = settle(applyOffset(withEffortDistance(finished, 3_500), -10), course, 30);
    expect(later).toBe(finished);
  });

  it('keeps a same-tick finish order fixed after the line, however the two ride on', () => {
    const ahead = settle(withEffortDistance(startingRacer('z'), 3_009), course, 50);
    const behind = settle(withEffortDistance(startingRacer('a'), 3_002), course, 50);
    expect(standings([behind, ahead])).toEqual(['z', 'a']);
    // The one behind at the line rides on much further; the result does not change.
    expect(standings([withEffortDistance(behind, 4_000), ahead])).toEqual(['z', 'a']);
  });
});

describe('standings', () => {
  const course = raceCourse(500, 2);

  it('puts finished racers first, by finish instant, then the rest by drawn distance', () => {
    const first = settle(withEffortDistance(startingRacer('c'), 1_000), course, 10);
    const second = settle(withEffortDistance(startingRacer('a'), 1_100), course, 20);
    const leading = settle(applyOffset(withEffortDistance(startingRacer('d'), 900), 9), course, 20);
    const trailing = settle(withEffortDistance(startingRacer('b'), 905), course, 20);
    expect(standings([trailing, leading, second, first])).toEqual(['c', 'a', 'd', 'b']);
  });

  it('breaks a tie between identical racers by id, the same on every run and in every input order', () => {
    const one = settle(withEffortDistance(startingRacer('rider-2'), 300), course, 5);
    const two = settle(withEffortDistance(startingRacer('rider-10'), 300), course, 5);
    const three = settle(withEffortDistance(startingRacer('bot-a'), 300), course, 5);
    const expected = ['bot-a', 'rider-10', 'rider-2'];
    for (let run = 0; run < 100; run += 1) {
      expect(standings([one, two, three])).toEqual(expected);
      expect(standings([three, one, two])).toEqual(expected);
      expect(standings([two, three, one])).toEqual(expected);
    }
    const doneOne = settle(withEffortDistance(one, 1_000), course, 9);
    const doneTwo = settle(withEffortDistance(two, 1_000), course, 9);
    expect(standings([doneOne, doneTwo])).toEqual(['rider-10', 'rider-2']);
    expect(standings([doneTwo, doneOne])).toEqual(['rider-10', 'rider-2']);
  });

  it('does not reorder the field it was given', () => {
    const field = [startingRacer('b'), startingRacer('a')];
    standings(field);
    expect(field.map((racer) => racer.id)).toEqual(['b', 'a']);
  });
});

describe('refusals name the field and the constraint, never the value (ADR 0004 D)', () => {
  const refused = (act: () => unknown): LapRaceError => {
    try {
      act();
    } catch (error) {
      if (error instanceof LapRaceError) return error;
      throw error;
    }
    throw new Error('expected a LapRaceError');
  };

  it.each([
    ['lap-length-out-of-range', 'lapLengthMetres', () => raceCourse(-51.4872, 1)],
    ['lap-length-out-of-range', 'lapLengthMetres', () => raceCourse(Number.NaN, 1)],
    ['laps-out-of-range', 'laps', () => raceCourse(1_000, 2.5)],
    ['laps-out-of-range', 'laps', () => raceCourse(1_000, 0)],
    [
      'effort-distance-not-finite',
      'effortDistance',
      () => withEffortDistance(startingRacer('r'), Number.POSITIVE_INFINITY),
    ],
    ['offset-not-finite', 'deltaMetres', () => applyOffset(startingRacer('r'), Number.NaN)],
    ['bound-out-of-range', 'bound', () => applyOffset(startingRacer('r'), 1, -0.1278)],
    ['instant-not-finite', 'atMs', () => settle(startingRacer('r'), raceCourse(1, 1), Number.NaN)],
  ] as const)('%s names %s', (code, field, act) => {
    const error = refused(act);
    expect(error.code).toBe(code);
    expect(error.name).toBe('LapRaceError');
    expect(error.message).toContain(field);
    expect(error.message).not.toMatch(/-?\d+\.\d|NaN|Infinity/);
  });
});
