// SPDX-License-Identifier: Apache-2.0

/**
 * #1960, ADR 0061: the lap-race bots' course-only race plan, as pure
 * functions. The race-level checks (the mean over a race, the tier order, the
 * surges on a hilly loop, lead or trail) ride the one physics, in
 * `@onyourleft/physics` §`lap-race-bot.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  BOT_MASS_KILOGRAMS,
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  PACING_CLIMB_REFERENCE_GRADE_PERCENT,
  PACING_FACTOR_FLOOR,
} from '../pacer/pacing';
import { BOT_TIER_WATTS_PER_KILOGRAM, BOT_TIERS } from './bots';
import { LapRaceError } from './errors';
import {
  BOT_ABILITY_SPREAD,
  BOT_CLIMBER_GRADE_PERCENT,
  BOT_EVEN_PACE,
  BOT_PACING_STYLES,
  BOT_SPRINTER_GRADE_PERCENT,
  BOT_SPRINTER_SPRINT_FACTOR,
  BOT_STYLE_BUDGET_FACTOR,
  BOT_STYLE_EASING,
  type BotPace,
} from './pace';
import {
  BOT_PLAN_BANKING,
  BOT_PLAN_FLAT_GRADE_PERCENT,
  BOT_PLAN_SURGE_CEILING,
  BOT_SPRINT_LONGEST_METRES,
  BOT_SPRINT_SHORTEST_METRES,
  BOT_TIER_BUDGET_JOULES,
  botPlanStep,
  botRacePlan,
  type BotRacePlan,
} from './plan';
import { raceCourse } from './race';

/** Three laps of 2 km: long enough that the sprint is a part of the race. */
const COURSE = raceCourse(2_000, 3);
const HARD = botRacePlan('hard', COURSE, 1);
/** 3.6 W/kg at 75 kg. */
const TIER = 270;
/** Somewhere mid-race, far from the sprint. */
const MID = 1_000;

function step(plan: BotRacePlan, reserve: number, grade: number, at = MID, elapsed = 1) {
  return botPlanStep(plan, reserve, { effortDistance: at, grade, elapsed });
}

/** The thrown error's code, or `undefined` if nothing was thrown. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof LapRaceError ? error.code : 'not a LapRaceError';
  }
  return undefined;
}

describe('a plan is fixed from the tier, the course and the race’s seed (ADR 0061 D-2)', () => {
  it('holds the tier’s power at 75 kg, the bounds of D-8.2 and the race’s length', () => {
    expect(HARD.tierWatts).toBeCloseTo(TIER, 9);
    expect(HARD.surgeWatts).toBeCloseTo(TIER * BOT_PLAN_SURGE_CEILING, 9);
    expect(HARD.floorWatts).toBeCloseTo(TIER * PACING_FACTOR_FLOOR, 9);
    expect(HARD.budgetJoules).toBe(BOT_TIER_BUDGET_JOULES.hard);
    expect(HARD.raceMetres).toBe(6_000);
  });

  it('keeps every tier’s surge ceiling at or under 7 W/kg, and over #92’s +10 %', () => {
    for (const tier of BOT_TIERS) {
      const plan = botRacePlan(tier, COURSE, 1);
      expect(plan.surgeWatts, tier).toBeLessThanOrEqual(
        MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * BOT_MASS_KILOGRAMS,
      );
      expect(plan.surgeWatts, tier).toBeGreaterThan(plan.tierWatts * 1.1);
    }
    // The strongest tier is what holds the ceiling under 7 W/kg: 6.6 today.
    expect(
      BOT_PLAN_SURGE_CEILING * Math.max(...Object.values(BOT_TIER_WATTS_PER_KILOGRAM)),
    ).toBeLessThanOrEqual(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM);
  });

  it('gives each tier twenty seconds of a full surge, so the tiers keep their order', () => {
    for (const tier of BOT_TIERS) {
      const watts = BOT_TIER_WATTS_PER_KILOGRAM[tier] * BOT_MASS_KILOGRAMS;
      expect(BOT_TIER_BUDGET_JOULES[tier], tier).toBeCloseTo(
        20 * (BOT_PLAN_SURGE_CEILING - 1) * watts,
        6,
      );
    }
  });

  it('draws the sprint’s opening from the seed alone, inside its band', () => {
    const openings = new Set<number>();
    for (let seed = 0; seed < 50; seed += 1) {
      const plan = botRacePlan('steady', COURSE, seed);
      expect(plan.sprintMetres).toBeGreaterThanOrEqual(BOT_SPRINT_SHORTEST_METRES);
      expect(plan.sprintMetres).toBeLessThanOrEqual(BOT_SPRINT_LONGEST_METRES);
      // The same seed gives the same plan, and every tier opens at the same distance.
      expect(botRacePlan('steady', COURSE, seed)).toEqual(plan);
      expect(botRacePlan('fierce', COURSE, seed).sprintMetres).toBe(plan.sprintMetres);
      openings.add(plan.sprintMetres);
    }
    expect(openings.size).toBeGreaterThan(40);
  });

  it('makes a race shorter than the sprint a sprint from the start', () => {
    const plan = botRacePlan('brisk', raceCourse(150, 1), 3);
    expect(plan.sprintMetres).toBe(150);
    expect(step(plan, 100, 0, 0).power).toBeGreaterThan(plan.tierWatts);
  });

  it('refuses a seed that is not a safe whole number', () => {
    expect(codeOf(() => botRacePlan('hard', COURSE, Number.NaN))).toBe('seed-not-integer');
    expect(codeOf(() => botRacePlan('hard', COURSE, 1.5))).toBe('seed-not-integer');
  });

  it('is scalars only, with nowhere for a recorded ride or another racer', () => {
    expect(Object.keys(HARD).sort()).toEqual([
      'budgetJoules',
      'climbGradePercent',
      'easedWatts',
      'floorWatts',
      'hardFromMetres',
      'hardToMetres',
      'ownWatts',
      'raceMetres',
      'sprintMetres',
      'surgeWatts',
      'tierWatts',
    ]);
    for (const value of Object.values(HARD)) expect(typeof value).toBe('number');
  });
});

describe('the course asks, and the reserve decides (ADR 0061 D-2.4)', () => {
  it('surges up a climb on what it holds: the full ceiling at 8 %, half of it at 4 %', () => {
    const steep = step(HARD, 1_000, 8);
    expect(steep.power).toBeCloseTo(HARD.surgeWatts, 9);
    expect(steep.reserve).toBeCloseTo(1_000 - (HARD.surgeWatts - TIER), 9);
    expect(step(HARD, 1_000, 12).power).toBeCloseTo(HARD.surgeWatts, 9);
    expect(step(HARD, 1_000, 4).power).toBeCloseTo((TIER + HARD.surgeWatts) / 2, 9);
  });

  it('rides no more than its tier up a climb with an empty reserve', () => {
    const empty = step(HARD, 0, 8);
    expect(empty.power).toBe(TIER);
    expect(empty.reserve).toBe(0);
  });

  it('never spends more than it holds', () => {
    const last = step(HARD, 10, 8);
    expect(last.power).toBeCloseTo(TIER + 10, 9);
    expect(last.reserve).toBe(0);
  });

  it('banks on the flat while there is room, and holds its tier once full', () => {
    const banking = step(HARD, 0, 0);
    expect(banking.power).toBeCloseTo(TIER * (1 - BOT_PLAN_BANKING), 9);
    expect(banking.reserve).toBeCloseTo(TIER * BOT_PLAN_BANKING, 9);
    const full = step(HARD, HARD.budgetJoules, 0);
    expect(full.power).toBe(TIER);
    expect(full.reserve).toBe(HARD.budgetJoules);
  });

  it('eases down a descent to #92’s floor while there is room, and only by what fills it', () => {
    const steep = step(HARD, 0, -6);
    expect(steep.power).toBeCloseTo(HARD.floorWatts, 9);
    expect(step(HARD, 0, -20).power).toBeCloseTo(HARD.floorWatts, 9);
    // 5 J of room: it eases by 5 W for the second, and no further.
    const nearlyFull = step(HARD, HARD.budgetJoules - 5, -6);
    expect(nearlyFull.power).toBeCloseTo(TIER - 5, 9);
    expect(nearlyFull.reserve).toBeCloseTo(HARD.budgetJoules, 9);
    // Full: it holds its tier rather than ease for nothing.
    expect(step(HARD, HARD.budgetJoules, -6).power).toBe(TIER);
  });

  it('has no step in its power across the flat, and asks a climb’s from 1 % up (#2140)', () => {
    // On an interpolated profile the grade is almost never exactly 0, so a
    // step at 0 % is a bot flicking between banking and spending on
    // near-flat ground. Swept in 0.01 % steps with room to bank and to spend,
    // the steepest the ask climbs is the blend's, about 0.11 % of the tier per
    // step; a step of 5 % of the tier anywhere fails it.
    const powers: number[] = [];
    for (let hundredths = -300; hundredths <= 300; hundredths += 1) {
      powers.push(step(HARD, 1_000, hundredths / 100).power);
    }
    for (let index = 1; index < powers.length; index += 1) {
      expect(Math.abs((powers[index] ?? 0) - (powers[index - 1] ?? 0))).toBeLessThan(TIER * 0.002);
    }
    // The ends of the blend: banking at 0 %, a climb's ask from its edge.
    expect(step(HARD, 1_000, 0).power).toBeCloseTo(TIER * (1 - BOT_PLAN_BANKING), 9);
    const edge =
      TIER +
      (BOT_PLAN_FLAT_GRADE_PERCENT / PACING_CLIMB_REFERENCE_GRADE_PERCENT) *
        (HARD.surgeWatts - TIER);
    expect(step(HARD, 1_000, BOT_PLAN_FLAT_GRADE_PERCENT).power).toBeCloseTo(edge, 9);
    expect(step(HARD, 1_000, BOT_PLAN_FLAT_GRADE_PERCENT / 2).power).toBeCloseTo(
      (TIER * (1 - BOT_PLAN_BANKING) + edge) / 2,
      9,
    );
  });

  it('takes a non-finite grade as the flat', () => {
    expect(step(HARD, 0, Number.NaN).power).toBeCloseTo(TIER * (1 - BOT_PLAN_BANKING), 9);
    expect(step(HARD, 1_000, Number.POSITIVE_INFINITY).power).toBeCloseTo(
      TIER * (1 - BOT_PLAN_BANKING),
      9,
    );
  });

  it('changes nothing over a tick of no time', () => {
    expect(step(HARD, 500, 8, MID, 0)).toEqual({ power: HARD.surgeWatts, reserve: 500 });
    expect(step(HARD, 0, 8, MID, 0)).toEqual({ power: TIER, reserve: 0 });
    expect(step(HARD, 500, -6, MID, 0).reserve).toBe(500);
    expect(step(HARD, HARD.budgetJoules, -6, MID, 0).power).toBe(TIER);
  });
});

describe('the closing sprint, on effort distance (ADR 0061 D-2, D-8.6)', () => {
  const opens = HARD.raceMetres - HARD.sprintMetres;

  it('opens at the plan’s distance left, whatever the grade', () => {
    expect(step(HARD, 1_000, 0, opens - 1).power).toBeLessThan(TIER);
    expect(step(HARD, 1_000, 0, opens).power).toBeCloseTo(HARD.surgeWatts, 9);
    // Downhill in the sprint is still the sprint.
    expect(step(HARD, 1_000, -6, opens + 50).power).toBeCloseTo(HARD.surgeWatts, 9);
  });

  it('holds the sprint past the race length, and rides its tier once the reserve is spent', () => {
    expect(step(HARD, 1_000, 0, HARD.raceMetres + 5).power).toBeCloseTo(HARD.surgeWatts, 9);
    // Past the line with nothing left: no overdraft, and no easing either.
    const spent = step(HARD, 0, -6, HARD.raceMetres + 5);
    expect(spent).toEqual({ power: TIER, reserve: 0 });
  });
});

describe('the account is exact: a race’s surplus is the reserve it started with less its last', () => {
  it('books every joule over a long run of mixed grades, and keeps inside the bounds', () => {
    let reserve = 0;
    let surplus = 0;
    let at = 0;
    for (let tick = 0; tick < 2_000; tick += 1) {
      // A rolling road of steps between −9 % and +9 %, and ticks of 0.05 s to 1.5 s.
      const grade = 9 * Math.sin(tick / 7) * Math.cos(tick / 23);
      const elapsed = 0.05 + ((tick * 37) % 30) / 20;
      const next = botPlanStep(HARD, reserve, { effortDistance: at, grade, elapsed });
      expect(next.power).toBeLessThanOrEqual(HARD.surgeWatts + 1e-9);
      expect(next.power).toBeGreaterThanOrEqual(HARD.floorWatts - 1e-9);
      expect(next.reserve).toBeGreaterThanOrEqual(0);
      expect(next.reserve).toBeLessThanOrEqual(HARD.budgetJoules);
      surplus += (next.power - TIER) * elapsed;
      reserve = next.reserve;
      at += 5 * elapsed;
    }
    // The reserve did move both ways, and the books balance to the joule.
    expect(at).toBeGreaterThan(HARD.raceMetres);
    expect(surplus).toBeCloseTo(0 - reserve, 6);
  });
});

describe('it refuses what is not a ride', () => {
  it('names the field and the constraint', () => {
    expect(codeOf(() => step(HARD, 0, 0, Number.NaN))).toBe('effort-distance-not-finite');
    expect(codeOf(() => step(HARD, 0, 0, MID, -1))).toBe('elapsed-out-of-range');
    expect(codeOf(() => step(HARD, 0, 0, MID, Number.POSITIVE_INFINITY))).toBe(
      'elapsed-out-of-range',
    );
    expect(codeOf(() => step(HARD, -1, 0))).toBe('reserve-out-of-range');
    expect(codeOf(() => step(HARD, HARD.budgetJoules + 1, 0))).toBe('reserve-out-of-range');
    expect(codeOf(() => step(HARD, Number.NaN, 0))).toBe('reserve-out-of-range');
    expect(codeOf(() => step(HARD, 0, 0))).toBeUndefined();
  });
});

describe('each bot’s own pace (#2455)', () => {
  const pace = (style: BotPace['style'], ability = 1): BotPace => ({ style, ability });
  const planOf = (style: BotPace['style'], ability = 1): BotRacePlan =>
    botRacePlan('hard', COURSE, 1, pace(style, ability));

  it('is #1960’s plan with no pace given, and with the even pace at full ability', () => {
    expect(botRacePlan('hard', COURSE, 1, BOT_EVEN_PACE)).toEqual(HARD);
    expect(HARD.ownWatts).toBe(HARD.tierWatts);
    expect(HARD.easedWatts).toBe(HARD.tierWatts);
    expect(HARD.climbGradePercent).toBe(PACING_CLIMB_REFERENCE_GRADE_PERCENT);
  });

  it('rides its own ability on the flat, and holds the tier’s bounds whatever it is', () => {
    const weak = planOf('even', 1 - BOT_ABILITY_SPREAD);
    expect(weak.ownWatts).toBeCloseTo(TIER * (1 - BOT_ABILITY_SPREAD), 9);
    expect(weak.surgeWatts).toBe(HARD.surgeWatts);
    expect(weak.floorWatts).toBe(HARD.floorWatts);
    // Banking 5 % under its OWN power, into a reserve with room.
    expect(step(weak, 0, 0).power).toBeCloseTo(weak.ownWatts * (1 - BOT_PLAN_BANKING), 9);
    // Full, it holds its own power, which is under its tier's.
    expect(step(weak, weak.budgetJoules, 0).power).toBeCloseTo(weak.ownWatts, 9);
    // Down a steep descent it eases, but never under the tier's −20 % floor.
    expect(step(weak, 0, -12).power).toBeCloseTo(HARD.floorWatts, 9);
  });

  it('rides no more than its own power, so never its tier’s, up a climb with an empty reserve', () => {
    for (const style of BOT_PACING_STYLES) {
      const plan = planOf(style, 1 - BOT_ABILITY_SPREAD / 2);
      for (const at of [MID, plan.raceMetres - 1]) {
        const ridden = step(plan, 0, 8, at).power;
        expect(ridden, style).toBeLessThanOrEqual(plan.ownWatts + 1e-9);
        expect(ridden, style).toBeLessThan(plan.tierWatts);
      }
    }
  });

  it('fades after the first lap as a fast starter, and saves for the last as a negative splitter', () => {
    const bolter = planOf('fast-start');
    const closer = planOf('negative-split');
    const full = (plan: BotRacePlan, at: number): number =>
      step(plan, plan.budgetJoules, 0, at).power;
    // A full reserve, on the flat: what it rides as its own at each point.
    expect(full(bolter, 500)).toBeCloseTo(TIER, 9);
    expect(full(bolter, 2_500)).toBeCloseTo(TIER * (1 - BOT_STYLE_EASING), 9);
    expect(full(closer, 2_500)).toBeCloseTo(TIER * (1 - BOT_STYLE_EASING), 9);
    expect(full(closer, 4_500)).toBeCloseTo(TIER, 9);
    // The first and the last lap, on its own effort distance.
    expect([bolter.hardFromMetres, bolter.hardToMetres]).toEqual([0, 2_000]);
    expect([closer.hardFromMetres, closer.hardToMetres]).toEqual([4_000, Number.POSITIVE_INFINITY]);
    // A race of one lap: the first and the last third.
    const once = raceCourse(3_000, 1);
    expect(botRacePlan('hard', once, 1, pace('fast-start')).hardToMetres).toBe(1_000);
    expect(botRacePlan('hard', once, 1, pace('negative-split')).hardFromMetres).toBe(2_000);
  });

  it('climbs harder as a climber and saves on climbs as a sprinter, with a larger reserve each', () => {
    const climb = (style: BotPace['style']): number => step(planOf(style), 2_000, 4).power;
    // At 4 %: a climber's full surge, the even pace's half, a sprinter's quarter.
    expect(climb('climber')).toBeCloseTo(HARD.surgeWatts, 9);
    expect(climb('even')).toBeCloseTo(TIER + (HARD.surgeWatts - TIER) / 2, 9);
    expect(climb('sprinter')).toBeCloseTo(TIER + (HARD.surgeWatts - TIER) / 4, 9);
    expect(planOf('climber').climbGradePercent).toBe(BOT_CLIMBER_GRADE_PERCENT);
    expect(planOf('sprinter').climbGradePercent).toBe(BOT_SPRINTER_GRADE_PERCENT);
    for (const style of ['climber', 'sprinter'] as const) {
      expect(planOf(style).budgetJoules).toBeCloseTo(
        BOT_TIER_BUDGET_JOULES.hard * BOT_STYLE_BUDGET_FACTOR,
        9,
      );
    }
    expect(planOf('fast-start').budgetJoules).toBe(BOT_TIER_BUDGET_JOULES.hard);
  });

  it('opens a sprinter’s kick further out, from the same draw as the field’s', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const even = botRacePlan('brisk', COURSE, seed);
      const sprinter = botRacePlan('brisk', COURSE, seed, pace('sprinter'));
      expect(sprinter.sprintMetres).toBeCloseTo(even.sprintMetres * BOT_SPRINTER_SPRINT_FACTOR, 9);
    }
    // Never longer than the race.
    expect(botRacePlan('brisk', raceCourse(250, 1), 3, pace('sprinter')).sprintMetres).toBe(250);
  });

  it('books every joule against its own power: the account still balances', () => {
    for (const style of BOT_PACING_STYLES) {
      const plan = planOf(style, 0.95);
      let reserve = 0;
      let surplus = 0;
      let at = 0;
      for (let tick = 0; tick < 2_000; tick += 1) {
        const grade = 9 * Math.sin(tick / 7) * Math.cos(tick / 23);
        const elapsed = 0.05 + ((tick * 37) % 30) / 20;
        const own =
          at >= plan.hardFromMetres && at < plan.hardToMetres ? plan.ownWatts : plan.easedWatts;
        const next = botPlanStep(plan, reserve, { effortDistance: at, grade, elapsed });
        expect(next.power, style).toBeLessThanOrEqual(plan.surgeWatts + 1e-9);
        expect(next.power, style).toBeGreaterThanOrEqual(plan.floorWatts - 1e-9);
        surplus += (next.power - own) * elapsed;
        reserve = next.reserve;
        at += 5 * elapsed;
      }
      expect(at, style).toBeGreaterThan(plan.raceMetres);
      expect(surplus, style).toBeCloseTo(0 - reserve, 6);
    }
  });

  it('refuses a pace with an ability outside its band, or a style it does not name', () => {
    for (const ability of [1.01, 1 - BOT_ABILITY_SPREAD - 0.01, Number.NaN]) {
      expect(codeOf(() => botRacePlan('hard', COURSE, 1, pace('even', ability)))).toBe(
        'pace-out-of-range',
      );
    }
    const unknown = { style: 'drafter', ability: 1 } as unknown as BotPace;
    expect(codeOf(() => botRacePlan('hard', COURSE, 1, unknown))).toBe('pace-out-of-range');
    expect(
      codeOf(() => botRacePlan('hard', COURSE, 1, pace('climber', 1 - BOT_ABILITY_SPREAD))),
    ).toBeUndefined();
  });
});
