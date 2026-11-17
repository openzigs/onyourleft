// SPDX-License-Identifier: Apache-2.0

/**
 * #2759, ADR 0075: the field of a race with AI bots. Each racing style its
 * pace and a body that fits it, a spread of strength whose middle is the tier
 * the rider chose, and how each bot compares with the field in plain words.
 * What a body does on the road, on the one physics, is
 * `@onyourleft/physics` §`lap-race-bot.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { BOT_MASS_KILOGRAMS, MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM } from '../pacer/pacing';
import { botArchetype, type BotArchetype } from './archetype';
import { BOT_TIER_WATTS_PER_KILOGRAM, BOT_TIERS } from './bots';
import { LapRaceError } from './errors';
import {
  MODEL_FIELD_MASS_JITTER_KILOGRAMS,
  MODEL_FIELD_STRENGTH_SPREAD,
  MODEL_STRENGTH_MARGIN,
  MODEL_STYLE_BODY,
  MODEL_STYLE_PACE,
  modelFieldPaces,
  modelFieldStrengths,
  modelRacingStyleOf,
} from './model-field';
import { MODEL_RACING_STYLES, modelRacingStyles, type ModelRacingStyle } from './model-tactics';
import { BOT_PACING_STYLES, checkBotPace } from './pace';
import { BOT_PLAN_SURGE_CEILING, BOT_WPRIME_JOULES, botRacePlan, botWPrimeJoules } from './plan';
import { raceCourse } from './race';
import { botCeilingWatts, BOT_CEILING_WATTS, spendableWatts, type BotCapacity } from './wbal';

const COURSE = raceCourse(2_000, 3);
const SEEDS = Array.from({ length: 100 }, (_, seed) => seed);

/** The thrown error's code, or `undefined` if nothing was thrown. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof LapRaceError ? error.code : 'not a LapRaceError';
  }
  return undefined;
}

/** A field of `count` as the race builds it: each bot's plan, with its racing style. */
function field(seed: number, count = 7, tier: (typeof BOT_TIERS)[number] = 'brisk') {
  const styles = modelRacingStyles(seed, count);
  return modelFieldPaces(seed, count).map((pace, at) => ({
    style: styles[at] as ModelRacingStyle,
    pace,
    plan: botRacePlan(tier, COURSE, seed, pace),
  }));
}

const massOf = (capacity: BotCapacity) => capacity.massKilograms ?? BOT_MASS_KILOGRAMS;

describe('each racing style its pace, its legs and its body (ADR 0075 D-3)', () => {
  const LEGS: Readonly<Record<ModelRacingStyle, BotArchetype>> = {
    breakaway: 'attacker',
    sprinter: 'sprinter',
    climber: 'climber',
    rouleur: 'rouleur',
    opportunist: 'attacker',
  };

  it('deals each style the pace whose legs fit it, on the styles the race deals, every seed of 100', () => {
    for (const seed of SEEDS) {
      const styles = modelRacingStyles(seed, 7);
      const paces = modelFieldPaces(seed, 7);
      expect(
        paces.map((pace) => modelRacingStyleOf(pace.style)),
        String(seed),
      ).toEqual(styles);
      paces.forEach((pace, at) => {
        const style = styles[at] as ModelRacingStyle;
        expect(pace.style).toBe(MODEL_STYLE_PACE[style]);
        expect(botArchetype(pace.style), style).toBe(LEGS[style]);
        expect(pace.ability).toBe(1);
        expect(() => {
          checkBotPace(pace);
        }).not.toThrow();
      });
    }
  });

  it('reads every pace back to one style, and every style to one pace', () => {
    expect(new Set(Object.values(MODEL_STYLE_PACE)).size).toBe(MODEL_RACING_STYLES.length);
    for (const style of MODEL_RACING_STYLES) {
      expect(modelRacingStyleOf(MODEL_STYLE_PACE[style])).toBe(style);
    }
    for (const pace of BOT_PACING_STYLES) {
      expect(MODEL_STYLE_PACE[modelRacingStyleOf(pace)]).toBe(pace);
    }
  });

  it('gives each style the strengths its riders have, over 100 fields', () => {
    const totals = new Map<
      ModelRacingStyle,
      { n: number; cp: number; perKg: number; wPrime: number; peak: number; mass: number }
    >();
    for (const seed of SEEDS) {
      for (const { style, plan } of field(seed)) {
        const sum = totals.get(style) ?? { n: 0, cp: 0, perKg: 0, wPrime: 0, peak: 0, mass: 0 };
        const mass = massOf(plan.capacity);
        totals.set(style, {
          n: sum.n + 1,
          cp: sum.cp + plan.capacity.cpWatts,
          perKg: sum.perKg + plan.capacity.cpWatts / mass,
          wPrime: sum.wPrime + plan.capacity.wPrimeJoules,
          peak: sum.peak + plan.capacity.peakWatts,
          mass: sum.mass + mass,
        });
      }
    }
    const mean = (style: ModelRacingStyle, key: 'cp' | 'perKg' | 'wPrime' | 'peak' | 'mass') => {
      const sum = totals.get(style);
      return sum === undefined ? Number.NaN : sum[key] / sum.n;
    };
    const best = (key: 'cp' | 'perKg' | 'wPrime' | 'peak' | 'mass', sign = 1) =>
      [...MODEL_RACING_STYLES].sort((a, b) => sign * (mean(b, key) - mean(a, key)))[0];
    // A climber is the lightest, with the most W/kg; a sprinter the heaviest,
    // with the biggest W′ and peak; a rouleur the most watts at threshold.
    expect(best('mass', -1)).toBe('climber');
    expect(best('perKg')).toBe('climber');
    expect(best('mass')).toBe('sprinter');
    expect(best('wPrime')).toBe('sprinter');
    expect(best('peak')).toBe('sprinter');
    expect(best('cp')).toBe('rouleur');
    // And the climber has the fewest watts on the flat.
    expect(best('cp', -1)).toBe('climber');
  });

  it('holds every style’s CP shares to a mean of one, and every peak under the surge ceiling', () => {
    const shares = MODEL_RACING_STYLES.map((style) => MODEL_STYLE_BODY[style].cpShare);
    expect(shares.reduce((sum, share) => sum + share, 0) / shares.length).toBeCloseTo(1, 12);
    for (const style of MODEL_RACING_STYLES) {
      expect(MODEL_STYLE_BODY[style].peakShare).toBeLessThanOrEqual(BOT_PLAN_SURGE_CEILING);
    }
  });
});

describe('a spread of strength whose middle is the tier (ADR 0075 D-2)', () => {
  it('holds the field’s mean CP in W/kg to the tier, every tier, size and seed of 100', () => {
    for (const tier of BOT_TIERS) {
      for (let count = 1; count <= 7; count += 1) {
        for (const seed of SEEDS) {
          const plans = field(seed, count, tier).map((bot) => bot.plan);
          const mean =
            plans.reduce((sum, plan) => sum + plan.capacity.cpWatts / massOf(plan.capacity), 0) /
            plans.length;
          expect(mean, `${tier} ${String(count)} ${String(seed)}`).toBeCloseTo(
            BOT_TIER_WATTS_PER_KILOGRAM[tier],
            9,
          );
        }
      }
    }
  });

  it('spreads every field of seven over and under the tier, so a hard move can drop the weakest', () => {
    for (const seed of SEEDS) {
      const perKg = field(seed).map(({ plan }) => plan.capacity.cpWatts / massOf(plan.capacity));
      const tier = BOT_TIER_WATTS_PER_KILOGRAM.brisk;
      expect(Math.max(...perKg), String(seed)).toBeGreaterThan(tier * 1.04);
      expect(Math.min(...perKg), String(seed)).toBeLessThan(tier * 0.96);
      expect(Math.max(...perKg) / Math.min(...perKg), String(seed)).toBeGreaterThan(1.12);
    }
  });

  it('deals strengths one to each share of the band, and masses near their style’s', () => {
    for (const seed of SEEDS) {
      const styles = modelRacingStyles(seed, 7);
      const paces = modelFieldPaces(seed, 7);
      const strengths = paces.map((pace) => pace.body?.strength ?? Number.NaN);
      // Seven different strengths, inside the band give or take the field's one scale.
      expect(new Set(strengths).size).toBe(7);
      for (const strength of strengths) {
        expect(strength).toBeGreaterThan((1 - MODEL_FIELD_STRENGTH_SPREAD) / 1.05);
        expect(strength).toBeLessThan((1 + MODEL_FIELD_STRENGTH_SPREAD) * 1.05);
      }
      paces.forEach((pace, at) => {
        const style = styles[at] as ModelRacingStyle;
        expect(
          Math.abs((pace.body?.massKilograms ?? 0) - MODEL_STYLE_BODY[style].massKilograms),
        ).toBeLessThanOrEqual(MODEL_FIELD_MASS_JITTER_KILOGRAMS);
      });
      expect(
        paces.some(
          (pace, at) =>
            pace.body?.massKilograms !==
            MODEL_STYLE_BODY[styles[at] as ModelRacingStyle].massKilograms,
        ),
      ).toBe(true);
    }
  });

  it('deals the same field for the same seed, and a different one for every other seed', () => {
    expect(modelFieldPaces(7, 7)).toEqual(modelFieldPaces(7, 7));
    const fields = new Set(SEEDS.map((seed) => JSON.stringify(modelFieldPaces(seed, 7))));
    expect(fields.size).toBe(SEEDS.length);
    expect(modelFieldPaces(5, 0)).toEqual([]);
  });

  it('refuses a seed or a count that is not a whole number, naming neither', () => {
    expect(codeOf(() => modelFieldPaces(1.5, 7))).toBe('seed-not-integer');
    for (const count of [-1, 2.5, Number.NaN]) {
      expect(codeOf(() => modelFieldPaces(1, count))).toBe('field-invalid');
    }
  });
});

describe('a body in the race plan (ADR 0075 D-2)', () => {
  it('sets CP, W′, peak and floor from its strength at its own mass, and carries the mass', () => {
    const body = { massKilograms: 64, strength: 1.07 };
    const pace = { style: 'sprinter' as const, ability: 1, body };
    const plan = botRacePlan('hard', COURSE, 3, pace);
    const own = BOT_TIER_WATTS_PER_KILOGRAM.hard * 64 * 1.07;
    expect(plan.tierWatts).toBe(own);
    expect(plan.capacity.cpWatts).toBe(own * MODEL_STYLE_BODY.sprinter.cpShare);
    expect(plan.capacity.peakWatts).toBe(own * MODEL_STYLE_BODY.sprinter.peakShare);
    expect(plan.capacity.floorWatts).toBe(own * 0.8);
    expect(plan.capacity.massKilograms).toBe(64);
    expect(plan.capacity.wPrimeJoules).toBe(
      ((BOT_WPRIME_JOULES.hard * 64) / BOT_MASS_KILOGRAMS) *
        1.07 *
        MODEL_STYLE_BODY.sprinter.wPrimeShare,
    );
    expect(botWPrimeJoules('hard', pace)).toBe(plan.capacity.wPrimeJoules);
    // Its legs are still its pace's: the sprinter's kick.
    expect(plan.archetype).toBe('sprinter');
  });

  it('leaves a bot with no body as it was: 75 kg, its ability, and no mass in its capacity', () => {
    const plan = botRacePlan('hard', COURSE, 3, { style: 'climber', ability: 0.97 });
    expect(plan.tierWatts).toBe(BOT_TIER_WATTS_PER_KILOGRAM.hard * BOT_MASS_KILOGRAMS);
    expect('massKilograms' in plan.capacity).toBe(false);
  });
});

describe('the 7 W/kg ceiling at a bot’s own mass (ADR 0075 D-2.4)', () => {
  const capacity = (massKilograms?: number): BotCapacity => ({
    cpWatts: 200,
    wPrimeJoules: 20_000,
    peakWatts: 2_000,
    floorWatts: 100,
    ...(massKilograms === undefined ? {} : { massKilograms }),
  });

  it('caps a light bot lower than a heavy one, and a bot with no mass at 75 kg', () => {
    expect(botCeilingWatts(capacity())).toBe(BOT_CEILING_WATTS);
    expect(botCeilingWatts(capacity(60))).toBe(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * 60);
    const full = (c: BotCapacity) =>
      spendableWatts(c, { wbalJoules: c.wPrimeJoules, exhausted: false }, 5_000, 0);
    expect(full(capacity(60))).toBe(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * 60);
    expect(full(capacity(90))).toBe(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * 90);
    expect(full(capacity())).toBe(BOT_CEILING_WATTS);
  });

  it('refuses a mass that is not a finite weight above zero', () => {
    for (const mass of [0, -1, Number.NaN, Infinity]) {
      expect(
        codeOf(() => spendableWatts(capacity(mass), { wbalJoules: 0, exhausted: false }, 100, 1)),
      ).toBe('capacity-out-of-range');
    }
  });
});

describe('how a bot compares with the field, in plain words (ADR 0075 D-4)', () => {
  const at = (cpWatts: number, massKilograms: number, peakWatts: number, wPrimeJoules: number) =>
    ({ cpWatts, massKilograms, peakWatts, wPrimeJoules, floorWatts: 0 }) as BotCapacity;

  it('calls a bot strong or weak only past the margin from the field’s mean', () => {
    const margin = MODEL_STRENGTH_MARGIN;
    // Four bots whose mean CP is 200 W: just past the margin either side, and just inside it.
    const over = 200 * (1 + margin) + 1;
    const under = 200 * (1 - margin) - 1;
    const words = modelFieldStrengths([
      at(over, 70, 400, 15_000),
      at(200 * (1 + margin) - 1, 70, 400, 15_000),
      at(200 * (1 - margin) + 1, 70, 400, 15_000),
      at(under, 70, 400, 15_000),
    ]);
    expect(words.map((word) => word.flat)).toEqual(['strong', 'average', 'average', 'weak']);
    // The same watts per kilogram, and the same peak and W′, are average.
    expect(words.map((word) => word.sprint)).toEqual(['average', 'average', 'average', 'average']);
    expect(words.map((word) => word.punch)).toEqual(['average', 'average', 'average', 'average']);
  });

  it('reads a climb per kilogram, a sprint at what the body allows, and punch as W′', () => {
    const words = modelFieldStrengths([
      // Light: weak on the flat, strong on a climb.
      at(200, 60, 300, 10_000),
      // Heavy, with a peak over 7 W/kg that its body caps, and a big W′.
      at(260, 95, 900, 20_000),
      at(230, 75, 400, 15_000),
    ]);
    expect(words[0]).toEqual({ flat: 'weak', climb: 'strong', sprint: 'weak', punch: 'weak' });
    expect(words[1]).toEqual({ flat: 'strong', climb: 'weak', sprint: 'strong', punch: 'strong' });
    expect(words[2]?.flat).toBe('average');
    // The heavy bot's sprint is read at 7 W/kg × its mass, not its 900 W.
    const capped = modelFieldStrengths([at(200, 85, 900, 1), at(200, 85, 595, 1)]);
    expect(capped.map((word) => word.sprint)).toEqual(['average', 'average']);
  });

  it('calls a field of one average at everything, and a bot with no mass 75 kg', () => {
    expect(modelFieldStrengths([at(250, 70, 400, 15_000)])).toEqual([
      { flat: 'average', climb: 'average', sprint: 'average', punch: 'average' },
    ]);
    expect(modelFieldStrengths([])).toEqual([]);
    const seeded = { cpWatts: 225, wPrimeJoules: 15_000, peakWatts: 400, floorWatts: 0 };
    const words = modelFieldStrengths([seeded, at(225, 75, 400, 15_000)]);
    expect(words[0]).toEqual(words[1]);
  });

  it('calls each style strong where its body is, more often than any other style, over 100 fields', () => {
    const strong = new Map<string, number>();
    const dealt = new Map<string, number>();
    for (const seed of SEEDS) {
      const bots = field(seed);
      const words = modelFieldStrengths(bots.map((bot) => bot.plan.capacity));
      bots.forEach(({ style }, index) => {
        dealt.set(style, (dealt.get(style) ?? 0) + 1);
        for (const [key, word] of Object.entries(words[index] ?? {})) {
          if (word === 'strong')
            strong.set(`${style} ${key}`, (strong.get(`${style} ${key}`) ?? 0) + 1);
        }
      });
    }
    // As a share of the times each style was dealt: two are dealt twice in a field of seven.
    const rate = (style: string, key: string) =>
      (strong.get(`${style} ${key}`) ?? 0) / (dealt.get(style) ?? 1);
    const most = (key: string) =>
      [...MODEL_RACING_STYLES].sort((a, b) => rate(b, key) - rate(a, key))[0];
    expect(most('climb')).toBe('climber');
    expect(most('sprint')).toBe('sprinter');
    expect(most('punch')).toBe('sprinter');
    expect(most('flat')).toBe('rouleur');
  });
});
