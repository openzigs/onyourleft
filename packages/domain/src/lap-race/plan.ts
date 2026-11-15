// SPDX-License-Identifier: Apache-2.0

/**
 * The lap-race bots' race plan: a course-only energy plan, spent from a W′ balance — #1960,
 * [ADR 0061](../../../../docs/adr/0061-lap-race-bots-a-course-only-energy-plan-never-another-racer.md).
 *
 * Before #1960 a bot held its tier's W/kg, shaped by #92's grade pacing
 * (`pacer/pacing.ts`). With a plan it **surges on climbs, eases on descents
 * and sprints the closing distance**, spending a W′ balance that runs out (ADR 0067 D-1.3 lifted the mean-power tolerance).
 *
 * ## The rule (ADR 0061 D-1)
 *
 * A bot's power is a function of its tier, the road, the distance it has left
 * and its own W′ balance, **and never of any other racer**. What
 * {@link botPlanStep} reads is the whole of D-2. ⚠️ ADR 0067 D-0 has since
 * lifted that rule: a bot's strategy may read the race. This plan does not;
 * since #2463 its {@link BotPlanInput.tactic} carries what the tactics read
 * (#2462), and nothing here changes a capacity:
 *
 * | Input | Where it comes from |
 * |---|---|
 * | the tier | {@link botRacePlan}, from `BOT_TIER_WATTS_PER_KILOGRAM` |
 * | the course | {@link botRacePlan}: the race length, from the lap length and the laps |
 * | the race's seed | {@link botRacePlan}: where the closing sprint opens, the same for every bot in the race |
 * | the grade | {@link BotPlanInput.grade}: the road under the bot, read at its own effort distance |
 * | the distance left | the race length less {@link BotPlanInput.effortDistance} |
 * | its own W′ balance | what this step returned last tick (#2458) |
 *
 * ⚠️ **What it never reads (D-3)**: any other racer, the bot's own place or
 * rank, its own `raceOffset` or drawn distance, and the race's lap counter.
 * The distance left is measured on **effort distance**, which the bot's own
 * power alone moves in a solo race (D-4: bots have no draft). Other racers'
 * items move the bot's `raceOffset`, so a plan measured on the drawn distance
 * would make its power depend on what someone else did. The cost is stated in
 * D-2: the sprint opens up to B (10 m) early or late against the line the
 * rider sees, and its tests assert it on effort distance.
 *
 * ## Its capacity, and the W′ balance that spends it (#2458, ADR 0067 D-1, D-2)
 *
 * Since #2458 a bot has a **capacity** fixed at the start, from its tier, its
 * pace and nothing else: a critical power (CP), its own power below; a W′,
 * {@link BOT_WPRIME_JOULES} for its tier; and a peak, at or under the surge
 * ceiling. Since #2459 each is its archetype's share of the tier
 * (`archetype.ts`), and its recovery its archetype's rate. The
 * plan spends W′ through `wbal.ts`'s balance, in the discrete differential
 * form:
 *
 * - **It starts full.** There is no banking: #1960's reserve started empty and
 *   was filled by riding 5 % under the tier, which
 *   made an attack free once banked. W′ is the bot's from the gun.
 * - **Above CP** (a climb, the sprint) the bot spends W′ one joule for one,
 *   never more than the balance holds in a tick.
 * - **Below CP** (a descent, an eased lap) it recovers, more slowly as the
 *   balance fills, and never past W′.
 * - **At 0 it is exhausted**: it rides no more than CP until it has recovered
 *   `wbal.ts` §`BOT_WBAL_REENTRY_FRACTION` of W′. A bot that spends its
 *   matches fades.
 *
 * Nothing about the race changes the capacity (ADR 0067 D-1.2): no rank, gap
 * or other racer reaches CP, W′ or the peak. What a bot's mean power comes to
 * is what its plan spent of a fixed capacity, so ADR 0061 D-8.1's mean
 * tolerance is gone, restated against capacity (ADR 0067 D-1.3): the balance
 * stays in `[0, W′]` every tick, and the power inside the bounds below.
 *
 * ## Each bot's own pace (#2455)
 *
 * Since #2455 a plan also takes the bot's pace (`pace.ts`): an ability at or a
 * little under its tier, and a pacing style read off the course. The account
 * above is then booked against **the bot's own power**, its tier's times its
 * ability, which is its CP: what is "above" and "below" is above and below
 * its own. Outside its hard part its style eases it under its own, so it
 * recovers there. Its own power is never over its tier's, so an exhausted bot
 * still rides no more than the tier (ADR 0061 D-2). The bounds below stay the
 * tier's. A pace is drawn from the
 * race's seed before the start and reads nothing of the race (D-1, D-3). With
 * no pace given, a plan is #1960's, at the tier's full power.
 *
 * ## The bounds (D-8.2, the owner's Q2 answer (a))
 *
 * Above, a bot rides at most {@link BOT_PLAN_SURGE_CEILING} times its tier's
 * power and never over `MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM` (7) at
 * `BOT_MASS_KILOGRAMS`. It may leave #92's +10 % band upward. Below, it never
 * drops under `PACING_FACTOR_FLOOR` of its tier's power, #92's −20 %.
 *
 * ## Past the race length
 *
 * With no distance left the bot holds its last segment, the sprint, under the
 * same balance rule: an exhausted bot rides at its CP (D-2). Nothing here
 * reads when its drawn distance finishes.
 *
 * ## Pure, seeded, and from no recorded ride
 *
 * Both functions are pure: the same tier, course, seed, balance and input give
 * the same power. The one random number is the sprint's opening, drawn from
 * the race's own seed through `random.ts` and keyed apart from the race's item
 * draws. Nothing here imports `ghost/` or `recording/` (`bots.test.ts` scans
 * every lap-race module), and a plan is scalars only (`plan.test.ts`).
 */

import { BOT_MASS_KILOGRAMS, PACING_FACTOR_FLOOR, pacingFactor } from '../pacer/pacing';
import { watts, type GradePercent, type Watts } from '../quantities';
import { BOT_TIER_WATTS_PER_KILOGRAM, type BotTier } from './bots';
import { LapRaceError } from './errors';
import {
  BOT_ARCHETYPE_CLIMB_GRADE_PERCENT,
  BOT_ARCHETYPE_CP_SHARE,
  BOT_ARCHETYPE_PEAK_SHARE,
  BOT_ARCHETYPE_RECOVERY_FACTOR,
  BOT_ARCHETYPE_SPRINT_FACTOR,
  BOT_ARCHETYPE_WPRIME_FACTOR,
  botArchetype,
  type BotArchetype,
} from './archetype';
import { BOT_EVEN_PACE, BOT_STYLE_EASING, checkBotPace, type BotPace } from './pace';
import { nextUnit, raceRandom } from './random';
import type { RaceCourse } from './race';
import { BOT_TACTIC_WHEEL_FLOOR_WATTS } from './tactics';
import { spendableWatts, stepWbal, type BotCapacity, type BotEnergy } from './wbal';

/**
 * The most a bot's plan lifts its power over its tier's, as a multiplier:
 * **1.5**, on a climb at `PACING_CLIMB_REFERENCE_GRADE_PERCENT` (8 %) or
 * steeper, and through the closing sprint.
 *
 * The named surge ceiling of ADR 0061 D-8.2, proposed by #1960's pull request
 * for the owner's approval. ⚠️ **A feel number, not a measured one**, as #92's
 * 8 % and −6 % references are. It keeps `fierce` (4.4 W/kg) at 6.6 W/kg, under
 * the 7 W/kg bound (`plan.test.ts` holds every tier to it, so a stronger tier
 * or a higher ceiling that passed it would go red), and a surge is still
 * bounded by the W′ balance behind it. If
 * riders read a surge as rubber-banding, this is the knob (ADR 0061, *What
 * would make this ADR wrong*).
 */
export const BOT_PLAN_SURGE_CEILING = 1.5;

/**
 * Each tier's W′ at the start of a race, in joules: **10, 14, 18 and 22 kJ**,
 * two-thirds of a hundred seconds of the tier's power each, so every tier can
 * attack for the same time and the tiers keep their order (ADR 0061 D-8.3).
 * Replaces #1960's `BOT_TIER_BUDGET_JOULES`, which was a reserve to be banked
 * rather than a capacity to spend (#2458).
 *
 * ⚠️ **Tuning inputs for the owner's approval** (#2458). The literature puts a
 * trained rider's W′ at roughly 15 to 25 kJ, but that range was not confirmed
 * from a primary source; `steady`, at 2 W/kg, is an untrained rider's tier and
 * sits under it. Each archetype holds `archetype.ts`
 * §`BOT_ARCHETYPE_WPRIME_FACTOR` times its tier's (#2459).
 */
export const BOT_WPRIME_JOULES: Readonly<Record<BotTier, number>> = {
  steady: 10_000,
  brisk: 14_000,
  hard: 18_000,
  fierce: 22_000,
};

/**
 * A bot's W′, joules: {@link BOT_WPRIME_JOULES} for its tier, times its
 * archetype's `archetype.ts` §`BOT_ARCHETYPE_WPRIME_FACTOR` (#2459). What its
 * balance starts the race at, and the capacity its plan holds it to.
 */
export function botWPrimeJoules(tier: BotTier, pace: BotPace = BOT_EVEN_PACE): number {
  return BOT_WPRIME_JOULES[tier] * BOT_ARCHETYPE_WPRIME_FACTOR[botArchetype(pace.style)];
}

/** The nearest the line the closing sprint opens, in metres of effort distance left. */
export const BOT_SPRINT_SHORTEST_METRES = 200;

/** The furthest from the line the closing sprint opens, in metres of effort distance left. */
export const BOT_SPRINT_LONGEST_METRES = 300;

/** Keys the sprint's draw apart from the race's item draws on the same seed. */
const SPRINT_DRAW_KEY = 0x5f1d_0961;

/**
 * One bot's plan for one race, fixed from its tier, its pace, the course and
 * the race's seed before the start (ADR 0061 D-2.2). Scalars only: there is
 * nowhere in it for a recorded ride, a rider or another racer.
 */
export interface BotRacePlan {
  /** The tier's power at `BOT_MASS_KILOGRAMS`, watts: what the bounds are set from. */
  readonly tierWatts: number;
  /** Its rider archetype (#2459): its pace's style's, `archetype.ts` §`BOT_STYLE_ARCHETYPE`. */
  readonly archetype: BotArchetype;
  /**
   * The bot's own power, watts: its tier's times its pace's ability (#2455)
   * times its archetype's CP share (#2459), so never over {@link tierWatts}.
   * What it rides as its own in its hard part.
   */
  readonly ownWatts: number;
  /**
   * What it rides as its own outside its hard part, watts: {@link ownWatts},
   * or `pace.ts` §`BOT_STYLE_EASING` under it for a `fast-start` after its
   * first lap and a `negative-split` before its last.
   */
  readonly easedWatts: number;
  /** Where its hard part opens, metres of effort distance. */
  readonly hardFromMetres: number;
  /** Where its hard part closes, metres of effort distance: unbounded for one that never closes. */
  readonly hardToMetres: number;
  /** The grade at which a climb asks for its full peak, percent: its archetype's. */
  readonly climbGradePercent: number;
  /**
   * The most it rides, watts: its archetype's peak share of the tier (#2459),
   * never over {@link BOT_PLAN_SURGE_CEILING} of it.
   */
  readonly surgeWatts: number;
  /** The least it rides, watts: `PACING_FACTOR_FLOOR` of the tier. */
  readonly floorWatts: number;
  /** Its W′, joules: {@link BOT_WPRIME_JOULES} for the tier, times its archetype's factor. */
  readonly wPrimeJoules: number;
  /**
   * Its capacity, fixed for the race (ADR 0067 D-1.1): its CP is
   * {@link ownWatts}, its W′ {@link wPrimeJoules}, its peak {@link surgeWatts},
   * its floor {@link floorWatts} and its archetype's recovery.
   */
  readonly capacity: BotCapacity;
  /** The race's length, metres of effort distance: the lap length times the laps. */
  readonly raceMetres: number;
  /** How much effort distance is left when its sprint opens, metres. */
  readonly sprintMetres: number;
}

/**
 * A bot's plan for a race: its tier, its pace (#2455), the course and the
 * race's seed, and nothing else.
 *
 * The sprint opens between {@link BOT_SPRINT_SHORTEST_METRES} and
 * {@link BOT_SPRINT_LONGEST_METRES} from the line, drawn from the seed alone,
 * so every bot of one style in a race opens it at the same distance left and
 * two bots of one tier and one pace ride one power trace (#1959's skill
 * test); a bot opens it its archetype's `archetype.ts`
 * §`BOT_ARCHETYPE_SPRINT_FACTOR` further out, a sprinter's 1.5 times. A race shorter than that is a sprint from the start.
 *
 * A style's hard part is the first lap (`fast-start`) or the last
 * (`negative-split`), and in a race of one lap the first or the last third
 * of it. Every other style is all hard part.
 *
 * @param seed - the race's own seed, the one `createItemRace` took.
 * @param pace - the bot's own, from `pace.ts` §`botFieldPaces`: absent, the
 *   even pace at the tier's full power, a rouleur's plan (#2459).
 * @throws {LapRaceError} `seed-not-integer` for a seed that is not a safe
 *   whole number, and `pace-out-of-range` for a pace `pace.ts` §`checkBotPace`
 *   refuses.
 */
export function botRacePlan(
  tier: BotTier,
  course: RaceCourse,
  seed: number,
  pace: BotPace = BOT_EVEN_PACE,
): BotRacePlan {
  const drawn = nextUnit({ state: (raceRandom(seed).state ^ SPRINT_DRAW_KEY) >>> 0 }).value;
  checkBotPace(pace);
  const { style } = pace;
  const archetype = botArchetype(style);
  const tierWatts = BOT_TIER_WATTS_PER_KILOGRAM[tier] * BOT_MASS_KILOGRAMS;
  const ownWatts = tierWatts * pace.ability * BOT_ARCHETYPE_CP_SHARE[archetype];
  const raceMetres = course.lapLengthMetres * course.laps;
  const hardMetres = course.laps >= 2 ? course.lapLengthMetres : raceMetres / 3;
  const sprint =
    (BOT_SPRINT_SHORTEST_METRES +
      drawn * (BOT_SPRINT_LONGEST_METRES - BOT_SPRINT_SHORTEST_METRES)) *
    BOT_ARCHETYPE_SPRINT_FACTOR[archetype];
  const split = style === 'fast-start' || style === 'negative-split';
  const wPrimeJoules = botWPrimeJoules(tier, pace);
  const surgeWatts =
    tierWatts * Math.min(BOT_ARCHETYPE_PEAK_SHARE[archetype], BOT_PLAN_SURGE_CEILING);
  const floorWatts = tierWatts * PACING_FACTOR_FLOOR;
  return {
    tierWatts,
    archetype,
    ownWatts,
    easedWatts: split ? ownWatts * (1 - BOT_STYLE_EASING) : ownWatts,
    hardFromMetres: style === 'negative-split' ? raceMetres - hardMetres : 0,
    hardToMetres: style === 'fast-start' ? hardMetres : Number.POSITIVE_INFINITY,
    climbGradePercent: BOT_ARCHETYPE_CLIMB_GRADE_PERCENT[archetype],
    surgeWatts,
    floorWatts,
    wPrimeJoules,
    capacity: {
      cpWatts: ownWatts,
      wPrimeJoules,
      peakWatts: surgeWatts,
      floorWatts,
      recoveryFactor: BOT_ARCHETYPE_RECOVERY_FACTOR[archetype],
    },
    raceMetres,
    sprintMetres: Math.min(sprint, raceMetres),
  };
}

/**
 * What the bot rides as its own at this effort distance, watts: its own power,
 * its CP, in its hard part, and its eased power outside it, where it recovers
 * (#2455, #2458).
 */
function ownPowerAt(plan: BotRacePlan, effortDistance: number): number {
  return effortDistance >= plan.hardFromMetres && effortDistance < plan.hardToMetres
    ? plan.ownWatts
    : plan.easedWatts;
}

/**
 * What a bot's tactics ask of its plan on one tick (#2463, ADR 0067 D-1):
 * `tactics.ts` §`decideTactic`'s target, already inside the bot's capacity,
 * and whether the tactic is the kick.
 */
export interface BotPlanTactic {
  /** The tactic's power target, watts: the level the bot rides at on the flat, in its hard part. */
  readonly targetWatts: number;
  /** Whether the tactic is `kick`: the bot sprints, and its plan's own sprint distance gives way. */
  readonly kick: boolean;
  /**
   * Which wheel the target holds (#2542), shaped to the road and the draft
   * already, so the plan rides it as it is, its style and the grade adding
   * nothing: `'sit-in'`, never past what the plan itself rides here, so a
   * wheel that attacks is let go; `'follow'`, as far as W′ pays; `'recover'`
   * (#2543), never past the recovering target the tactic has already held it
   * to. Absent, it holds none.
   */
  readonly wheel?: 'sit-in' | 'follow' | 'recover';
  /**
   * Whether the bot rides in a draft this tick, `k` < 1 (#2542). On a wheel in
   * a draft the floor does not apply (ADR 0067 D-1.3, R-10). Absent, it does not.
   */
  readonly drafted?: boolean;
}

/** What one step of the plan reads from the bot's own ride. */
export interface BotPlanInput {
  /** The bot's own effort distance, metres (D-2.3): never its drawn distance, never its place. */
  readonly effortDistance: number;
  /** The grade under the bot at that effort distance. Signed. */
  readonly grade: GradePercent | number;
  /** How long this tick lasts, seconds: the power is held for all of it. */
  readonly elapsed: number;
  /**
   * What its tactics ask this tick (#2463). Absent, the plan alone decides:
   * the plan as it was before tactics were wired.
   */
  readonly tactic?: BotPlanTactic | undefined;
}

/** What the plan rides this tick, and the W′ balance after it. */
export interface BotPlanStep {
  readonly power: Watts;
  /** The bot's W′ balance once this tick's power is ridden (#2458). */
  readonly energy: BotEnergy;
}

/**
 * What a climb asks for at this grade: from the bot's own power at 0 % to its
 * peak at its archetype's climb grade.
 */
function climbPower(plan: BotRacePlan, own: number, grade: number): number {
  const climb = Math.min(grade / plan.climbGradePercent, 1);
  return own + climb * (plan.surgeWatts - own);
}

/**
 * What the course asks for at this grade, before the W′ balance has its say:
 * its own power on the flat, more up a climb, and less down a descent as #92's
 * rule eases, never under the tier's −20 % floor. Continuous in the grade, with
 * no step at 0 % (#2140), because there is no banking on either side of it.
 */
function coursePower(plan: BotRacePlan, own: number, grade: number): number {
  if (!Number.isFinite(grade)) return own;
  if (grade >= 0) return climbPower(plan, own, grade);
  return Math.max(plan.floorWatts, own * pacingFactor(grade));
}

/**
 * One tick of a bot's plan: the power to ride, and the W′ balance after riding
 * it.
 *
 * The bot asks for its sprint power when the effort distance it has left is
 * the plan's sprint or less (and past the race length), and otherwise for what
 * the grade asks: more up a climb, its own on the flat, less down a descent.
 * `wbal.ts` §`spendableWatts` then decides how much of that it may have: no
 * more above its CP than its balance pays for, its CP alone while it is
 * exhausted, and inside the tier's floor, the surge ceiling and 7 W/kg.
 *
 * With a {@link BotPlanInput.tactic} (#2463), the tactic sets the level: the
 * bot's own power is scaled by the tactic's target over its CP, so its style's
 * easing and the road's climbs and descents still shape it, and the tactic's
 * kick, not the plan's sprint distance, opens the sprint. Its capacity is the
 * plan's either way (ADR 0067 D-1).
 *
 * @param energy - the bot's W′ balance: full at the start (`wbal.ts`
 *   §`fullBotEnergy` of the plan's capacity), then what the last step returned.
 * @throws {LapRaceError} `effort-distance-not-finite`; `elapsed-out-of-range`
 *   for a tick that is not a finite number of seconds of at least zero; and
 *   `wbal-out-of-range` for a balance that is not between nought and the
 *   plan's W′.
 */
export function botPlanStep(
  plan: BotRacePlan,
  energy: BotEnergy,
  input: BotPlanInput,
): BotPlanStep {
  const { effortDistance, elapsed } = input;
  if (!Number.isFinite(effortDistance)) {
    throw new LapRaceError(
      'effort-distance-not-finite',
      'effortDistance must be a finite number of metres',
    );
  }
  // #2455: the bot's own power here, never over its tier's; its CP in its
  // hard part, and eased under it outside, where it recovers.
  const { tactic } = input;
  // #2542: a wheel's target is already the road's and the draft's: ridden as
  // it is, with no floor in a draft (ADR 0067 D-1.3, R-10). Sitting in, never
  // past the plan's own ride here.
  if (tactic?.wheel !== undefined) {
    const floor = tactic.drafted === true ? BOT_TACTIC_WHEEL_FLOOR_WATTS : plan.capacity.floorWatts;
    const ceiling =
      tactic.wheel === 'sit-in'
        ? coursePower(plan, ownPowerAt(plan, effortDistance), input.grade)
        : tactic.targetWatts;
    const held = spendableWatts(
      plan.capacity,
      energy,
      Math.min(tactic.targetWatts, ceiling),
      elapsed,
      floor,
    );
    return { power: watts(held), energy: stepWbal(plan.capacity, energy, held, elapsed) };
  }
  const own =
    tactic === undefined
      ? ownPowerAt(plan, effortDistance)
      : (ownPowerAt(plan, effortDistance) * tactic.targetWatts) / plan.ownWatts;
  const sprinting =
    tactic === undefined ? plan.raceMetres - effortDistance <= plan.sprintMetres : tactic.kick;
  const wanted = sprinting ? plan.surgeWatts : coursePower(plan, own, input.grade);
  const power = spendableWatts(plan.capacity, energy, wanted, elapsed);
  return { power: watts(power), energy: stepWbal(plan.capacity, energy, power, elapsed) };
}
