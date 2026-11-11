// SPDX-License-Identifier: Apache-2.0

/**
 * The lap-race bots' race plan: a course-only energy budget — #1960,
 * [ADR 0061](../../../../docs/adr/0061-lap-race-bots-a-course-only-energy-plan-never-another-racer.md).
 *
 * Before #1960 a bot held its tier's W/kg, shaped by #92's grade pacing
 * (`pacer/pacing.ts`). With a plan it **surges on climbs, eases on descents
 * and sprints the closing distance**, and its average stays at its tier.
 *
 * ## The rule (ADR 0061 D-1)
 *
 * A bot's power is a function of its tier, the road, the distance it has left
 * and its own energy budget, **and never of any other racer**. What
 * {@link botPlanStep} reads is the whole of D-2:
 *
 * | Input | Where it comes from |
 * |---|---|
 * | the tier | {@link botRacePlan}, from `BOT_TIER_WATTS_PER_KILOGRAM` |
 * | the course | {@link botRacePlan}: the race length, from the lap length and the laps |
 * | the race's seed | {@link botRacePlan}: where the closing sprint opens, the same for every bot in the race |
 * | the grade | {@link BotPlanInput.grade}: the road under the bot, read at its own effort distance |
 * | the distance left | the race length less {@link BotPlanInput.effortDistance} |
 * | its own reserve | what this step returned last tick |
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
 * ## The reserve: a W′-style account, exact by construction
 *
 * The reserve is work above the tier's power, in joules, in the critical-power
 * style of `analysis/critical-power.ts`: the tier's power plays CP, and the
 * reserve plays W′. **Every joule ridden above the tier comes out of it and
 * every joule ridden below goes into it**, one for one:
 *
 * - **It starts empty**, and holds at most the tier's
 *   {@link BOT_TIER_BUDGET_JOULES}.
 * - **Above the tier** (a climb, the sprint) the bot spends no more than it
 *   holds: with an empty reserve it rides at its tier, never over it (D-2).
 * - **Below the tier** (a descent, or {@link BOT_PLAN_BANKING} under it on the
 *   flat, blending up to a climb's ask over {@link BOT_PLAN_FLAT_GRADE_PERCENT})
 *   the bot eases only while the reserve has room, and only by as much as
 *   fills it. With a full reserve it holds its tier.
 *
 * So a race's surplus over the tier is the reserve at the start less the
 * reserve at the end: **a bot's time-weighted mean power is its tier's power
 * less its unspent reserve over the race's time, and never more than its
 * tier's.** The closing sprint spends what is left, which is why the mean
 * lands within {@link BOT_PLAN_MEAN_TOLERANCE} of the tier. The plan reshapes a
 * bot's effort; it does not raise it, so a rider well ahead of a tier stays
 * ahead (ADR 0061, *What this costs*).
 *
 * ## Each bot's own pace (#2455)
 *
 * Since #2455 a plan also takes the bot's pace (`pace.ts`): an ability at or a
 * little under its tier, and a pacing style read off the course. The account
 * above is then booked against **the bot's own power** where it is, its
 * tier's times its ability, and eased by its style outside its hard part,
 * rather than against the tier's: what is "above" and "below" is above and
 * below its own. Its own power is never over its tier's, so an empty reserve
 * still rides no more than the tier (ADR 0061 D-2), and the mean is still
 * never above it. The bounds below stay the tier's. A pace is drawn from the
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
 * same reserve rule: an empty reserve rides at the tier (D-2). Nothing here
 * reads when its drawn distance finishes.
 *
 * ## Pure, seeded, and from no recorded ride
 *
 * Both functions are pure: the same tier, course, seed, reserve and input give
 * the same power. The one random number is the sprint's opening, drawn from
 * the race's own seed through `random.ts` and keyed apart from the race's item
 * draws. Nothing here imports `ghost/` or `recording/` (`bots.test.ts` scans
 * every lap-race module), and a plan is scalars only (`plan.test.ts`).
 */

import {
  BOT_MASS_KILOGRAMS,
  PACING_CLIMB_REFERENCE_GRADE_PERCENT,
  PACING_FACTOR_FLOOR,
  pacingFactor,
} from '../pacer/pacing';
import { watts, type GradePercent, type Watts } from '../quantities';
import { BOT_TIER_WATTS_PER_KILOGRAM, type BotTier } from './bots';
import { LapRaceError } from './errors';
import {
  BOT_CLIMBER_GRADE_PERCENT,
  BOT_EVEN_PACE,
  BOT_SPRINTER_GRADE_PERCENT,
  BOT_SPRINTER_SPRINT_FACTOR,
  BOT_STYLE_BUDGET_FACTOR,
  BOT_STYLE_EASING,
  checkBotPace,
  type BotPace,
} from './pace';
import { nextUnit, raceRandom } from './random';
import type { RaceCourse } from './race';

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
 * bounded by the reserve behind it. If
 * riders read a surge as rubber-banding, this is the knob (ADR 0061, *What
 * would make this ADR wrong*).
 */
export const BOT_PLAN_SURGE_CEILING = 1.5;

/**
 * How far under its tier a bot rides on the flat while its reserve has room:
 * **5 %**. Where the reserve for a climb or the sprint comes from on a course
 * with no descent.
 */
export const BOT_PLAN_BANKING = 0.05;

/**
 * How far up from the flat, in percent of grade, a bot blends from banking to
 * climbing: **1 %**. At 0 % and below it banks ({@link BOT_PLAN_BANKING}); at
 * this grade and above it asks what a climb asks; between, it asks a straight
 * line between the two.
 *
 * Without it the ask stepped by about 5 % of the tier at 0 %, banking on any
 * grade of 0 or below and spending on any above, so on an interpolated route
 * profile's near-flat ground a bot's power flicked between −5 % and +3 % from
 * tick to tick (#2140's review). A feel number, as #92's references are; it
 * changes no joule of the account, so the mean's guarantee holds as before.
 */
export const BOT_PLAN_FLAT_GRADE_PERCENT = 1;

/**
 * Each tier's reserve when full, in joules: **twenty seconds of a full
 * surge**, {@link BOT_PLAN_SURGE_CEILING} less one, times the tier's power at
 * `BOT_MASS_KILOGRAMS`. The budget per tier #1960 names.
 *
 * A stronger tier holds a larger reserve, in proportion, so every tier can
 * surge for the same time and the tier order is the tiers' powers' order.
 * Smaller than a trained rider's W′ on purpose: the mean's shortfall is at
 * most the unspent reserve over the race's time, and a lap race is minutes.
 */
export const BOT_TIER_BUDGET_JOULES: Readonly<Record<BotTier, number>> = {
  steady: 1_500,
  brisk: 2_100,
  hard: 2_700,
  fierce: 3_300,
};

/** The nearest the line the closing sprint opens, in metres of effort distance left. */
export const BOT_SPRINT_SHORTEST_METRES = 200;

/** The furthest from the line the closing sprint opens, in metres of effort distance left. */
export const BOT_SPRINT_LONGEST_METRES = 300;

/**
 * How far a bot's time-weighted mean power over a race may stray from its
 * tier's W/kg at `BOT_MASS_KILOGRAMS`: **10 %**, as a fraction of the tier's
 * power. ADR 0061 D-8.1's stated tolerance, whose value ADR 0061 leaves to the
 * code's pull requests to propose and the owner to approve.
 *
 * ⚠️ **5 % until #2455**, proposed by #1960's pull request when every bot of a
 * tier rode the tier's full power. #2455's pull request proposes 10 % for the
 * owner's approval: a bot's own ability now lies up to `pace.ts`
 * §`BOT_ABILITY_SPREAD` (6 %) under its tier, and a `fast-start` or
 * `negative-split` bot rides `pace.ts` §`BOT_STYLE_EASING` (4 %) under its own
 * for most of a race: together about 8.7 % before any reserve is left unspent.
 *
 * By the header's account the mean is never above the tier, and falls short of
 * it by the bot's own shortfall and the reserve left unspent at the line over
 * the race's time.
 */
export const BOT_PLAN_MEAN_TOLERANCE = 0.1;

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
  /**
   * The bot's own power, watts: its tier's times its pace's ability (#2455),
   * so never over {@link tierWatts}. What it rides as its own in its hard part.
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
  /** The grade at which a climb asks for the full surge, percent: 8 %, or its style's. */
  readonly climbGradePercent: number;
  /** The most it rides, watts: {@link BOT_PLAN_SURGE_CEILING} of the tier. */
  readonly surgeWatts: number;
  /** The least it rides, watts: `PACING_FACTOR_FLOOR` of the tier. */
  readonly floorWatts: number;
  /** Its reserve when full, joules: {@link BOT_TIER_BUDGET_JOULES} for the tier. */
  readonly budgetJoules: number;
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
 * test); a `sprinter` opens it `pace.ts` §`BOT_SPRINTER_SPRINT_FACTOR` further
 * out. A race shorter than that is a sprint from the start.
 *
 * A style's hard part is the first lap (`fast-start`) or the last
 * (`negative-split`), and in a race of one lap the first or the last third
 * of it. Every other style is all hard part.
 *
 * @param seed - the race's own seed, the one `createItemRace` took.
 * @param pace - the bot's own, from `pace.ts` §`botFieldPaces`: absent, the
 *   even pace at the tier's full power, #1960's plan as it was.
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
  const tierWatts = BOT_TIER_WATTS_PER_KILOGRAM[tier] * BOT_MASS_KILOGRAMS;
  const ownWatts = tierWatts * pace.ability;
  const raceMetres = course.lapLengthMetres * course.laps;
  const hardMetres = course.laps >= 2 ? course.lapLengthMetres : raceMetres / 3;
  const sprint =
    (BOT_SPRINT_SHORTEST_METRES +
      drawn * (BOT_SPRINT_LONGEST_METRES - BOT_SPRINT_SHORTEST_METRES)) *
    (style === 'sprinter' ? BOT_SPRINTER_SPRINT_FACTOR : 1);
  const split = style === 'fast-start' || style === 'negative-split';
  const reserved = style === 'climber' || style === 'sprinter';
  return {
    tierWatts,
    ownWatts,
    easedWatts: split ? ownWatts * (1 - BOT_STYLE_EASING) : ownWatts,
    hardFromMetres: style === 'negative-split' ? raceMetres - hardMetres : 0,
    hardToMetres: style === 'fast-start' ? hardMetres : Number.POSITIVE_INFINITY,
    climbGradePercent:
      style === 'climber'
        ? BOT_CLIMBER_GRADE_PERCENT
        : style === 'sprinter'
          ? BOT_SPRINTER_GRADE_PERCENT
          : PACING_CLIMB_REFERENCE_GRADE_PERCENT,
    surgeWatts: tierWatts * BOT_PLAN_SURGE_CEILING,
    floorWatts: tierWatts * PACING_FACTOR_FLOOR,
    budgetJoules: BOT_TIER_BUDGET_JOULES[tier] * (reserved ? BOT_STYLE_BUDGET_FACTOR : 1),
    raceMetres,
    sprintMetres: Math.min(sprint, raceMetres),
  };
}

/**
 * What the bot rides as its own at this effort distance, watts: its own power
 * in its hard part, its eased power outside it. The level its reserve is
 * booked against (#2455).
 */
function ownPowerAt(plan: BotRacePlan, effortDistance: number): number {
  return effortDistance >= plan.hardFromMetres && effortDistance < plan.hardToMetres
    ? plan.ownWatts
    : plan.easedWatts;
}

/** What one step of the plan reads from the bot's own ride. */
export interface BotPlanInput {
  /** The bot's own effort distance, metres (D-2.3): never its drawn distance, never its place. */
  readonly effortDistance: number;
  /** The grade under the bot at that effort distance. Signed. */
  readonly grade: GradePercent | number;
  /** How long this tick lasts, seconds: the power is held for all of it. */
  readonly elapsed: number;
}

/** What the plan rides this tick, and the reserve after it. */
export interface BotPlanStep {
  readonly power: Watts;
  /** Joules left in the reserve once this tick's power is ridden. */
  readonly reserve: number;
}

/**
 * What a climb asks for at this grade: from the bot's own power at 0 % to the
 * surge ceiling at its plan's climb grade (8 %, or its style's).
 */
function climbPower(plan: BotRacePlan, own: number, grade: number): number {
  const climb = Math.min(grade / plan.climbGradePercent, 1);
  return own + climb * (plan.surgeWatts - own);
}

/**
 * What the course asks for at this grade, banking included, before the reserve
 * has its say. Continuous in the grade: see {@link BOT_PLAN_FLAT_GRADE_PERCENT}.
 */
function coursePower(plan: BotRacePlan, own: number, grade: number): number {
  const banked = own * (1 - BOT_PLAN_BANKING);
  if (!Number.isFinite(grade)) return banked;
  if (grade >= BOT_PLAN_FLAT_GRADE_PERCENT) return climbPower(plan, own, grade);
  if (grade > 0) {
    // Near-flat and rising: from banking at 0 % to the climb's ask at the
    // band's edge, so the power has no step anywhere along the grade.
    const along = grade / BOT_PLAN_FLAT_GRADE_PERCENT;
    return banked + along * (climbPower(plan, own, BOT_PLAN_FLAT_GRADE_PERCENT) - banked);
  }
  // Flat and downhill the bot banks, and eases further as #92's rule does,
  // never under the TIER's −20 % floor, whatever its own power (D-8.2).
  return Math.max(plan.floorWatts, Math.min(banked, own * pacingFactor(grade)));
}

/**
 * One tick of a bot's plan: the power to ride, and the reserve after riding it.
 *
 * The bot asks for its sprint power when the effort distance it has left is
 * the plan's sprint or less (and past the race length), and otherwise for what
 * the grade asks: more up a climb, less down a descent, and
 * {@link BOT_PLAN_BANKING} under its tier on the flat while its reserve has
 * room, blended into a climb's ask over the first
 * {@link BOT_PLAN_FLAT_GRADE_PERCENT} of rise. The reserve then decides how much of that it may have (see the
 * header).
 *
 * @param reserve - joules in the bot's reserve: 0 at the start, then what the
 *   last step returned.
 * @throws {LapRaceError} `effort-distance-not-finite`; `elapsed-out-of-range`
 *   for a tick that is not a finite number of seconds of at least zero; and
 *   `reserve-out-of-range` for a reserve that is not between nought and the
 *   plan's budget.
 */
export function botPlanStep(plan: BotRacePlan, reserve: number, input: BotPlanInput): BotPlanStep {
  const { effortDistance, elapsed } = input;
  if (!Number.isFinite(effortDistance)) {
    throw new LapRaceError(
      'effort-distance-not-finite',
      'effortDistance must be a finite number of metres',
    );
  }
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new LapRaceError(
      'elapsed-out-of-range',
      'elapsed must be a finite number of seconds of at least zero',
    );
  }
  if (!Number.isFinite(reserve) || reserve < 0 || reserve > plan.budgetJoules) {
    throw new LapRaceError(
      'reserve-out-of-range',
      'reserve must be a number of joules from zero to the plan budget',
    );
  }
  // #2455: the bot's own power here, never over its tier's, is what the
  // reserve is booked against; for the even pace at full ability it is the tier's.
  const own = ownPowerAt(plan, effortDistance);
  const sprinting = plan.raceMetres - effortDistance <= plan.sprintMetres;
  const wanted = sprinting ? plan.surgeWatts : coursePower(plan, own, input.grade);
  let power: number;
  if (wanted > own) {
    // Spend: never more than the reserve holds, so an empty one rides its own
    // power, which is never over its tier's.
    if (reserve <= 0) power = own;
    else power = elapsed > 0 ? Math.min(wanted, own + reserve / elapsed) : wanted;
  } else {
    // Refill: ease only while there is room, and only by as much as fills it.
    const room = plan.budgetJoules - reserve;
    if (room <= 0) power = own;
    else power = elapsed > 0 ? Math.max(wanted, own - room / elapsed) : wanted;
  }
  const after = reserve - (power - own) * elapsed;
  return { power: watts(power), reserve: Math.min(plan.budgetJoules, Math.max(0, after)) };
}
