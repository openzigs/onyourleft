// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1902: where a lap-race frame's pieces go, and the hit effect's timeline —
 * `in-view.ts`. Races are stepped through #1899's own rules
 * (`@onyourleft/domain` §`stepRace`), so a puddle or a hit drawn here is one
 * the model made, read back through the state the frame would be handed.
 *
 * WCAG 2.3.1 is counted, not reasoned about: {@link luminanceChanges} walks
 * the effect's brightness at every millisecond and counts each swing of a
 * tenth or more, which is the success criterion's "pair of opposing changes"
 * taken a change at a time.
 */

import {
  createItemRace,
  ITEM_RULES,
  LANE_COUNT,
  PICK_UP_FRACTIONS,
  PUDDLE_LIFETIME_MS,
  raceCourse,
  stepRace,
  type ItemKind,
  type ItemRaceState,
  type OffsetEffect,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { LANE_OFFSETS_METRES } from '../delivery/steer';
import type { CorridorPoint } from '../terrain';

import {
  HIT_GLOW_MEAN,
  HIT_GLOW_SWING,
  HIT_GROW_FROM,
  HIT_PULSE_HZ,
  hitLook,
  lapRaceInView,
  laneLateral,
} from './in-view';

/** A straight corridor due north from `from` to `to` metres of odometer, a point every 2 m. */
function corridor(from: number, to: number): { readonly centre: readonly CorridorPoint[] } {
  const centre: CorridorPoint[] = [];
  for (let along = from; along <= to; along += 2) {
    centre.push({ x: 0, y: 1, z: along, distance: along, along });
  }
  return { centre };
}

const COURSE = raceCourse(200, 3);

/** A race of `ids` with `holder` holding `kind`, every racer at its effort distance. */
function raceWith(
  ids: readonly string[],
  holder: string,
  kind: ItemKind,
  efforts: Readonly<Record<string, number>>,
  lanes: Readonly<Record<string, number>> = {},
): ItemRaceState {
  const race = stepRace(
    createItemRace({ course: COURSE, seed: 7, itemsOn: true, racerIds: ids, startMs: 0 }),
    { atMs: 0, effortDistances: efforts, lanes },
  );
  return {
    ...race,
    racers: race.racers.map((entry) =>
      entry.racer.id === holder ? { ...entry, held: kind } : entry,
    ),
  };
}

describe('lapRaceInView — #1902', () => {
  it('places every pick-up point of every lap that is on the frame’s road, across the road’s centre', () => {
    const race = createItemRace({
      course: COURSE,
      seed: 1,
      itemsOn: true,
      racerIds: ['a'],
      startMs: 0,
    });
    // The race starts 1 000 m into the ride; the frame's road is 1 000 m to 1 600 m.
    const view = lapRaceInView({ corridor: corridor(1_000, 1_600), race, startAlong: 1_000 });
    const expected = [0, 1, 2].flatMap((lap) =>
      PICK_UP_FRACTIONS.map((fraction) => 1_000 + (lap + fraction) * 200),
    );
    expect(expected.every((along) => along <= 1_600)).toBe(true);
    expect(view.pickUps.map((piece) => piece.z)).toEqual(expected);
    for (const piece of view.pickUps) {
      expect(piece.x).toBe(0);
      expect(piece.y).toBe(1);
      expect(piece.yaw).toBe(0);
    }
    expect(view.hazards).toEqual([]);
  });

  it('draws nothing off the frame’s road, rather than clamping it to the road’s end', () => {
    const race = createItemRace({
      course: COURSE,
      seed: 1,
      itemsOn: true,
      racerIds: ['a'],
      startMs: 0,
    });
    const view = lapRaceInView({ corridor: corridor(120, 260), race, startAlong: 0 });
    expect(view.pickUps.map((piece) => piece.z)).toEqual([150, 250]);
    const none = lapRaceInView({ corridor: { centre: [] }, race, startAlong: 0 });
    expect(none.pickUps).toEqual([]);
  });

  it('draws a puddle the rules placed, in the middle of its lane at its pick-up point, until it dries', () => {
    // `a` in the left-hand lane at 20 m uses a puddle: it goes at the next pick-up point, 50 m.
    let race = raceWith(['a', 'b'], 'a', 'puddle', { a: 20, b: 10 }, { a: 0 });
    race = stepRace(race, { atMs: 100, effortDistances: { a: 21, b: 11 }, uses: ['a'] });
    expect(race.hazards).toHaveLength(1);
    const view = lapRaceInView({ corridor: corridor(0, 400), race, startAlong: 0 });
    expect(view.hazards).toHaveLength(1);
    const [puddle] = view.hazards;
    expect(puddle?.z).toBeCloseTo(50, 9);
    // Riding north, the rider's right is `−x`, so the left-hand lane is `+x`.
    expect(puddle?.x).toBeCloseTo(-LANE_OFFSETS_METRES[0]!, 9);

    race = stepRace(race, { atMs: 100 + PUDDLE_LIFETIME_MS, effortDistances: {} });
    expect(race.hazards).toEqual([]);
    expect(lapRaceInView({ corridor: corridor(0, 400), race, startAlong: 0 }).hazards).toEqual([]);
  });

  it('does not draw a puddle whose time has gone, even before the next tick drops it', () => {
    let race = raceWith(['a', 'b'], 'a', 'puddle', { a: 20, b: 10 });
    race = stepRace(race, { atMs: 100, effortDistances: {}, uses: ['a'] });
    const dried = { ...race, atMs: 100 + PUDDLE_LIFETIME_MS };
    expect(
      lapRaceInView({ corridor: corridor(0, 400), race: dried, startAlong: 0 }).hazards,
    ).toEqual([]);
  });

  it('places a lane where Delivery’s lanes are, one for each of the race’s, and refuses any other', () => {
    expect(LANE_OFFSETS_METRES).toHaveLength(LANE_COUNT);
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      expect(laneLateral(lane)).toBe(LANE_OFFSETS_METRES[lane]);
    }
    for (const lane of [-1, LANE_COUNT, 0.5, Number.NaN]) {
      expect(() => laneLateral(lane)).toThrow('lane must be one of the race’s lanes');
    }
  });
});

/** The brightness drawn at `atMs`: the look's glow, or nought where nothing is drawn. */
function brightness(effects: readonly OffsetEffect[], atMs: number, reduced: boolean): number {
  return hitLook(effects, atMs, reduced)?.glow ?? 0;
}

/**
 * Every instant the drawn brightness changed by a tenth or more in one
 * direction since it last turned, sampled each millisecond from `fromMs` to
 * `toMs`: a light that comes on is one change, and going off another.
 */
function luminanceChanges(
  effects: readonly OffsetEffect[],
  reduced: boolean,
  fromMs: number,
  toMs: number,
): number[] {
  const changes: number[] = [];
  let reference = brightness(effects, fromMs, reduced);
  let direction = 0;
  for (let at = fromMs + 1; at <= toMs; at += 1) {
    const value = brightness(effects, at, reduced);
    // The extreme since it last turned: the brightest while rising, the darkest while falling.
    if (direction === 1 && value > reference) reference = value;
    if (direction === -1 && value < reference) reference = value;
    if (direction !== 1 && value - reference >= 0.1) {
      changes.push(at);
      direction = 1;
      reference = value;
    } else if (direction !== -1 && reference - value >= 0.1) {
      changes.push(at);
      direction = -1;
      reference = value;
    }
  }
  return changes;
}

/** The most changes inside any one second. */
function mostInASecond(changes: readonly number[]): number {
  let most = 0;
  for (let first = 0; first < changes.length; first += 1) {
    let count = 0;
    for (let next = first; next < changes.length; next += 1) {
      if ((changes[next] as number) - (changes[first] as number) < 1_000) count += 1;
    }
    most = Math.max(most, count);
  }
  return most;
}

/** A slow-down of `kind` from `fromMs`, as `items.ts` makes one. */
function slowDown(kind: 'puddle' | 'crosswind-gust', fromMs: number): OffsetEffect {
  const rule = ITEM_RULES[kind];
  return {
    rateMetresPerSecond: rule.rateMetresPerSecond,
    fromMs,
    untilMs: fromMs + rule.durationMs,
  };
}

/**
 * Hit sequences meant to make it flash: one hit; hits stacked on hits every
 * 300 ms; a hit as the last one ends; and seeded hits at random gaps.
 */
function hitSequences(): readonly (readonly OffsetEffect[])[] {
  let seed = 1_902;
  const next = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const random = Array.from({ length: 12 }, () => {
    let at = 1_000;
    return Array.from({ length: 6 }, () => {
      at += Math.round(next() * 5_000);
      return slowDown(next() < 0.5 ? 'puddle' : 'crosswind-gust', at);
    });
  });
  return [
    [slowDown('puddle', 1_000)],
    Array.from({ length: 10 }, (_, index) => slowDown('crosswind-gust', 1_000 + 300 * index)),
    [slowDown('puddle', 1_000), slowDown('crosswind-gust', 5_001), slowDown('puddle', 9_002)],
    [slowDown('puddle', 1_000), slowDown('crosswind-gust', 5_100), slowDown('puddle', 9_150)],
    ...random,
  ];
}

describe('hitLook — #1902, WCAG 2.3.1', () => {
  it('draws a hit only while a slow-down runs, and nothing for a boost', () => {
    const tailwind: OffsetEffect = {
      rateMetresPerSecond: ITEM_RULES.tailwind.rateMetresPerSecond,
      fromMs: 0,
      untilMs: 4_000,
    };
    expect(hitLook([tailwind], 1_000, false)).toBeUndefined();
    const hit = slowDown('puddle', 1_000);
    expect(hitLook([hit], 999, false)).toBeUndefined();
    expect(hitLook([hit], 1_000, false)).toBeDefined();
    expect(hitLook([hit], 4_999, true)).toBeDefined();
    expect(hitLook([hit], 5_000, true)).toBeUndefined();
  });

  it('under reduced motion, changes luminance no more than three times in any second, and only to appear and go', () => {
    for (const effects of hitSequences()) {
      const changes = luminanceChanges(effects, true, 0, 40_000);
      expect(mostInASecond(changes)).toBeLessThanOrEqual(3);
      // Steady while it is drawn: one brightness, full size, unturned.
      for (let at = 0; at <= 40_000; at += 7) {
        const look = hitLook(effects, at, true);
        if (look === undefined) continue;
        expect(look).toEqual({ glow: HIT_GLOW_MEAN, scale: 1, spin: 0 });
      }
    }
    // One hit: it appears and goes, and that is all.
    expect(luminanceChanges([slowDown('puddle', 1_000)], true, 0, 6_000)).toEqual([1_000, 5_000]);
  });

  it('with motion, still changes luminance no more than three times in any second, however the hits fall', () => {
    for (const effects of hitSequences()) {
      expect(mostInASecond(luminanceChanges(effects, false, 0, 40_000))).toBeLessThanOrEqual(3);
    }
  });

  it('with motion, grows in, turns and swings its brightness on the race’s clock, which a second hit does not restart', () => {
    const first = slowDown('puddle', 1_000);
    const start = hitLook([first], 1_000, false);
    expect(start?.scale).toBeCloseTo(HIT_GROW_FROM, 9);
    expect(hitLook([first], 1_300, false)?.scale).toBe(1);
    expect(hitLook([first], 1_500, false)?.spin).not.toBe(start?.spin);
    const glows = Array.from({ length: 40 }, (_, index) =>
      brightness([first], 1_000 + 100 * index, false),
    );
    expect(Math.max(...glows) - Math.min(...glows)).toBeGreaterThan(HIT_GLOW_SWING);
    // A second hit at 2.2 s neither regrows the ring nor moves the brightness off the clock.
    const second = slowDown('crosswind-gust', 2_200);
    expect(hitLook([first, second], 2_200, false)?.glow).toBe(hitLook([first], 2_200, false)?.glow);
    expect(hitLook([first, second], 2_200, false)?.scale).toBe(1);
    // Hits stacked a slow-down apart never snap the ring back; one after a gap grows in afresh.
    const chain = [first, second, slowDown('puddle', 5_000)];
    for (let at = 1_300; at < 9_000; at += 10) {
      expect(hitLook(chain, at, false)?.scale, `at ${at}`).toBe(1);
    }
    const later = slowDown('puddle', 20_000);
    expect(hitLook([first, later], 20_000, false)?.scale).toBeCloseTo(HIT_GROW_FROM, 9);
    expect(1 / HIT_PULSE_HZ / 2).toBeGreaterThan(1);
  });
});
