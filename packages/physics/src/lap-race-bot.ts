// SPDX-License-Identifier: Apache-2.0

/**
 * Bots in a solo lap race — #1900, ADR 0060 D-7 and D-9, and since #1960 ADR
 * 0061's race plan.
 *
 * Built on the #92 bot pacer, and only on it. A bot's effort distance is
 * where {@link advancePlannedBot}, `advanceBot`'s tick at a planned power, takes it: its race plan's power (`@onyourleft/domain`
 * §`botPlanStep`) for the bot's tier on the grade under the bot, through
 * {@link advance}, the one tick in this package. A bot on separate maths would fail `lap-race-bot.test.ts`,
 * which replaces `advance` with a sentinel and requires the bot's position to
 * change. The bot's offset comes from the race's items, under the same rules
 * as a rider's: {@link stepBotRace} hands the bots' effort distances and
 * decisions to `@onyourleft/domain` §`stepRace`, beside the rider's inputs.
 *
 * ## What a bot is made of: a tier, the pacing rule, the course and a seed
 *
 * The whole of a bot is an id, a {@link BotTier}, a `BotStrategy` (#1959: a
 * personality and a skill, which decide its lanes and items and nothing else),
 * a `BotPace` (#2455: its ability at or under its tier and its pacing style
 * off the course, which its race plan reads and its decisions never do),
 * what its decisions remember from the last tick, its own energy reserve
 * (#1960), and its own ride state. The whole of a tick's inputs is the elapsed
 * time, the course's conditions (the same {@link BotCourse} the #92 bot takes,
 * minus the plan the tier supplies), the race's seed and the rider's inputs. **No activity, stream, ghost or
 * recorded sample is a parameter anywhere here** (ADR 0007 D4, ADR 0060 D-7.1),
 * and a type-level test holds the signatures to that.
 *
 * ## No rubber-banding (ADR 0060 D-9, ADR 0061 D-1)
 *
 * A bot's power is a function of its tier, the road under it, the effort
 * distance it has left and its own reserve, and never of any other racer. The
 * plan is built from the bot's tier, the race's course and the race's seed
 * (`botRacePlan`), and stepped on the bot's own odometer, which is its effort
 * distance: **never its `raceOffset`, its drawn distance or its place**, which
 * other racers' items move (ADR 0061 D-3). The race's standings are never read
 * on the way to {@link advancePlannedBot}, and neither is its strategy: two races
 * where the same bot leads and trails read back identical power traces, and so
 * do two bots of one tier and different skill. That holds because a solo
 * race's bots have no draft (ADR 0061 D-4).
 *
 * ## No instance, no network (D-7.3)
 *
 * Pure computation, as the rest of this package: time arrives as `Seconds`,
 * and nothing here reads a clock or names a platform API.
 */

import type {
  BotMemory,
  BotPace,
  BotStrategy,
  ItemRaceState,
  RaceTickInput,
  Seconds,
  Watts,
} from '@onyourleft/domain';
import {
  BOT_EVEN_PACE,
  BOT_MEMORY_AT_START,
  botPlanStep,
  botRacePlan,
  botTierPlan,
  stepRace,
  strategicBotDecision,
  type BotTier,
} from '@onyourleft/domain';

import { advancePlannedBot, BOT_AT_START_LINE, botDemand, type BotCourse } from './pacer';
import type { RideState } from './simulate';

/** One bot in a race: an id, a tier, a strategy, a pace, and where its own power has taken it. */
export interface LapRaceBot {
  readonly id: string;
  /** Its strength's tier: with its {@link pace}, the only thing that sets its power. */
  readonly tier: BotTier;
  /** How it decides (#1959): chosen apart from the tier, and never read on the way to its power. */
  readonly strategy: BotStrategy;
  /**
   * How it paces the race (#2455): its ability at or under its tier and its
   * style off the course, fixed at the start from the race's seed. Read on
   * the way to its power, by its race plan, and never by its decisions.
   */
  readonly pace: BotPace;
  /** What its decisions remember from the last tick of this race: nothing stored, nothing recorded. */
  readonly memory: BotMemory;
  /**
   * Joules in its race plan's reserve (#1960, ADR 0061): spent above its tier,
   * refilled below it. Empty at the start.
   */
  readonly reserve: number;
  readonly ride: RideState;
  /** What its race plan rode on the last tick, in watts. 0 before the first. */
  readonly power: Watts | 0;
}

/** The course a race's bots ride: #92's {@link BotCourse}, with the plan left to each bot's tier. */
export type LapRaceBotConditions = Omit<BotCourse, 'plan'>;

/** One tick of a solo race. */
export interface BotRaceStep {
  readonly elapsed: Seconds;
  readonly conditions: LapRaceBotConditions;
  /**
   * The race's own seed, the one `createItemRace` took: the bots' decisions
   * are drawn from it. `strategicBotDecision` refuses one that is not a
   * safe whole number.
   */
  readonly seed: number;
  /** The rider's inputs this tick, as their client sends them. */
  readonly rider?: Omit<RaceTickInput, 'atMs'>;
}

/**
 * A bot on the start line, with its strength, its way of racing and its pace
 * chosen apart. With no pace, it rides #1960's even plan at its tier's full
 * power.
 */
export function lapRaceBot(
  id: string,
  tier: BotTier,
  strategy: BotStrategy,
  pace: BotPace = BOT_EVEN_PACE,
): LapRaceBot {
  return {
    id,
    tier,
    strategy,
    pace,
    memory: BOT_MEMORY_AT_START,
    reserve: 0,
    ride: BOT_AT_START_LINE,
    power: 0,
  };
}

/**
 * The race and its bots one tick on. Each bot decides from the race as it
 * stood, rides its race plan's power through {@link advancePlannedBot}, and the race
 * takes the bots' effort distances and decisions with the rider's inputs.
 *
 * @throws through `strategicBotDecision` (`travel-out-of-range`) or
 * `botPlanStep` (`elapsed-out-of-range`) for an elapsed time that is not
 * finite or is below zero, through {@link advance} for zero, and through
 * `stepRace` for any input the race refuses.
 */
export function stepBotRace(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  step: BotRaceStep,
): { readonly race: ItemRaceState; readonly bots: readonly LapRaceBot[] } {
  const effortDistances: Record<string, number> = { ...step.rider?.effortDistances };
  const lanes: Record<string, number> = { ...step.rider?.lanes };
  const uses: string[] = [...(step.rider?.uses ?? [])];
  const moved = bots.map((bot): LapRaceBot => {
    // How far the bot will ride this tick, near enough: what its puddle
    // look-ahead and its last call grow with.
    const decision = strategicBotDecision(
      race,
      bot.id,
      step.seed,
      bot.ride.speed * step.elapsed,
      bot.strategy,
      bot.memory,
    );
    lanes[bot.id] = decision.lane;
    if (decision.use) uses.push(bot.id);
    const course: BotCourse = { ...step.conditions, plan: botTierPlan(bot.tier) };
    // The plan reads the bot's own odometer, its effort distance, and the
    // grade under it there: never the race's view of where the bot is.
    const planned = botPlanStep(
      botRacePlan(bot.tier, race.course, step.seed, bot.pace),
      bot.reserve,
      {
        effortDistance: bot.ride.distance,
        grade: botDemand(bot.ride, course).grade,
        elapsed: step.elapsed,
      },
    );
    const tick = advancePlannedBot(bot.ride, step.elapsed, course, planned.power);
    effortDistances[bot.id] = tick.state.distance;
    return {
      ...bot,
      memory: decision.memory,
      reserve: planned.reserve,
      ride: tick.state,
      power: tick.power,
    };
  });
  return {
    race: stepRace(race, {
      atMs: race.atMs + step.elapsed * 1_000,
      effortDistances,
      lanes,
      uses,
    }),
    bots: moved,
  };
}
