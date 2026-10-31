// SPDX-License-Identifier: Apache-2.0

/**
 * #1899: whole races with items. The room and the device must agree, so the
 * same seed, field and inputs give byte-identical races. Effort is untouched,
 * so a race with items has the same effort distances at every tick as the
 * same race without them. And with items off, no item code runs at all.
 *
 * `./items` is wrapped in a spy that calls the real rules, the pattern
 * `packages/physics/src/pacer.test.ts` uses for `advance`. "No item code
 * reached" is a claim about the call graph, so it needs the call to be
 * observed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createItemRace, stepRace, type RaceTickInput } from './item-race';
import { LANE_COUNT, resolveItems, type ItemRaceState } from './items';
import {
  raceCourse,
  settle,
  standings,
  startingRacer,
  withEffortDistance,
  type RaceCourse,
  type RacerState,
} from './race';

vi.mock('./items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./items')>();
  return { ...actual, resolveItems: vi.fn(actual.resolveItems) };
});

beforeEach(() => {
  vi.mocked(resolveItems).mockClear();
});

/** A seeded generator for the test's own inputs (mulberry32), apart from the race's. */
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

/** A race's inputs: a field, its speeds and its presses, all from `seed`. */
interface Scenario {
  readonly course: RaceCourse;
  readonly ids: readonly string[];
  readonly ticks: readonly RaceTickInput[];
}

function scenario(seed: number, lapLength = 300): Scenario {
  const random = seeded(seed);
  const course = raceCourse(lapLength, 3);
  const ids = Array.from({ length: 2 + Math.floor(random() * 5) }, (_, index) => `r${index}`);
  const speeds = ids.map(() => 8 + random() * 4);
  const efforts = ids.map(() => 0);
  const ticks: RaceTickInput[] = [];
  // Long enough for the slowest to finish even knocked back the whole bound.
  const seconds = Math.ceil((course.lapLengthMetres * course.laps + 20) / 8) + 2;
  for (let second = 1; second <= seconds; second += 1) {
    const effortDistances: Record<string, number> = {};
    const lanes: Record<string, number> = {};
    const uses: string[] = [];
    ids.forEach((id, index) => {
      efforts[index] = (efforts[index] ?? 0) + (speeds[index] ?? 0) * (0.9 + random() * 0.2);
      effortDistances[id] = efforts[index] ?? 0;
      if (random() < 0.1) lanes[id] = Math.floor(random() * LANE_COUNT);
      if (random() < 0.25) uses.push(id);
    });
    ticks.push({ atMs: second * 1_000, effortDistances, lanes, uses });
  }
  return { course, ids, ticks };
}

/** Every state of a race, the start included. */
function run(input: Scenario, raceSeed: number, itemsOn: boolean): ItemRaceState[] {
  const states = [
    createItemRace({
      course: input.course,
      seed: raceSeed,
      itemsOn,
      racerIds: input.ids,
      startMs: 0,
    }),
  ];
  for (const tick of input.ticks) {
    states.push(stepRace(states[states.length - 1] as ItemRaceState, tick));
  }
  return states;
}

describe('determinism: the room and the device agree', () => {
  it('gives byte-identical item draws and offsets from the same seed, field and inputs', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const input = scenario(seed);
      const one = JSON.stringify(run(input, seed * 7, true));
      const two = JSON.stringify(run(input, seed * 7, true));
      expect(two, `seed ${String(seed)}`).toBe(one);
    }
  });

  it('draws differently from another seed, so the seed is what decides', () => {
    const input = scenario(3);
    const held = (states: ItemRaceState[]): string =>
      JSON.stringify(states.map((state) => state.racers.map((entry) => entry.held)));
    expect(held(run(input, 1, true))).not.toBe(held(run(input, 2, true)));
  });

  it('visits the field in id order, whatever order it was given in', () => {
    const input = scenario(11);
    const reversed = { ...input, ids: [...input.ids].reverse() };
    expect(JSON.stringify(run(reversed, 5, true))).toBe(JSON.stringify(run(input, 5, true)));
  });
});

describe('effort is untouched (ADR 0060 D-4.3, D-5.2)', () => {
  it('reads the same effort distances at every tick with items on as off, over 1,000 seeded races', () => {
    let offsetsMoved = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const input = scenario(seed, 150);
      const on = run(input, seed, true);
      const off = run(input, seed, false);
      on.forEach((state, tick) => {
        const without = off[tick] as ItemRaceState;
        state.racers.forEach((entry, index) => {
          expect(entry.racer.effortDistance).toBe(
            (without.racers[index] as ItemRaceState['racers'][number]).racer.effortDistance,
          );
          if (entry.racer.raceOffset !== 0) offsetsMoved += 1;
        });
      });
    }
    // The items did move offsets: the comparison is not between two empty races.
    expect(offsetsMoved).toBeGreaterThan(10_000);
  });
});

describe('items off is the pure model (#1899 item 6)', () => {
  it('gives a 3-lap race the model’s standings, with no item code reached', () => {
    const input = scenario(1899);
    const states = run(input, 1, false);
    expect(vi.mocked(resolveItems)).not.toHaveBeenCalled();
    const last = states[states.length - 1] as ItemRaceState;
    expect(last.racers.every((entry) => entry.racer.finishedAtMs !== null)).toBe(true);
    expect(last.racers.every((entry) => entry.held === null && entry.racer.raceOffset === 0)).toBe(
      true,
    );

    // The model by hand: `race.ts` alone, the same efforts at the same instants.
    let model: RacerState[] = [...input.ids].map((id) => startingRacer(id));
    for (const tick of input.ticks) {
      model = model.map((racer) =>
        settle(
          withEffortDistance(racer, tick.effortDistances[racer.id] ?? racer.effortDistance),
          input.course,
          tick.atMs,
        ),
      );
    }
    expect(standings(last.racers.map((entry) => entry.racer))).toEqual(standings(model));
  });

  it('reaches the item rules on every tick with items on, so the spy can see them', () => {
    const input = scenario(1899);
    run(input, 1, true);
    expect(vi.mocked(resolveItems)).toHaveBeenCalledTimes(input.ticks.length);
  });
});

describe('a tick’s refusals', () => {
  const start = createItemRace({
    course: raceCourse(500, 1),
    seed: 1,
    itemsOn: true,
    racerIds: ['a'],
    startMs: 1_000,
  });

  it('refuses an instant before the last tick, or one that is not finite', () => {
    expect(() => stepRace(start, { atMs: 999, effortDistances: {} })).toThrow(
      /^atMs must not be before the last tick$/,
    );
    expect(() => stepRace(start, { atMs: Number.NaN, effortDistances: {} })).toThrow(
      /^atMs must be a finite number of milliseconds$/,
    );
  });

  it('refuses an empty field, a repeated id, and a start that is not finite', () => {
    const setup = { course: raceCourse(500, 1), seed: 1, itemsOn: true, startMs: 0 };
    expect(() => createItemRace({ ...setup, racerIds: [] })).toThrow(/^racerIds must name/);
    expect(() => createItemRace({ ...setup, racerIds: ['a', 'a'] })).toThrow(/^racerIds must name/);
    expect(() => createItemRace({ ...setup, racerIds: ['a'], startMs: Number.NaN })).toThrow(
      /^startMs must be a finite number of milliseconds$/,
    );
  });

  it('keeps a racer’s effort when a tick leaves it out', () => {
    const moved = stepRace(start, { atMs: 2_000, effortDistances: { a: 40 } });
    const kept = stepRace(moved, { atMs: 3_000, effortDistances: {} });
    expect(kept.racers[0]?.racer.effortDistance).toBe(40);
  });
});

describe('a racer id that is an Object.prototype key', () => {
  it('is an ordinary racer: its lane and effort are read as its own, or as absent', () => {
    const start = createItemRace({
      course: raceCourse(500, 1),
      seed: 1,
      itemsOn: true,
      racerIds: ['constructor', 'toString'],
      startMs: 0,
    });
    const moved = stepRace(start, { atMs: 1_000, effortDistances: { toString: 12 }, lanes: {} });
    const byId = (id: string) => moved.racers.find((entry) => entry.racer.id === id);
    expect(byId('constructor')?.racer.effortDistance).toBe(0);
    expect(byId('constructor')?.lane).toBe(1);
    expect(byId('toString')?.racer.effortDistance).toBe(12);
    const laned = stepRace(moved, { atMs: 2_000, effortDistances: {}, lanes: { constructor: 2 } });
    expect(laned.racers.find((entry) => entry.racer.id === 'constructor')?.lane).toBe(2);
  });
});
