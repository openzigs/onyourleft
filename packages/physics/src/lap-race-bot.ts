// SPDX-License-Identifier: Apache-2.0

/**
 * Bots in a solo lap race — #1900, ADR 0060 D-7 and D-9.
 *
 * Built on the #92 bot pacer, and only on it. A bot's effort distance is
 * where {@link advanceBot} takes it: the pacing rule's power for the bot's
 * tier on the grade under the bot, through {@link advance}, the one tick in
 * this package. A bot on separate maths would fail `lap-race-bot.test.ts`,
 * which replaces `advance` with a sentinel and requires the bot's position to
 * change. The bot's offset comes from the race's items, under the same rules
 * as a rider's: {@link stepBotRace} hands the bots' effort distances and
 * decisions to `@onyourleft/domain` §`stepRace`, beside the rider's inputs.
 *
 * ## What a bot is made of: a tier, the pacing rule, the course and a seed
 *
 * The whole of a bot is an id, a {@link BotTier} and its own ride state. The
 * whole of a tick's inputs is the elapsed time, the course's conditions (the
 * same {@link BotCourse} the #92 bot takes, minus the plan the tier supplies),
 * the race's seed and the rider's inputs. **No activity, stream, ghost or
 * recorded sample is a parameter anywhere here** (ADR 0007 D4, ADR 0060 D-7.1),
 * and a type-level test holds the signatures to that.
 *
 * ## No rubber-banding (D-9)
 *
 * A bot's power is a function of its tier and the road under it. The race's
 * standings are never read on the way to {@link advanceBot}: two races where
 * the same bot leads and trails read back identical power traces.
 *
 * ## No instance, no network (D-7.3)
 *
 * Pure computation, as the rest of this package: time arrives as `Seconds`,
 * and nothing here reads a clock or names a platform API.
 */

import type { ItemRaceState, RaceTickInput, Seconds, Watts } from '@onyourleft/domain';
import { botDecision, botTierPlan, stepRace, type BotTier } from '@onyourleft/domain';

import { advanceBot, BOT_AT_START_LINE, type BotCourse } from './pacer';
import type { RideState } from './simulate';

/** One bot in a race: an id, a tier, and where its own power has taken it. */
export interface LapRaceBot {
  readonly id: string;
  readonly tier: BotTier;
  readonly ride: RideState;
  /** What the pacing rule asked for on the last tick, in watts. 0 before the first. */
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
   * are drawn from it. `botDecision` refuses one that is not a safe whole
   * number.
   */
  readonly seed: number;
  /** The rider's inputs this tick, as their client sends them. */
  readonly rider?: Omit<RaceTickInput, 'atMs'>;
}

/** A bot on the start line. */
export function lapRaceBot(id: string, tier: BotTier): LapRaceBot {
  return { id, tier, ride: BOT_AT_START_LINE, power: 0 };
}

/**
 * The race and its bots one tick on. Each bot decides from the race as it
 * stood, rides its tier's pace through {@link advanceBot}, and the race takes
 * the bots' effort distances and decisions with the rider's inputs.
 *
 * @throws through {@link advanceBot} for an elapsed time that is not finite,
 * and through `stepRace` for any input the race refuses.
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
    // How far the bot will ride this tick, near enough: what its puddle look-ahead grows to.
    const decision = botDecision(race, bot.id, step.seed, bot.ride.speed * step.elapsed);
    lanes[bot.id] = decision.lane;
    if (decision.use) uses.push(bot.id);
    const tick = advanceBot(bot.ride, step.elapsed, {
      ...step.conditions,
      plan: botTierPlan(bot.tier),
    });
    effortDistances[bot.id] = tick.state.distance;
    return { ...bot, ride: tick.state, power: tick.power };
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
