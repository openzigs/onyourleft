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
 * what its decisions remember from the last tick, its own W′ balance
 * (#2458, ADR 0067 D-2), and its own ride state. The whole of a tick's inputs is the elapsed
 * time, the course's conditions (the same {@link BotCourse} the #92 bot takes,
 * minus the plan the tier supplies), the race's seed and the rider's inputs. **No activity, stream, ghost or
 * recorded sample is a parameter anywhere here** (ADR 0007 D4, ADR 0060 D-7.1),
 * and a type-level test holds the signatures to that.
 *
 * ## No rubber-banding (ADR 0060 D-9, ADR 0061 D-1)
 *
 * A bot's power is a function of its tier, the road under it, the effort
 * distance it has left and its own W′ balance, and never of any other racer.
 * ADR 0067 D-0 has since lifted that rule for strategy; until #2463 wires a
 * strategy that reads the race, what follows still holds. The
 * plan is built from the bot's tier, the race's course and the race's seed
 * (`botRacePlan`), and stepped on the bot's own odometer, which is its effort
 * distance: **never its `raceOffset`, its drawn distance or its place**, which
 * other racers' items move (ADR 0061 D-3). The race's standings are never read
 * on the way to {@link advancePlannedBot}, and neither is its strategy: two races
 * where the same bot leads and trails read back identical power traces, and so
 * do two bots of one tier and different skill. That holds because a solo
 * race's bots have no draft (ADR 0061 D-4) unless the step asks for one.
 *
 * ## The draft (#2460, ADR 0067 D-3)
 *
 * With {@link BotRaceStep.draft} on, the field drafts: ADR 0038's model,
 * `draft.ts` §`fieldDraftFactors`, unchanged, over **every racer's effort
 * distance** as the race stood at the start of the tick, the rider's included,
 * in one call for the whole field (ADR 0060 D-5.3, as a room reads it). Never
 * the drawn distance: an item that knocks a racer back costs it its place on
 * the screen and never its shelter (D-3.2). Each bot's `k` multiplies its
 * `C_D·A` in its one tick through {@link advance} (ADR 0028 D-1), and nothing
 * else: its plan's power is the same, and it rides faster for it. The rider's
 * own `k`, from the same call, is #2461's. With the draft off, the default, no
 * racer drafts and the race is the race before #2460 to the bit (D-3.4).
 *
 * ## No instance, no network (D-7.3)
 *
 * Pure computation, as the rest of this package: time arrives as `Seconds`,
 * and nothing here reads a clock or names a platform API.
 */

import type {
  BotEnergy,
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
  botWPrimeJoules,
  stepRace,
  strategicBotDecision,
  type BotTier,
} from '@onyourleft/domain';

import { fieldDraftFactors } from './draft';
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
   * Its W′ balance (#2458, ADR 0067 D-2): spent above its CP, recovered below
   * it, and full at the start. Its capacity is fixed for the race.
   */
  readonly energy: BotEnergy;
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
  /**
   * Whether the field drafts this tick (#2460, ADR 0067 D-3.4: ADR 0066 D-6's
   * switch, which `apps/web` reads). Absent or `false`, no bot drafts.
   */
  readonly draft?: boolean;
}

/**
 * Every racer's draft multiplier `k`, by id, from the field's **effort
 * distances** as the race stands: one `draft.ts` §`fieldDraftFactors` call for
 * the whole field, the rider included (ADR 0067 D-3.1, D-3.2). Never the
 * drawn distance, which items move.
 */
export function lapRaceDraftFactors(race: ItemRaceState): Readonly<Record<string, number>> {
  const factors = fieldDraftFactors(race.racers.map((entry) => entry.racer.effortDistance));
  const byId: Record<string, number> = {};
  race.racers.forEach((entry, index) => {
    byId[entry.racer.id] = factors[index] as number;
  });
  return byId;
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
    energy: { wbalJoules: botWPrimeJoules(tier, pace), exhausted: false },
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
  // #2460: the field's shelter, once for every racer, as the race stood.
  const factors = step.draft === true ? lapRaceDraftFactors(race) : undefined;
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
      bot.energy,
      {
        effortDistance: bot.ride.distance,
        grade: botDemand(bot.ride, course).grade,
        elapsed: step.elapsed,
      },
    );
    const tick = advancePlannedBot(
      bot.ride,
      step.elapsed,
      course,
      planned.power,
      factors?.[bot.id] ?? 1,
    );
    effortDistances[bot.id] = tick.state.distance;
    return {
      ...bot,
      memory: decision.memory,
      energy: planned.energy,
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
