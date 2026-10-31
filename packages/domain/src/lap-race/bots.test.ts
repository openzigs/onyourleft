// SPDX-License-Identifier: Apache-2.0

/**
 * #1900: the bots' tiers and decisions. Their effort, through the one physics,
 * is `packages/physics/src/lap-race-bot.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';

import {
  BOT_MASS_KILOGRAMS,
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
} from '../pacer/pacing';
import botsSource from './bots.ts?raw';
import { BOT_TIER_WATTS_PER_KILOGRAM, BOT_TIERS, botDecision, botTierPlan } from './bots';
import errorsSource from './errors.ts?raw';
import indexSource from './index.ts?raw';
import itemRaceSource from './item-race.ts?raw';
import { createItemRace } from './item-race';
import itemsSource from './items.ts?raw';
import { pickUpsPassed, STARTING_LANE, type ItemKind, type ItemRaceState } from './items';
import randomSource from './random.ts?raw';
import raceSource from './race.ts?raw';
import { raceCourse } from './race';

const COURSE = raceCourse(1_000, 3);

interface Spec {
  readonly id: string;
  readonly at: number;
  readonly lane?: number;
  readonly held?: ItemKind | null;
}

/** A field built by hand at `atMs`, as `items.test.ts` builds one. */
function field(specs: readonly Spec[], atMs = 5_000): ItemRaceState {
  const state = createItemRace({
    course: COURSE,
    seed: 1900,
    itemsOn: true,
    racerIds: specs.map((spec) => spec.id),
    startMs: atMs,
  });
  return {
    ...state,
    racers: state.racers.map((entry) => {
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

/** Whether `bot` uses its item on any of `ticks` successive seconds. */
function usesWithin(race: ItemRaceState, bot: string, ticks: number, seed = 1): boolean {
  for (let tick = 0; tick < ticks; tick += 1) {
    if (botDecision({ ...race, atMs: race.atMs + tick * 1_000 }, bot, seed).use) return true;
  }
  return false;
}

describe('tiers: a W/kg each, at the #92 bot’s fixed mass', () => {
  it('rises from the slowest tier to the fastest, inside the pacer’s envelope', () => {
    const intensities = BOT_TIERS.map((tier) => BOT_TIER_WATTS_PER_KILOGRAM[tier]);
    expect(intensities).toEqual([...intensities].sort((a, b) => a - b));
    expect(new Set(intensities).size).toBe(BOT_TIERS.length);
    for (const intensity of intensities) {
      expect(intensity).toBeGreaterThanOrEqual(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM);
      expect(intensity).toBeLessThanOrEqual(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM);
    }
  });

  it('builds each tier’s plan at 75 kg, never the rider’s mass', () => {
    for (const tier of BOT_TIERS) {
      expect(botTierPlan(tier)).toEqual({
        intensityWattsPerKilogram: BOT_TIER_WATTS_PER_KILOGRAM[tier],
        massKilograms: BOT_MASS_KILOGRAMS,
      });
    }
  });
});

describe('decisions: when to use the held item, and which lane', () => {
  it('rides round a puddle ahead in its lane, and not round one in another lane', () => {
    const base = field([
      { id: 'bot', at: 100, lane: 1 },
      { id: 'x', at: 300, lane: 0 },
    ]);
    const puddle = (lane: number): ItemRaceState => ({
      ...base,
      hazards: [{ position: 108, lane, ownerId: 'x', untilMs: 1e9 }],
    });
    expect(botDecision(puddle(1), 'bot', 1).lane).not.toBe(1);
    expect(botDecision(puddle(2), 'bot', 1).lane).toBe(1);
    // From an edge lane, toward the middle.
    const edge = { ...puddle(0), racers: puddle(0).racers.map((e) => ({ ...e, lane: 0 })) };
    expect(botDecision(edge, 'bot', 1).lane).toBe(1);
  });

  it('moves out of the lane of a racer close behind on some ticks, and never for one in another lane', () => {
    const chased = (lane: number): ItemRaceState =>
      field([
        { id: 'bot', at: 100, lane: 1 },
        { id: 'x', at: 92, lane },
      ]);
    const lanes = (race: ItemRaceState): Set<number> =>
      new Set(
        Array.from(
          { length: 40 },
          (_, tick) => botDecision({ ...race, atMs: race.atMs + tick * 1_000 }, 'bot', 1).lane,
        ),
      );
    expect(lanes(chased(1)).size).toBeGreaterThan(1);
    expect([...lanes(chased(0))]).toEqual([1]);
  });

  it('steers into the lane of the racer just ahead when holding a gust, and fires it there', () => {
    const race = field([
      { id: 'bot', at: 100, lane: 1, held: 'crosswind-gust' },
      { id: 'x', at: 120, lane: 2 },
    ]);
    expect(botDecision(race, 'bot', 1).lane).toBe(2);
    expect(usesWithin(race, 'bot', 10)).toBe(true);
    // Too far ahead to aim at: it keeps its lane, and the gust would miss, so it waits.
    const far = field([
      { id: 'bot', at: 100, lane: 1, held: 'crosswind-gust' },
      { id: 'x', at: 200, lane: 2 },
    ]);
    expect(botDecision(far, 'bot', 1).lane).toBe(1);
    expect(usesWithin(far, 'bot', 10)).toBe(false);
  });

  it('uses each item only when the race gives it a reason', () => {
    const alone = (held: ItemKind): ItemRaceState => field([{ id: 'bot', at: 100, held }]);
    expect(usesWithin(alone('tailwind'), 'bot', 10)).toBe(true);
    expect(usesWithin(alone('slipstream'), 'bot', 10)).toBe(false);
    expect(usesWithin(alone('puddle'), 'bot', 10)).toBe(false);
    expect(usesWithin(alone('rain-cape'), 'bot', 10)).toBe(false);
    const towed = field([
      { id: 'bot', at: 100, held: 'slipstream' },
      { id: 'x', at: 110 },
    ]);
    expect(usesWithin(towed, 'bot', 10)).toBe(true);
    const chased = (held: ItemKind, lane: number): ItemRaceState =>
      field([
        { id: 'bot', at: 100, lane: 1, held },
        { id: 'x', at: 92, lane },
      ]);
    expect(usesWithin(chased('puddle', 1), 'bot', 10)).toBe(true);
    expect(usesWithin(chased('puddle', 0), 'bot', 10)).toBe(false);
    expect(usesWithin(chased('rain-cape', 0), 'bot', 10)).toBe(true);
    expect(usesWithin(field([{ id: 'bot', at: 100 }]), 'bot', 10)).toBe(false);
  });

  it('does nothing once finished, and nothing for an id not in the race', () => {
    const race = field([{ id: 'bot', at: 100, lane: 2, held: 'tailwind' }]);
    const finished: ItemRaceState = {
      ...race,
      racers: race.racers.map((entry) => ({
        ...entry,
        racer: { ...entry.racer, finishedAtMs: 1, lineMetres: 3_000 },
      })),
    };
    expect(botDecision(finished, 'bot', 1)).toEqual({ use: false, lane: 2 });
    expect(botDecision(race, 'nobody', 1).use).toBe(false);
  });

  it('is a pure function of the race, the bot and the seed, and the seed matters', () => {
    const race = field([
      { id: 'bot', at: 100, lane: 1, held: 'tailwind' },
      { id: 'x', at: 108, lane: 1 },
    ]);
    const decisions = (seed: number): string =>
      JSON.stringify(
        Array.from({ length: 50 }, (_, tick) =>
          botDecision({ ...race, atMs: race.atMs + tick * 1_000 }, 'bot', seed),
        ),
      );
    expect(decisions(3)).toBe(decisions(3));
    expect(decisions(3)).not.toBe(decisions(4));
    // It draws nothing from the race's own generator.
    const before = JSON.stringify(race);
    botDecision(race, 'bot', 3);
    expect(JSON.stringify(race)).toBe(before);
  });
});

describe('never from a recorded ride (ADR 0007 D4, ADR 0060 D-7.1)', () => {
  it('imports nothing from ghost/ or recording/, in any lap-race module', () => {
    const sources = {
      'bots.ts': botsSource,
      'errors.ts': errorsSource,
      'index.ts': indexSource,
      'item-race.ts': itemRaceSource,
      'items.ts': itemsSource,
      'random.ts': randomSource,
      'race.ts': raceSource,
    };
    let read = 0;
    for (const [file, source] of Object.entries(sources)) {
      const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)].map(
        (match) => match[1] ?? match[2] ?? '',
      );
      read += specifiers.length;
      for (const specifier of specifiers) {
        expect(specifier, file).not.toMatch(/(?:^|\/)(?:ghost|recording)(?:\/|$)/);
        // Inside the package only: the domain barrel would reach every module.
        expect(specifier, file).toMatch(/^\.\.?\//);
      }
    }
    // The scan reads imports: a broken pattern that matched none would pass for ever.
    expect(read).toBeGreaterThan(10);
    // The one import from outside lap-race/ is the #92 pacing rule.
    expect(botsSource).toContain("from '../pacer/pacing'");
  });
});
