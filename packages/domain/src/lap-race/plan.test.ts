// SPDX-License-Identifier: Apache-2.0

/**
 * #1960, ADR 0061, and since #2458 ADR 0067 D-2: the lap-race bots' race
 * plan, as pure functions, spending a W′ balance (`wbal.ts`). The race-level
 * checks (the balance and the bounds over a race, the tier order, the surges
 * on a hilly loop, lead or trail) ride the one physics, in
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
  BOT_ARCHETYPE_CLIMB_GRADE_PERCENT,
  BOT_ARCHETYPE_CP_SHARE,
  BOT_ARCHETYPE_PEAK_SHARE,
  BOT_ARCHETYPE_RECOVERY_FACTOR,
  BOT_ARCHETYPE_SPRINT_FACTOR,
  BOT_ARCHETYPE_WPRIME_FACTOR,
  BOT_ARCHETYPES,
} from './archetype';
import {
  BOT_ABILITY_SPREAD,
  BOT_EVEN_PACE,
  BOT_PACING_STYLES,
  BOT_STYLE_EASING,
  type BotPace,
} from './pace';
import {
  BOT_PLAN_SURGE_CEILING,
  BOT_SPRINT_LONGEST_METRES,
  BOT_SPRINT_SHORTEST_METRES,
  BOT_WPRIME_JOULES,
  botPlanStep,
  botRacePlan,
  botWPrimeJoules,
  type BotPlanTactic,
  type BotRacePlan,
} from './plan';
import { raceCourse } from './race';
import { BOT_TACTIC_WHEEL_FLOOR_WATTS } from './tactics';
import { BOT_WBAL_REENTRY_FRACTION, stepWbal, type BotEnergy } from './wbal';

/** Three laps of 2 km: long enough that the sprint is a part of the race. */
const COURSE = raceCourse(2_000, 3);
const HARD = botRacePlan('hard', COURSE, 1);
/** 3.6 W/kg at 75 kg. */
const TIER = 270;
/** The even pace's archetype, the rouleur's, recovery rate (#2459). */
const ROULEUR_RECOVERY = BOT_ARCHETYPE_RECOVERY_FACTOR.rouleur;
/** Somewhere mid-race, far from the sprint. */
const MID = 1_000;

/** A balance of `wbal` joules, exhausted or not. */
const energy = (wbal: number, exhausted = false): BotEnergy => ({ wbalJoules: wbal, exhausted });
/** A spent bot: nothing left, and capped at its CP until it recovers. */
const EMPTY = energy(0, true);

function step(
  plan: BotRacePlan,
  balance: BotEnergy | number,
  grade: number,
  at = MID,
  elapsed = 1,
) {
  const held = typeof balance === 'number' ? energy(balance) : balance;
  return botPlanStep(plan, held, { effortDistance: at, grade, elapsed });
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
    // The even pace is a rouleur's (#2459): its peak is its archetype's share, under the ceiling.
    expect(HARD.archetype).toBe('rouleur');
    expect(HARD.surgeWatts).toBeCloseTo(TIER * BOT_ARCHETYPE_PEAK_SHARE.rouleur, 9);
    expect(HARD.surgeWatts).toBeLessThanOrEqual(TIER * BOT_PLAN_SURGE_CEILING);
    expect(HARD.floorWatts).toBeCloseTo(TIER * PACING_FACTOR_FLOOR, 9);
    expect(HARD.wPrimeJoules).toBe(BOT_WPRIME_JOULES.hard * BOT_ARCHETYPE_WPRIME_FACTOR.rouleur);
    expect(HARD.raceMetres).toBe(6_000);
  });

  it('fixes its capacity from the tier and the pace: CP its own power, W′, the peak and the floor (ADR 0067 D-1.1)', () => {
    expect(HARD.capacity).toEqual({
      cpWatts: HARD.ownWatts,
      wPrimeJoules: HARD.wPrimeJoules,
      peakWatts: HARD.surgeWatts,
      floorWatts: HARD.floorWatts,
      recoveryFactor: ROULEUR_RECOVERY,
    });
    const weak = botRacePlan('hard', COURSE, 1, { style: 'climber', ability: 0.95 });
    expect(weak.capacity.cpWatts).toBeCloseTo(TIER * 0.95 * BOT_ARCHETYPE_CP_SHARE.climber, 9);
    expect(weak.capacity.wPrimeJoules).toBe(
      botWPrimeJoules('hard', { style: 'climber', ability: 0.95 }),
    );
    // The seed moves the sprint's opening and nothing of the capacity.
    expect(botRacePlan('hard', COURSE, 99).capacity).toEqual(HARD.capacity);
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

  it('gives each tier a W′ in proportion to its power, rising with the tier, so the tiers keep their order', () => {
    const seconds = BOT_TIERS.map(
      (tier) => BOT_WPRIME_JOULES[tier] / (BOT_TIER_WATTS_PER_KILOGRAM[tier] * BOT_MASS_KILOGRAMS),
    );
    for (const each of seconds) expect(each).toBeCloseTo(seconds[0] ?? 0, 9);
    const joules = BOT_TIERS.map((tier) => BOT_WPRIME_JOULES[tier]);
    expect(joules).toEqual([...joules].sort((a, b) => a - b));
    expect(new Set(joules).size).toBe(BOT_TIERS.length);
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
      'archetype',
      'capacity',
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
      'wPrimeJoules',
    ]);
    const { capacity, archetype, ...rest } = HARD;
    for (const value of Object.values(rest)) expect(typeof value).toBe('number');
    // Its archetype is a key from the table (#2459), not a ride.
    expect(BOT_ARCHETYPES).toContain(archetype);
    expect(Object.keys(capacity).sort()).toEqual([
      'cpWatts',
      'floorWatts',
      'peakWatts',
      'recoveryFactor',
      'wPrimeJoules',
    ]);
    for (const value of Object.values(capacity)) expect(typeof value).toBe('number');
  });
});

describe('the course asks, and the W′ balance decides (ADR 0067 D-2)', () => {
  it('surges up a climb on what it holds: the full ceiling at 8 %, half of it at 4 %', () => {
    const steep = step(HARD, 1_000, 8);
    expect(steep.power).toBeCloseTo(HARD.surgeWatts, 9);
    expect(steep.energy.wbalJoules).toBeCloseTo(1_000 - (HARD.surgeWatts - TIER), 9);
    expect(step(HARD, 1_000, 12).power).toBeCloseTo(HARD.surgeWatts, 9);
    expect(step(HARD, 1_000, 4).power).toBeCloseTo((TIER + HARD.surgeWatts) / 2, 9);
  });

  it('rides no more than its CP, its tier, up a climb while it is exhausted', () => {
    const empty = step(HARD, EMPTY, 8);
    expect(empty.power).toBe(TIER);
    expect(empty.energy).toEqual(EMPTY);
    // Some balance back, but under the re-entry share: still capped.
    const under = energy(HARD.wPrimeJoules * BOT_WBAL_REENTRY_FRACTION * 0.9, true);
    expect(step(HARD, under, 8).power).toBe(TIER);
  });

  it('never spends more than it holds, and is exhausted the tick it runs out', () => {
    const last = step(HARD, 10, 8);
    expect(last.power).toBeCloseTo(TIER + 10, 9);
    expect(last.energy).toEqual(EMPTY);
  });

  it('starts the race full, and holds its own power on the flat, neither spending nor recovering', () => {
    const full = step(HARD, HARD.wPrimeJoules, 0);
    expect(full.power).toBe(TIER);
    expect(full.energy).toEqual(energy(HARD.wPrimeJoules));
    // No banking: on the flat a part-spent bot holds its CP and its balance stays where it was.
    const half = step(HARD, HARD.wPrimeJoules / 2, 0);
    expect(half.power).toBe(TIER);
    expect(half.energy.wbalJoules).toBe(HARD.wPrimeJoules / 2);
  });

  it('eases down a descent to #92’s floor and recovers there, slower as it fills', () => {
    const steep = step(HARD, EMPTY, -6);
    expect(steep.power).toBeCloseTo(HARD.floorWatts, 9);
    expect(step(HARD, 0, -20).power).toBeCloseTo(HARD.floorWatts, 9);
    // From empty: the whole of CP less the floor, for the second, at its archetype's rate.
    expect(steep.energy.wbalJoules).toBeCloseTo((TIER - HARD.floorWatts) * ROULEUR_RECOVERY, 9);
    // 5 J short of full: a fraction of that, and never past W′.
    const nearlyFull = step(HARD, HARD.wPrimeJoules - 5, -6);
    expect(nearlyFull.energy.wbalJoules).toBeLessThanOrEqual(HARD.wPrimeJoules);
    expect(nearlyFull.energy.wbalJoules - (HARD.wPrimeJoules - 5)).toBeCloseTo(
      ((TIER - HARD.floorWatts) * 5 * ROULEUR_RECOVERY) / HARD.wPrimeJoules,
      9,
    );
  });

  it('has no step in its power across the flat (#2140)', () => {
    // On an interpolated profile the grade is almost never exactly 0, so a
    // step at 0 % is a bot flicking between two asks on near-flat ground.
    // Swept in 0.01 % steps with a balance to spend, the steepest the ask
    // climbs is a climb's ramp, about 0.06 % of the tier per step; a step of
    // 5 % of the tier anywhere fails it.
    const powers: number[] = [];
    for (let hundredths = -300; hundredths <= 300; hundredths += 1) {
      powers.push(step(HARD, 1_000, hundredths / 100).power);
    }
    for (let index = 1; index < powers.length; index += 1) {
      expect(Math.abs((powers[index] ?? 0) - (powers[index - 1] ?? 0))).toBeLessThan(TIER * 0.002);
    }
    // Its own power at 0 %, and a climb's ask from the first hundredth up.
    expect(step(HARD, 1_000, 0).power).toBe(TIER);
    expect(step(HARD, 1_000, 1).power).toBeCloseTo(
      TIER + (1 / PACING_CLIMB_REFERENCE_GRADE_PERCENT) * (HARD.surgeWatts - TIER),
      9,
    );
  });

  it('takes a non-finite grade as the flat', () => {
    expect(step(HARD, 0, Number.NaN).power).toBe(TIER);
    expect(step(HARD, 1_000, Number.POSITIVE_INFINITY).power).toBe(TIER);
  });

  it('changes nothing over a tick of no time', () => {
    expect(step(HARD, 500, 8, MID, 0)).toEqual({ power: HARD.surgeWatts, energy: energy(500) });
    expect(step(HARD, EMPTY, 8, MID, 0)).toEqual({ power: TIER, energy: EMPTY });
    expect(step(HARD, 500, -6, MID, 0).energy).toEqual(energy(500));
  });
});

describe('the closing sprint, on effort distance (ADR 0061 D-2, D-8.6)', () => {
  const opens = HARD.raceMetres - HARD.sprintMetres;

  it('opens at the plan’s distance left, whatever the grade', () => {
    expect(step(HARD, 1_000, 0, opens - 1).power).toBe(TIER);
    expect(step(HARD, 1_000, 0, opens).power).toBeCloseTo(HARD.surgeWatts, 9);
    // Downhill in the sprint is still the sprint.
    expect(step(HARD, 1_000, -6, opens + 50).power).toBeCloseTo(HARD.surgeWatts, 9);
  });

  it('holds the sprint past the race length, and rides its CP once the balance is spent', () => {
    expect(step(HARD, 1_000, 0, HARD.raceMetres + 5).power).toBeCloseTo(HARD.surgeWatts, 9);
    // Past the line with nothing left: no overdraft, and no easing either.
    const spent = step(HARD, EMPTY, -6, HARD.raceMetres + 5);
    expect(spent).toEqual({ power: TIER, energy: EMPTY });
  });

  it('fades in a sprint it cannot pay for, and kicks again once it has recovered past the re-entry share', () => {
    // A bot that runs out in its sprint rides its CP for the rest of it: a
    // full tick's surge, then the 50 J left, then nothing…
    let held = energy(HARD.surgeWatts - TIER + 50);
    const ridden: number[] = [];
    for (let tick = 0; tick < 5; tick += 1) {
      const next = step(HARD, held, 0, opens + tick);
      ridden.push(next.power);
      held = next.energy;
    }
    expect(ridden[0]).toBeCloseTo(HARD.surgeWatts, 9);
    expect(ridden.slice(2)).toEqual([TIER, TIER, TIER]);
    expect(held).toEqual(EMPTY);
    // …and one that recovers down a descent kicks again, from the tick its
    // balance passes the re-entry share, and not before.
    let rest = EMPTY;
    let seconds = 0;
    while (rest.exhausted && seconds < 1_000) {
      expect(step(HARD, rest, 0, opens).power).toBe(TIER);
      rest = step(HARD, rest, -6).energy;
      seconds += 1;
    }
    expect(seconds).toBeGreaterThan(10);
    expect(rest.wbalJoules).toBeGreaterThan(HARD.wPrimeJoules * BOT_WBAL_REENTRY_FRACTION);
    expect(step(HARD, rest, 0, opens).power).toBeCloseTo(HARD.surgeWatts, 9);
  });
});

describe('its tactics set the level, and the kick opens the sprint (#2463, ADR 0067 D-1)', () => {
  const opens = HARD.raceMetres - HARD.sprintMetres;
  const tactic = (share: number, kick = false) => ({ targetWatts: TIER * share, kick });
  const ride = (at: number, grade: number, given: ReturnType<typeof tactic> | undefined) =>
    botPlanStep(HARD, energy(HARD.wPrimeJoules), {
      effortDistance: at,
      grade,
      elapsed: 1,
      tactic: given,
    }).power;

  it('rides the tactic’s target on the flat, where the plan alone rides its CP', () => {
    expect(ride(MID, 0, undefined)).toBe(TIER);
    expect(ride(MID, 0, tactic(0.9))).toBeCloseTo(TIER * 0.9, 9);
    expect(ride(MID, 0, tactic(1.3))).toBeCloseTo(TIER * 1.3, 9);
  });

  it('keeps the road’s shape on the tactic’s level: harder up a climb, easier down a descent', () => {
    const level = tactic(0.9);
    expect(ride(MID, 4, level)).toBeGreaterThan(ride(MID, 0, level));
    expect(ride(MID, -4, level)).toBeLessThan(ride(MID, 0, level));
    // Never past what the capacity allows: the peak up a wall, the floor down a cliff.
    expect(ride(MID, 30, tactic(1.3))).toBeCloseTo(HARD.surgeWatts, 9);
    expect(ride(MID, -30, tactic(0.85))).toBeGreaterThanOrEqual(HARD.floorWatts);
  });

  it('opens the sprint on the kick, and not on the plan’s own sprint distance', () => {
    // Inside the plan's sprint without a kick: the tactic's level, not the surge.
    expect(ride(opens + 5, 0, tactic(1))).toBeCloseTo(TIER, 9);
    // The kick, anywhere: the surge.
    expect(ride(MID, 0, tactic(1, true))).toBeCloseTo(HARD.surgeWatts, 9);
    // With no tactic, the plan's sprint as before.
    expect(ride(opens + 5, 0, undefined)).toBeCloseTo(HARD.surgeWatts, 9);
  });

  it('leaves the capacity where it was: the balance books the same joules on the plan’s one capacity', () => {
    const held = energy(HARD.wPrimeJoules / 2);
    const stepped = botPlanStep(HARD, held, {
      effortDistance: MID,
      grade: 0,
      elapsed: 1,
      tactic: tactic(1.3),
    });
    expect(stepped.energy).toEqual(stepWbal(HARD.capacity, held, stepped.power, 1));
  });
});

describe('a wheel’s target is ridden as it is (#2542, ADR 0067 D-1.3)', () => {
  const wheel = (
    share: number,
    held: NonNullable<BotPlanTactic['wheel']>,
    drafted = true,
  ): BotPlanTactic => ({
    targetWatts: TIER * share,
    kick: false,
    wheel: held,
    drafted,
  });
  const ride = (grade: number, given: BotPlanTactic) =>
    botPlanStep(HARD, energy(HARD.wPrimeJoules), {
      effortDistance: MID,
      grade,
      elapsed: 1,
      tactic: given,
    }).power;

  it('rides a followed wheel’s target up a climb and down a descent, the road adding nothing', () => {
    for (const grade of [-4, 0, 4]) {
      expect(ride(grade, wheel(0.7, 'follow')), String(grade)).toBeCloseTo(TIER * 0.7, 9);
      expect(ride(grade, wheel(1.2, 'follow')), String(grade)).toBeCloseTo(TIER * 1.2, 9);
      // #2543: a recovering bot's wheel too, held to its target by its tactic already.
      expect(ride(grade, wheel(0.6, 'recover')), String(grade)).toBeCloseTo(TIER * 0.6, 9);
    }
  });

  it('sits in no harder than the plan itself rides the road: up a climb with it, an attack let go', () => {
    const own = (grade: number): number => ride(grade, { targetWatts: TIER, kick: false });
    // On the flat the plan rides its CP: a wheel that asks more is let go.
    expect(ride(0, wheel(1.2, 'sit-in'))).toBeCloseTo(own(0), 9);
    expect(ride(0, wheel(0.7, 'sit-in'))).toBeCloseTo(TIER * 0.7, 9);
    // Up a climb the plan surges, and a sitting-in bot climbs with its wheel that far.
    expect(own(4)).toBeGreaterThan(TIER * 1.1);
    expect(ride(4, wheel(1.1, 'sit-in'))).toBeCloseTo(TIER * 1.1, 9);
    expect(ride(4, wheel(1.3, 'sit-in'))).toBeCloseTo(own(4), 9);
  });

  it('drops the floor on a wheel in a draft and keeps it on one in the open (R-10)', () => {
    expect(ride(0, wheel(0.2, 'follow'))).toBeCloseTo(TIER * 0.2, 9);
    expect(ride(0, wheel(0.2, 'follow', false))).toBe(HARD.floorWatts);
    expect(ride(0, wheel(-1, 'sit-in'))).toBe(BOT_TACTIC_WHEEL_FLOOR_WATTS);
  });

  it('books the joules it rides on the plan’s one capacity', () => {
    const held = energy(HARD.wPrimeJoules / 2);
    const stepped = botPlanStep(HARD, held, {
      effortDistance: MID,
      grade: 0,
      elapsed: 1,
      tactic: wheel(1.2, 'follow'),
    });
    expect(stepped.power).toBeCloseTo(TIER * 1.2, 9);
    expect(stepped.energy).toEqual(stepWbal(HARD.capacity, held, stepped.power, 1));
  });
});

describe('the balance books every joule over a long run of mixed grades (ADR 0067 D-1.3)', () => {
  it('spends one for one above CP, recovers no more than the shortfall under it, and keeps inside the bounds', () => {
    for (const style of BOT_PACING_STYLES) {
      const plan = botRacePlan('hard', COURSE, 1, { style, ability: 0.95 });
      const cp = plan.capacity.cpWatts;
      let held = energy(plan.wPrimeJoules);
      let at = 0;
      let spent = 0;
      let recovered = 0;
      for (let tick = 0; tick < 2_000; tick += 1) {
        // A rolling road of steps between −9 % and +9 %, and ticks of 0.05 s to 1.5 s.
        const grade = 9 * Math.sin(tick / 7) * Math.cos(tick / 23);
        const elapsed = 0.05 + ((tick * 37) % 30) / 20;
        const next = botPlanStep(plan, held, { effortDistance: at, grade, elapsed });
        expect(next.power, style).toBeLessThanOrEqual(plan.surgeWatts + 1e-9);
        expect(next.power, style).toBeGreaterThanOrEqual(plan.floorWatts - 1e-9);
        expect(next.energy.wbalJoules, style).toBeGreaterThanOrEqual(0);
        expect(next.energy.wbalJoules, style).toBeLessThanOrEqual(plan.wPrimeJoules);
        const change = next.energy.wbalJoules - held.wbalJoules;
        if (next.power > cp) {
          // Above CP, exactly what it rode over CP comes out of the balance.
          expect(change, style).toBeCloseTo(-(next.power - cp) * elapsed, 6);
          spent += -change;
        } else {
          // At or under it, it recovers, and by no more than the shortfall.
          expect(change, style).toBeGreaterThanOrEqual(0);
          // …times its archetype's recovery rate (#2459).
          const rate = plan.capacity.recoveryFactor ?? 1;
          expect(change, style).toBeLessThanOrEqual((cp - next.power) * elapsed * rate + 1e-9);
          recovered += change;
        }
        held = next.energy;
        at += 5 * elapsed;
      }
      // The balance did move both ways, and the books balance to the joule.
      expect(at, style).toBeGreaterThan(plan.raceMetres);
      expect(spent, style).toBeGreaterThan(plan.wPrimeJoules / 10);
      expect(recovered, style).toBeGreaterThan(0);
      expect(plan.wPrimeJoules - spent + recovered, style).toBeCloseTo(held.wbalJoules, 6);
    }
  });
});

describe('it refuses what is not a ride', () => {
  it('names the field and the constraint', () => {
    expect(codeOf(() => step(HARD, 0, 0, Number.NaN))).toBe('effort-distance-not-finite');
    expect(codeOf(() => step(HARD, 0, 0, MID, -1))).toBe('elapsed-out-of-range');
    expect(codeOf(() => step(HARD, 0, 0, MID, Number.POSITIVE_INFINITY))).toBe(
      'elapsed-out-of-range',
    );
    expect(codeOf(() => step(HARD, -1, 0))).toBe('wbal-out-of-range');
    expect(codeOf(() => step(HARD, HARD.wPrimeJoules + 1, 0))).toBe('wbal-out-of-range');
    expect(codeOf(() => step(HARD, Number.NaN, 0))).toBe('wbal-out-of-range');
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
    // On the flat it holds its OWN power, its CP, which is under its tier's.
    expect(step(weak, weak.wPrimeJoules, 0).power).toBeCloseTo(weak.ownWatts, 9);
    expect(step(weak, 0, 0).power).toBeCloseTo(weak.ownWatts, 9);
    // Down a steep descent it eases, but never under the tier's −20 % floor.
    expect(step(weak, 0, -12).power).toBeCloseTo(HARD.floorWatts, 9);
  });

  it('rides no more than its own power, so never its tier’s, up a climb while exhausted', () => {
    for (const style of BOT_PACING_STYLES) {
      const plan = planOf(style, 1 - BOT_ABILITY_SPREAD / 2);
      for (const at of [MID, plan.raceMetres - 1]) {
        const ridden = step(plan, EMPTY, 8, at).power;
        expect(ridden, style).toBeLessThanOrEqual(plan.ownWatts + 1e-9);
        expect(ridden, style).toBeLessThan(plan.tierWatts);
      }
    }
  });

  it('fades after the first lap as a fast starter, and saves for the last as a negative splitter', () => {
    const bolter = planOf('fast-start');
    const closer = planOf('negative-split');
    const full = (plan: BotRacePlan, at: number): number =>
      step(plan, plan.wPrimeJoules, 0, at).power;
    // A full balance, on the flat: what it rides as its own at each point.
    // Both are attackers (#2459), whose CP is that archetype's share of the tier.
    const own = TIER * BOT_ARCHETYPE_CP_SHARE.attacker;
    expect(full(bolter, 500)).toBeCloseTo(own, 9);
    expect(full(bolter, 2_500)).toBeCloseTo(own * (1 - BOT_STYLE_EASING), 9);
    expect(full(closer, 2_500)).toBeCloseTo(own * (1 - BOT_STYLE_EASING), 9);
    expect(full(closer, 4_500)).toBeCloseTo(own, 9);
    // Eased under its CP, a part-spent bot recovers.
    const easing = step(bolter, 1_000, 0, 2_500);
    expect(easing.energy.wbalJoules).toBeGreaterThan(1_000);
    // The first and the last lap, on its own effort distance.
    expect([bolter.hardFromMetres, bolter.hardToMetres]).toEqual([0, 2_000]);
    expect([closer.hardFromMetres, closer.hardToMetres]).toEqual([4_000, Number.POSITIVE_INFINITY]);
    // A race of one lap: the first and the last third.
    const once = raceCourse(3_000, 1);
    expect(botRacePlan('hard', once, 1, pace('fast-start')).hardToMetres).toBe(1_000);
    expect(botRacePlan('hard', once, 1, pace('negative-split')).hardFromMetres).toBe(2_000);
  });

  it('climbs harder as a climber and saves on climbs as a sprinter, each its archetype’s row (#2459)', () => {
    const climb = (style: BotPace['style']): number => step(planOf(style), 2_000, 4).power;
    const climber = planOf('climber');
    const sprinter = planOf('sprinter');
    // At 4 %: a climber's full peak, the even pace's half, a sprinter's quarter.
    expect(climb('climber')).toBeCloseTo(climber.surgeWatts, 9);
    expect(climb('even')).toBeCloseTo(TIER + (HARD.surgeWatts - TIER) / 2, 9);
    expect(climb('sprinter')).toBeCloseTo(
      sprinter.ownWatts + (sprinter.surgeWatts - sprinter.ownWatts) / 4,
      9,
    );
    expect(climb('climber')).toBeGreaterThan(climb('sprinter'));
    expect(climber.climbGradePercent).toBe(BOT_ARCHETYPE_CLIMB_GRADE_PERCENT.climber);
    expect(sprinter.climbGradePercent).toBe(BOT_ARCHETYPE_CLIMB_GRADE_PERCENT.sprinter);
    // The sprinter holds the large W′ and the high peak; the climber neither.
    expect(sprinter.wPrimeJoules).toBeCloseTo(
      BOT_WPRIME_JOULES.hard * BOT_ARCHETYPE_WPRIME_FACTOR.sprinter,
      9,
    );
    expect(sprinter.wPrimeJoules).toBeGreaterThan(climber.wPrimeJoules);
    expect(sprinter.surgeWatts).toBeGreaterThan(climber.surgeWatts);
    expect(planOf('fast-start').wPrimeJoules).toBe(
      BOT_WPRIME_JOULES.hard * BOT_ARCHETYPE_WPRIME_FACTOR.attacker,
    );
  });

  it('opens a sprinter’s kick further out, from the same draw as the field’s', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const even = botRacePlan('brisk', COURSE, seed);
      const sprinter = botRacePlan('brisk', COURSE, seed, pace('sprinter'));
      expect(sprinter.sprintMetres).toBeCloseTo(
        even.sprintMetres * BOT_ARCHETYPE_SPRINT_FACTOR.sprinter,
        9,
      );
    }
    // Never longer than the race.
    expect(botRacePlan('brisk', raceCourse(250, 1), 3, pace('sprinter')).sprintMetres).toBe(250);
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
