// SPDX-License-Identifier: Apache-2.0

/**
 * #1899: the item rules, one rule at a time. Each test builds a small field
 * by hand and drives it through `stepRace`, the path the device and the room
 * both run, and then reads the race back.
 */

import { describe, expect, it } from 'vitest';

import { LapRaceError } from './errors';
import { createItemRace, stepRace } from './item-race';
import {
  BACK_OVER_FRONT_STRENGTH_METRES,
  drawItem,
  ITEM_KINDS,
  ITEM_RULES,
  ITEM_TABLE,
  itemStrength,
  LANE_COUNT,
  MAXIMUM_EFFECT_RATE_METRES_PER_SECOND,
  meanStrength,
  pickUpsPassed,
  positionBand,
  PUDDLE_LIFETIME_MS,
  RAIN_CAPE_DURATION_MS,
  SLIPSTREAM_REACH_METRES,
  STARTING_LANE,
  type ItemKind,
  type ItemRaceState,
  type LapRacer,
  type PositionBand,
} from './items';
import { nextUnit, raceRandom, type RaceRandom } from './random';
import { RACE_OFFSET_BOUND_METRES, raceCourse, racePosition } from './race';

const B = RACE_OFFSET_BOUND_METRES;
const COURSE = raceCourse(1_000, 3);

interface Spec {
  readonly id: string;
  /** Effort distance, metres. */
  readonly at: number;
  readonly lane?: number;
  readonly held?: ItemKind | null;
}

/** A field built by hand at instant 0, each racer past the pick-ups behind it. */
function field(specs: readonly Spec[]): ItemRaceState {
  const state = createItemRace({
    course: COURSE,
    seed: 1899,
    itemsOn: true,
    racerIds: specs.map((spec) => spec.id),
    startMs: 0,
  });
  return {
    ...state,
    racers: state.racers.map((entry): LapRacer => {
      const spec = specs.find((candidate) => candidate.id === entry.racer.id) as Spec;
      return {
        ...entry,
        racer: { ...entry.racer, effortDistance: spec.at },
        lane: spec.lane ?? STARTING_LANE,
        held: spec.held ?? null,
        pickUpsPassed: pickUpsPassed(COURSE, spec.at),
      };
    }),
  };
}

function racer(state: ItemRaceState, id: string): LapRacer {
  const found = state.racers.find((entry) => entry.racer.id === id);
  if (found === undefined) throw new Error(`no racer ${id}`);
  return found;
}

/**
 * Ride the field on: every racer at `speed` m/s of effort, one tick a second,
 * for `seconds`, with `first` the inputs of the first tick.
 */
function ride(
  state: ItemRaceState,
  seconds: number,
  first: { readonly uses?: readonly string[]; readonly lanes?: Record<string, number> } = {},
  speed = 0,
): ItemRaceState {
  let next = state;
  for (let second = 1; second <= seconds; second += 1) {
    const efforts: Record<string, number> = {};
    for (const entry of next.racers) efforts[entry.racer.id] = entry.racer.effortDistance + speed;
    next = stepRace(next, {
      atMs: next.atMs + 1_000,
      effortDistances: efforts,
      ...(second === 1 ? first : {}),
    });
  }
  return next;
}

describe('the race’s own generator', () => {
  it('gives the same numbers from the same seed, each in [0, 1), and others from another seed', () => {
    const run = (seed: number): number[] => {
      let random: RaceRandom = raceRandom(seed);
      return Array.from({ length: 1_000 }, () => {
        const { value, next } = nextUnit(random);
        random = next;
        return value;
      });
    };
    const one = run(42);
    expect(run(42)).toEqual(one);
    expect(run(43)).not.toEqual(one);
    for (const value of one) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // Spread, not stuck: every tenth of the range is visited.
    expect(new Set(one.map((value) => Math.floor(value * 10))).size).toBe(10);
  });

  it('refuses a seed that is not a whole number, naming the field and not the value', () => {
    expect(() => raceRandom(1.5)).toThrow(LapRaceError);
    expect(() => raceRandom(1.5)).toThrow(/^seed must be a whole number$/);
  });
});

describe('the table and the bands', () => {
  it('bands a field by its span, a lone racer and a pair included', () => {
    expect(positionBand(0, 1)).toBe('front');
    expect([0, 1].map((rank) => positionBand(rank, 2))).toEqual(['front', 'back']);
    expect([0, 1, 2].map((rank) => positionBand(rank, 3))).toEqual(['front', 'middle', 'back']);
    expect([0, 1, 2, 3, 4].map((rank) => positionBand(rank, 5))).toEqual([
      'front',
      'middle',
      'middle',
      // Halfway between two bands rounds toward the back: the stronger table.
      'back',
      'back',
    ]);
  });

  it('weighs every band out of 100, gives the front nothing that aims ahead, and states its margin', () => {
    for (const band of ['front', 'middle', 'back'] as const) {
      expect(ITEM_KINDS.reduce((sum, kind) => sum + ITEM_TABLE[band][kind], 0)).toBe(100);
    }
    expect(ITEM_TABLE.front.slipstream).toBe(0);
    expect(ITEM_TABLE.front['crosswind-gust']).toBe(0);
    expect(meanStrength('front')).toBeCloseTo(4.5, 10);
    expect(meanStrength('middle')).toBeCloseTo(5.9, 10);
    expect(meanStrength('back')).toBeCloseTo(7.1, 10);
    expect(meanStrength('back') - meanStrength('front')).toBeCloseTo(
      BACK_OVER_FRONT_STRENGTH_METRES,
      10,
    );
  });

  it('keeps every effect a bounded rate', () => {
    for (const kind of ITEM_KINDS) {
      expect(Math.abs(ITEM_RULES[kind].rateMetresPerSecond)).toBeLessThanOrEqual(
        MAXIMUM_EFFECT_RATE_METRES_PER_SECOND,
      );
    }
    expect(itemStrength('rain-cape')).toBe(0);
  });

  it('draws the back stronger than the front by the margin the table states, over 100,000 seeded draws', () => {
    let random = raceRandom(20_261_030);
    const mean = (band: PositionBand, draws: number): number => {
      let total = 0;
      for (let draw = 0; draw < draws; draw += 1) {
        const drawn = drawItem(band, random);
        random = drawn.next;
        total += itemStrength(drawn.kind);
      }
      return total / draws;
    };
    const front = mean('front', 50_000);
    const back = mean('back', 50_000);
    // Tolerance 0.1 m: each mean's standard error is about 0.014 m.
    expect(Math.abs(back - front - BACK_OVER_FRONT_STRENGTH_METRES)).toBeLessThan(0.1);
  });

  it('never draws a weight of 0', () => {
    let random = raceRandom(7);
    const seen = new Set<ItemKind>();
    for (let draw = 0; draw < 10_000; draw += 1) {
      const drawn = drawItem('front', random);
      random = drawn.next;
      seen.add(drawn.kind);
    }
    expect([...seen].sort()).toEqual(['puddle', 'rain-cape', 'tailwind']);
  });
});

describe('pick-ups, by fraction of the lap', () => {
  it('counts the points a drawn distance has passed, over the whole race and no further', () => {
    expect(pickUpsPassed(COURSE, 0)).toBe(0);
    expect(pickUpsPassed(COURSE, 249.9)).toBe(0);
    expect(pickUpsPassed(COURSE, 250)).toBe(1);
    expect(pickUpsPassed(COURSE, 999)).toBe(3);
    expect(pickUpsPassed(COURSE, 1_250)).toBe(4);
    expect(pickUpsPassed(COURSE, 2_750)).toBe(9);
    expect(pickUpsPassed(COURSE, 9_999)).toBe(9);
  });

  it('gives an item to a racer riding through one empty-handed, from the race’s generator', () => {
    const start = field([{ id: 'a', at: 245 }]);
    const after = ride(start, 1, {}, 10);
    expect(racer(after, 'a').held).not.toBeNull();
    expect(after.random).not.toEqual(start.random);
  });

  it('holds one item at a time: a pick-up ridden through while holding draws nothing', () => {
    const start = field([{ id: 'a', at: 245, held: 'tailwind' }]);
    const after = ride(start, 1, {}, 10);
    expect(racer(after, 'a').held).toBe('tailwind');
    expect(racer(after, 'a').pickUpsPassed).toBe(1);
    expect(after.random).toEqual(start.random);
  });

  it('does not draw twice from a pick-up a racer was knocked back over', () => {
    // b is just past the 250 m point and is hit back over it, then rides through again.
    const start = field([
      { id: 'a', at: 240, lane: 1, held: 'crosswind-gust' },
      { id: 'b', at: 251, lane: 1 },
    ]);
    const hit = ride(start, 1, { uses: ['a'] });
    const back = ride(hit, 4);
    expect(racePosition(racer(back, 'b').racer)).toBeLessThan(250);
    const again = ride(back, 2, {}, 5);
    expect(racePosition(racer(again, 'b').racer)).toBeGreaterThan(250);
    expect(racer(again, 'b').held).toBeNull();
  });
});

describe('each item, on the race offset only', () => {
  it('tailwind: the holder gains 1.5 m/s for 4 s, then nothing', () => {
    const after = ride(field([{ id: 'a', at: 100, held: 'tailwind' }]), 6, { uses: ['a'] });
    // Used at the first tick's instant; runs for the four seconds after it.
    expect(racer(after, 'a').racer.raceOffset).toBeCloseTo(6, 10);
    expect(racer(after, 'a').held).toBeNull();
    expect(racer(after, 'a').effects).toEqual([]);
    expect(racer(after, 'a').racer.effortDistance).toBe(100);
  });

  it('slipstream: tows toward a racer within reach ahead, and does nothing with none in reach', () => {
    const towed = ride(
      field([
        { id: 'a', at: 100, held: 'slipstream' },
        { id: 'b', at: 100 + SLIPSTREAM_REACH_METRES - 1 },
      ]),
      5,
      { uses: ['a'] },
    );
    expect(racer(towed, 'a').racer.raceOffset).toBeCloseTo(8, 10);
    const alone = ride(
      field([
        { id: 'a', at: 100, held: 'slipstream' },
        { id: 'b', at: 100 + SLIPSTREAM_REACH_METRES + 1 },
      ]),
      5,
      { uses: ['a'] },
    );
    expect(racer(alone, 'a').racer.raceOffset).toBe(0);
    expect(racer(alone, 'a').held).toBeNull();
  });

  it('puddle: hits the next racer through it in the same lane', () => {
    const dropped = ride(
      field([
        { id: 'a', at: 120, lane: 0, held: 'puddle' },
        { id: 'b', at: 110, lane: 0 },
      ]),
      1,
      { uses: ['a'] },
    );
    expect(dropped.hazards).toHaveLength(1);
    // b rides through it at 10 m/s on the next tick, then serves the four seconds.
    const after = ride(dropped, 5, {}, 10);
    expect(racer(after, 'b').racer.raceOffset).toBeCloseTo(-6, 10);
    expect(after.hazards).toEqual([]);
    expect(racer(after, 'a').racer.raceOffset).toBe(0);
  });

  it('puddle: misses a racer through it in a different lane, and dries in time', () => {
    const dropped = ride(
      field([
        { id: 'a', at: 120, lane: 0, held: 'puddle' },
        { id: 'b', at: 110, lane: 2 },
      ]),
      1,
      { uses: ['a'] },
    );
    const after = ride(dropped, 5, {}, 10);
    expect(racer(after, 'b').racer.raceOffset).toBe(0);
    expect(after.hazards).toHaveLength(1);
    const dried = ride(after, PUDDLE_LIFETIME_MS / 1_000);
    expect(dried.hazards).toEqual([]);
  });

  it('crosswind gust: hits the nearest racer ahead in the holder’s lane', () => {
    const after = ride(
      field([
        { id: 'a', at: 100, lane: 1, held: 'crosswind-gust' },
        { id: 'b', at: 130, lane: 1 },
        { id: 'c', at: 160, lane: 1 },
      ]),
      5,
      { uses: ['a'] },
    );
    expect(racer(after, 'b').racer.raceOffset).toBeCloseTo(-8, 10);
    expect(racer(after, 'c').racer.raceOffset).toBe(0);
    expect(racer(after, 'a').racer.raceOffset).toBe(0);
  });

  it('crosswind gust: misses when the nearest racer ahead is in a different lane', () => {
    const after = ride(
      field([
        { id: 'a', at: 100, lane: 1, held: 'crosswind-gust' },
        { id: 'b', at: 130, lane: 2 },
        { id: 'c', at: 160, lane: 1 },
      ]),
      5,
      { uses: ['a'] },
    );
    expect(racer(after, 'b').racer.raceOffset).toBe(0);
    expect(racer(after, 'c').racer.raceOffset).toBe(0);
    expect(racer(after, 'a').held).toBeNull();
  });

  it('rain cape: absorbs one hit, and the next one lands', () => {
    const caped = ride(
      field([
        { id: 'a', at: 100, lane: 1, held: 'crosswind-gust' },
        { id: 'b', at: 130, lane: 1, held: 'rain-cape' },
      ]),
      1,
      { uses: ['b'] },
    );
    expect(racer(caped, 'b').capeUntilMs).not.toBeNull();
    const absorbed = ride(caped, 5, { uses: ['a'] });
    expect(racer(absorbed, 'b').racer.raceOffset).toBe(0);
    expect(racer(absorbed, 'b').capeUntilMs).toBeNull();
    const rearmed: ItemRaceState = {
      ...absorbed,
      racers: absorbed.racers.map((entry) =>
        entry.racer.id === 'a' ? { ...entry, held: 'crosswind-gust' } : entry,
      ),
    };
    const landed = ride(rearmed, 5, { uses: ['a'] });
    expect(racer(landed, 'b').racer.raceOffset).toBeCloseTo(-8, 10);
  });

  it('pressing use with nothing held changes nothing', () => {
    const start = field([{ id: 'a', at: 100 }]);
    expect(ride(start, 2, { uses: ['a'] })).toEqual(ride(start, 2));
  });
});

/** Every ordering of `items`. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('no item can push an offset past the bound', () => {
  it('fires every item at one racer in every order, and reads its offset within ±B at every tick', () => {
    let reachedBound = false;
    let knockedBack = 0;
    for (const order of permutations(ITEM_KINDS)) {
      // t is the target, in lane 1 with r behind it and f ahead of it. Everyone
      // rides at 1 m/s, so nothing passes anyone but what the items do.
      let state = field([
        { id: 'f', at: 125 },
        { id: 't', at: 110 },
        { id: 'r', at: 80 },
      ]);
      const check = (): void => {
        const offset = racer(state, 't').racer.raceOffset;
        expect(Math.abs(offset), order.join(',')).toBeLessThanOrEqual(B);
        reachedBound ||= Math.abs(offset) === B;
      };
      for (const kind of order) {
        const before = racer(state, 't').racer.raceOffset;
        if (kind === 'puddle') {
          // Dropped just ahead of t in its lane, as f would have left it.
          const at = racePosition(racer(state, 't').racer) + 0.5;
          state = {
            ...state,
            hazards: [...state.hazards, { position: at, lane: 1, ownerId: 'f', untilMs: 1e9 }],
          };
          state = ride(state, 1, {}, 1);
        } else {
          const user = kind === 'crosswind-gust' ? 'r' : 't';
          state = {
            ...state,
            racers: state.racers.map((entry) =>
              entry.racer.id === user ? { ...entry, held: kind } : entry,
            ),
          };
          state = ride(state, 1, { uses: [user] }, 1);
        }
        check();
        state = ride(state, 1, {}, 1);
        check();
        if (racer(state, 't').racer.raceOffset < before) knockedBack += 1;
      }
      for (let second = 0; second < 6; second += 1) {
        state = ride(state, 1, {}, 1);
        check();
      }
    }
    expect(reachedBound).toBe(true);
    // The hits landed, not only the forward items: the cape absorbs some, not all.
    expect(knockedBack).toBeGreaterThan(100);
  });

  it('stops at +B when two forward items run together, rather than adding past it', () => {
    let state = field([
      { id: 't', at: 100, held: 'tailwind' },
      { id: 'f', at: 110 },
    ]);
    state = ride(state, 1, { uses: ['t'] });
    state = {
      ...state,
      racers: state.racers.map((entry) =>
        entry.racer.id === 't' ? { ...entry, held: 'slipstream' } : entry,
      ),
    };
    state = ride(state, 5, { uses: ['t'] });
    // 6 m and 8 m unclamped would be 14 m.
    expect(racer(state, 't').racer.raceOffset).toBe(B);
  });
});

describe('lanes', () => {
  it('changes a lane on request, moving neither distance', () => {
    const after = ride(field([{ id: 'a', at: 100 }]), 1, { lanes: { a: 0 } });
    expect(racer(after, 'a').lane).toBe(0);
    expect(racer(after, 'a').racer.raceOffset).toBe(0);
    expect(racer(after, 'a').racer.effortDistance).toBe(100);
  });

  it('refuses a lane that is not one of the race’s: lanes are discrete', () => {
    const start = field([{ id: 'a', at: 100 }]);
    for (const lane of [-1, LANE_COUNT, 0.5, Number.NaN]) {
      expect(() => ride(start, 1, { lanes: { a: lane } })).toThrow(
        /^lane must be a whole number below LANE_COUNT$/,
      );
    }
  });
});

/** A copy of `state` with racer `id` already over the line. */
function finished(state: ItemRaceState, id: string): ItemRaceState {
  return {
    ...state,
    racers: state.racers.map((entry) =>
      entry.racer.id === id
        ? {
            ...entry,
            racer: { ...entry.racer, finishedAtMs: 0, lineMetres: entry.racer.effortDistance },
          }
        : entry,
    ),
  };
}

describe('the draw reads the racer’s real position (#1899 item 4)', () => {
  it('draws the leader from the front table and the last racer from the back one, through resolveItems', () => {
    const aiming = new Set<ItemKind>(['slipstream', 'crosswind-gust']);
    let leaderAiming = 0;
    let trailerAiming = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      // Both ride through a pick-up on the same tick: the leader through 750 m, the trailer through 250 m.
      const start = {
        ...field([
          { id: 'lead', at: 745 },
          { id: 'tail', at: 245 },
        ]),
        random: raceRandom(seed),
      };
      const after = ride(start, 1, {}, 10);
      if (aiming.has(racer(after, 'lead').held as ItemKind)) leaderAiming += 1;
      if (aiming.has(racer(after, 'tail').held as ItemKind)) trailerAiming += 1;
    }
    // The front table has no slipstream and no gust; the back one is 70% of them.
    expect(leaderAiming).toBe(0);
    expect(trailerAiming).toBeGreaterThan(150);
  });
});

describe('a finished racer takes no part in the items', () => {
  it('cannot drop a puddle or send a gust once over the line', () => {
    const base = finished(
      field([
        { id: 'a', at: 100, lane: 1, held: 'puddle' },
        { id: 'b', at: 130, lane: 1 },
      ]),
      'a',
    );
    const dropped = ride(base, 1, { uses: ['a'] });
    expect(dropped.hazards).toEqual([]);
    expect(racer(dropped, 'a').held).toBe('puddle');
    const gusting: ItemRaceState = {
      ...base,
      racers: base.racers.map((entry) =>
        entry.racer.id === 'a' ? { ...entry, held: 'crosswind-gust' } : entry,
      ),
    };
    const after = ride(gusting, 5, { uses: ['a'] });
    expect(racer(after, 'b').racer.raceOffset).toBe(0);
  });

  it('is not the racer a gust is aimed at: the next unfinished one ahead is', () => {
    const base = finished(
      field([
        { id: 'a', at: 100, lane: 1, held: 'crosswind-gust' },
        { id: 'f', at: 130, lane: 1 },
        { id: 'z', at: 160, lane: 1 },
      ]),
      'f',
    );
    const after = ride(base, 5, { uses: ['a'] });
    expect(racer(after, 'z').racer.raceOffset).toBeCloseTo(-8, 10);
  });
});

describe('a puddle’s edges', () => {
  it('never hits the racer who dropped it, even riding over it', () => {
    const start = field([{ id: 'a', at: 115, lane: 1 }]);
    const withPuddle: ItemRaceState = {
      ...start,
      hazards: [{ position: 120, lane: 1, ownerId: 'a', untilMs: 100_000 }],
    };
    const after = ride(withPuddle, 5, {}, 10);
    expect(racePosition(racer(after, 'a').racer)).toBeGreaterThan(120);
    expect(racer(after, 'a').racer.raceOffset).toBe(0);
    expect(after.hazards).toHaveLength(1);
  });

  it('does not hit a racer who crosses it in the tick it dries', () => {
    const start = field([{ id: 'b', at: 115, lane: 1 }]);
    const withPuddle: ItemRaceState = {
      ...start,
      hazards: [{ position: 120, lane: 1, ownerId: 'a', untilMs: 500 }],
    };
    const after = ride(withPuddle, 5, {}, 10);
    expect(racer(after, 'b').racer.raceOffset).toBe(0);
    expect(after.hazards).toEqual([]);
  });
});

describe('a rain cape that expires unused', () => {
  it('reads as no cape once its time has gone', () => {
    const caped = ride(field([{ id: 'a', at: 100, held: 'rain-cape' }]), 1, { uses: ['a'] });
    expect(racer(caped, 'a').capeUntilMs).not.toBeNull();
    const later = ride(caped, RAIN_CAPE_DURATION_MS / 1_000);
    expect(racer(later, 'a').capeUntilMs).toBeNull();
  });
});

describe('the slipstream’s reach', () => {
  it('tows a racer exactly at the reach', () => {
    const towed = ride(
      field([
        { id: 'a', at: 100, held: 'slipstream' },
        { id: 'b', at: 100 + SLIPSTREAM_REACH_METRES },
      ]),
      5,
      { uses: ['a'] },
    );
    expect(racer(towed, 'a').racer.raceOffset).toBeCloseTo(8, 10);
  });
});
