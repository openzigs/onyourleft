// SPDX-License-Identifier: Apache-2.0

/**
 * #2459: each lap-race bot's rider archetype, read off the pace #2455 deals
 * it, and the tactics skill's misjudgement of the race (ADR 0067 D-1.1, D-7).
 * The race-level checks (tier order with every archetype dealt, a sprinter's
 * finish and a climber's hills) ride the one physics, in `@onyourleft/physics`
 * §`lap-race-bot.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { BOT_MASS_KILOGRAMS, MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM } from '../pacer/pacing';
import {
  BOT_ARCHETYPE_ATTACK_PROPENSITY,
  BOT_ARCHETYPE_CLIMB_GRADE_PERCENT,
  BOT_ARCHETYPE_CP_SHARE,
  BOT_ARCHETYPE_PEAK_SHARE,
  BOT_ARCHETYPE_RECOVERY_FACTOR,
  BOT_ARCHETYPE_SPRINT_FACTOR,
  BOT_ARCHETYPE_WPRIME_FACTOR,
  BOT_ARCHETYPES,
  BOT_STYLE_ARCHETYPE,
  BOT_TACTICS_MISJUDGE_GAP_METRES,
  BOT_TACTICS_MISJUDGE_LINE_METRES,
  BOT_TACTICS_MISJUDGE_WBAL_SHARE,
  BOT_TACTICS_WINDOW_MS,
  botArchetype,
  botFieldArchetypes,
  botTacticsMisjudgement,
  type BotArchetype,
} from './archetype';
import archetypeSource from './archetype.ts?raw';
import { BOT_TIER_WATTS_PER_KILOGRAM, BOT_TIERS } from './bots';
import { LapRaceError } from './errors';
import * as lapRace from './index';
import { BOT_ABILITY_SPREAD, BOT_PACING_STYLES, botFieldPaces } from './pace';
import { BOT_PLAN_SURGE_CEILING, botRacePlan } from './plan';
import { raceCourse } from './race';
import { BOT_SKILL_MISJUDGEMENT, BOT_SKILLS } from './strategy';

/** The thrown error's code, or `undefined` if nothing was thrown. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof LapRaceError ? error.code : 'not a LapRaceError';
  }
  return undefined;
}

const COURSE = raceCourse(2_000, 3);

describe('a field is dealt a mix of archetypes from the race’s seed (#2459)', () => {
  it('deals at least three archetypes in every field of seven over 100 seeds, the same field for the same seed', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const field = botFieldArchetypes(seed, 7);
      expect(field, String(seed)).toHaveLength(7);
      expect(new Set(field).size, String(seed)).toBeGreaterThanOrEqual(3);
      expect(botFieldArchetypes(seed, 7), String(seed)).toEqual(field);
      // The archetype is the dealt pace's: one deal, not two.
      expect(field).toEqual(botFieldPaces(seed, 7).map((pace) => botArchetype(pace.style)));
    }
  });

  it('reads every style to an archetype, and every archetype from some style', () => {
    for (const style of BOT_PACING_STYLES) {
      expect(BOT_ARCHETYPES).toContain(BOT_STYLE_ARCHETYPE[style]);
    }
    expect(new Set(BOT_PACING_STYLES.map(botArchetype))).toEqual(new Set(BOT_ARCHETYPES));
    // A bot the standings call a climber or a sprinter is one.
    expect(botArchetype('climber')).toBe('climber');
    expect(botArchetype('sprinter')).toBe('sprinter');
    expect(botArchetype('even')).toBe('rouleur');
  });

  it('refuses what botFieldPaces refuses', () => {
    expect(codeOf(() => botFieldArchetypes(1.5, 3))).toBe('seed-not-integer');
    expect(codeOf(() => botFieldArchetypes(1, -1))).toBe('field-invalid');
  });
});

describe('each archetype is a power profile within its tier (ADR 0067 D-1.1, ADR 0061 D-8.2)', () => {
  const tables: readonly (readonly [string, Readonly<Record<BotArchetype, unknown>>])[] = [
    ['cp', BOT_ARCHETYPE_CP_SHARE],
    ['wprime', BOT_ARCHETYPE_WPRIME_FACTOR],
    ['peak', BOT_ARCHETYPE_PEAK_SHARE],
    ['recovery', BOT_ARCHETYPE_RECOVERY_FACTOR],
    ['climb', BOT_ARCHETYPE_CLIMB_GRADE_PERCENT],
    ['sprint', BOT_ARCHETYPE_SPRINT_FACTOR],
    ['attack', BOT_ARCHETYPE_ATTACK_PROPENSITY],
  ];

  it('has a row for every archetype in every column, each a finite number of at least zero', () => {
    for (const [name, table] of tables) {
      expect(Object.keys(table).sort(), name).toEqual([...BOT_ARCHETYPES].sort());
      for (const archetype of BOT_ARCHETYPES) {
        const row = table[archetype];
        const numbers = typeof row === 'number' ? [row] : Object.values(row as object);
        for (const value of numbers) {
          expect(Number.isFinite(value) && (value as number) >= 0, `${name} ${archetype}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('keeps every archetype’s CP at or under its tier and its peak at or under the surge ceiling, in every tier', () => {
    for (const archetype of BOT_ARCHETYPES) {
      expect(BOT_ARCHETYPE_CP_SHARE[archetype], archetype).toBeLessThanOrEqual(1);
      expect(BOT_ARCHETYPE_PEAK_SHARE[archetype], archetype).toBeLessThanOrEqual(
        BOT_PLAN_SURGE_CEILING,
      );
      expect(BOT_ARCHETYPE_PEAK_SHARE[archetype], archetype).toBeGreaterThan(1);
    }
    for (const tier of BOT_TIERS) {
      for (const style of BOT_PACING_STYLES) {
        const plan = botRacePlan(tier, COURSE, 1, { style, ability: 1 });
        expect(plan.capacity.cpWatts, `${tier} ${style}`).toBeLessThanOrEqual(plan.tierWatts);
        expect(plan.capacity.peakWatts, `${tier} ${style}`).toBeLessThanOrEqual(
          Math.min(
            plan.tierWatts * BOT_PLAN_SURGE_CEILING,
            MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * BOT_MASS_KILOGRAMS,
          ),
        );
      }
    }
    // The weakest bot of a tier is still stronger than the strongest of the tier below.
    const weakest =
      Math.min(...BOT_ARCHETYPES.map((each) => BOT_ARCHETYPE_CP_SHARE[each])) *
      (1 - BOT_ABILITY_SPREAD);
    for (let index = 1; index < BOT_TIERS.length; index += 1) {
      const tier = BOT_TIERS[index] as (typeof BOT_TIERS)[number];
      const below = BOT_TIERS[index - 1] as (typeof BOT_TIERS)[number];
      expect(BOT_TIER_WATTS_PER_KILOGRAM[tier] * weakest).toBeGreaterThan(
        BOT_TIER_WATTS_PER_KILOGRAM[below],
      );
    }
  });

  it('gives the sprinter the largest W′, the highest peak and the longest kick, and the climber the steepest climbing', () => {
    const others = (archetype: BotArchetype): readonly BotArchetype[] =>
      BOT_ARCHETYPES.filter((each) => each !== archetype);
    for (const other of others('sprinter')) {
      expect(BOT_ARCHETYPE_WPRIME_FACTOR.sprinter).toBeGreaterThan(
        BOT_ARCHETYPE_WPRIME_FACTOR[other],
      );
      expect(BOT_ARCHETYPE_PEAK_SHARE.sprinter).toBeGreaterThan(BOT_ARCHETYPE_PEAK_SHARE[other]);
      expect(BOT_ARCHETYPE_SPRINT_FACTOR.sprinter).toBeGreaterThan(
        BOT_ARCHETYPE_SPRINT_FACTOR[other],
      );
    }
    for (const other of others('climber')) {
      expect(BOT_ARCHETYPE_CLIMB_GRADE_PERCENT.climber).toBeLessThan(
        BOT_ARCHETYPE_CLIMB_GRADE_PERCENT[other],
      );
    }
    for (const other of others('rouleur')) {
      expect(BOT_ARCHETYPE_CP_SHARE.rouleur).toBeGreaterThan(BOT_ARCHETYPE_CP_SHARE[other]);
      expect(BOT_ARCHETYPE_RECOVERY_FACTOR.rouleur).toBeGreaterThan(
        BOT_ARCHETYPE_RECOVERY_FACTOR[other],
      );
    }
  });
});

describe('the tactics skill misjudges the race, once per window (#2459, ADR 0067 D-7)', () => {
  it('misjudges by nothing when crafty, and by different amounts at different skills of the same capacity', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const crafty = botTacticsMisjudgement(seed, 2, 'crafty', 12_345);
      expect(
        Math.abs(crafty.gapMetres) + Math.abs(crafty.lineMetres) + Math.abs(crafty.wbalShare),
      ).toBe(0);
      const naive = botTacticsMisjudgement(seed, 2, 'naive', 12_345);
      const canny = botTacticsMisjudgement(seed, 2, 'canny', 12_345);
      expect(naive).not.toEqual(canny);
      // One draw, scaled by the skill: canny's is naive's times its share.
      const share = BOT_SKILL_MISJUDGEMENT.canny / BOT_SKILL_MISJUDGEMENT.naive;
      expect(canny.gapMetres).toBeCloseTo(naive.gapMetres * share, 9);
      expect(canny.lineMetres).toBeCloseTo(naive.lineMetres * share, 9);
      expect(canny.wbalShare).toBeCloseTo(naive.wbalShare * share, 9);
      expect(Math.abs(naive.gapMetres)).toBeLessThanOrEqual(BOT_TACTICS_MISJUDGE_GAP_METRES);
      expect(Math.abs(naive.lineMetres)).toBeLessThanOrEqual(BOT_TACTICS_MISJUDGE_LINE_METRES);
      expect(Math.abs(naive.wbalShare)).toBeLessThanOrEqual(BOT_TACTICS_MISJUDGE_WBAL_SHARE);
    }
  });

  it('reads the same error at 0.05 s and at 1 s ticks, and a new one each window', () => {
    for (const skill of BOT_SKILLS) {
      const fine: string[] = [];
      for (let atMs = 0; atMs < 30_000; atMs += 50) {
        // Every tick of a window reads the window's error.
        const here = botTacticsMisjudgement(9, 4, skill, atMs);
        const start = botTacticsMisjudgement(
          9,
          4,
          skill,
          Math.floor(atMs / BOT_TACTICS_WINDOW_MS) * BOT_TACTICS_WINDOW_MS,
        );
        expect(here).toEqual(start);
        if (atMs % 1_000 === 0) fine.push(JSON.stringify(here));
      }
      const coarse: string[] = [];
      for (let atMs = 0; atMs < 30_000; atMs += 1_000) {
        coarse.push(JSON.stringify(botTacticsMisjudgement(9, 4, skill, atMs)));
      }
      expect(coarse).toEqual(fine);
      if (skill === 'naive') expect(new Set(coarse).size).toBeGreaterThan(25);
    }
  });

  it('draws apart for each bot and each seed', () => {
    const at = (seed: number, index: number) => botTacticsMisjudgement(seed, index, 'naive', 0);
    expect(at(1, 0)).not.toEqual(at(1, 1));
    expect(at(1, 0)).not.toEqual(at(2, 0));
    expect(at(1, 0)).toEqual(at(1, 0));
  });

  it('refuses a seed, a seat or a time that is not one', () => {
    expect(codeOf(() => botTacticsMisjudgement(Number.NaN, 0, 'naive', 0))).toBe(
      'seed-not-integer',
    );
    expect(codeOf(() => botTacticsMisjudgement(1, -1, 'naive', 0))).toBe('field-invalid');
    expect(codeOf(() => botTacticsMisjudgement(1, 0.5, 'naive', 0))).toBe('field-invalid');
    expect(codeOf(() => botTacticsMisjudgement(1, 0, 'naive', -1))).toBe('instant-not-finite');
    expect(codeOf(() => botTacticsMisjudgement(1, 0, 'naive', Number.NaN))).toBe(
      'instant-not-finite',
    );
  });
});

describe('every archetype and skill number is a named, exported constant (#2459)', () => {
  it('exports every constant the module declares, through the lap-race index', () => {
    const declared = [...archetypeSource.matchAll(/^export const (\w+)/gm)].map(
      (match) => match[1],
    );
    expect(declared.length).toBeGreaterThanOrEqual(13);
    for (const name of declared) {
      expect(Object.keys(lapRace), name).toContain(name);
    }
    // No bare number is declared outside an exported constant, but the salt.
    const privates = [...archetypeSource.matchAll(/^const (\w+)\b/gm)].map((match) => match[1]);
    expect(privates).toEqual(['TACTICS_SALT']);
  });

  it('names no exponential, power, random draw or clock (ADR 0067 D-5.2)', () => {
    const code = archetypeSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.(exp|pow|random)|\*\*|Date\b|performance\./);
  });
});
