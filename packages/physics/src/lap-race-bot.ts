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
 * ## Tactics that read the race; a capacity that never moves (#2463, ADR 0067 D-0, D-1)
 *
 * Since #2463 a bot races: each tick, {@link stepBotRace} builds each bot's
 * `RaceView` from the race as it stood (its rank among the racers still
 * racing, the gaps ahead and behind, whether the racer ahead is in a move, the
 * rider's gap and power, the laps and metres left, the grade ahead, its own W′
 * balance), all on **effort distance**, never the drawn line. `tactics.ts`
 * §`decideTactic` picks its state once per decision window and gives a target;
 * the plan (`botPlanStep` with that target) shapes it to the road and the
 * bot's style, and `wbal.ts` §`spendableWatts` limits it to what the balance
 * pays for, before {@link advancePlannedBot} rides it through the one
 * {@link advance}. A bot's power now depends on the race, the rider included.
 *
 * **Its capacity does not** (ADR 0067 D-1.2, ADR 0060 D-14 Q4): the plan, its
 * CP, W′ and peak, is built once, at the bot's first tick, from its tier, its
 * pace (and so its archetype), the race's course and the race's seed
 * (`botRacePlan`), and kept on the bot ({@link LapRaceBot.plan}) for the race.
 * No rank, gap or rider reaches it, and `lap-race-bot.test.ts` replays each
 * bot's W′ balance from its own power on that one capacity, leading and
 * trailing. A bot that has finished races no more: it rides its plan alone.
 *
 * ## The budget (ADR 0067 D-6.4)
 *
 * O(bots) a tick: one sort of the racers still racing, one map by id, one
 * `fieldDraftFactors` call with the draft on, and per bot one view and one
 * `decideTactic` call. The view takes the place of the plan, which until
 * #2463 was rebuilt for every bot on every tick.
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
 * own `k` comes out of the same call, in {@link BotRaceTick.draft} (#2461):
 * `apps/web` rides the rider at it through the game's simulation, never a
 * second walk of the field. With the draft off, the default, no racer drafts
 * and the race is the race before #2460 to the bit (D-3.4).
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
  BotPlanTactic,
  BotRacePlan,
  BotStrategy,
  ItemRaceState,
  RaceTickInput,
  RaceView,
  Seconds,
  TacticMemory,
  Watts,
} from '@onyourleft/domain';
import {
  BOT_EVEN_PACE,
  BOT_MASS_KILOGRAMS,
  BOT_MEMORY_AT_START,
  BOT_TACTIC_MOVE_SHARE,
  botPlanStep,
  botRacePlan,
  botTierPlan,
  botWPrimeJoules,
  decideTactic,
  distanceOnRoute,
  gradeAt,
  stepRace,
  strategicBotDecision,
  TACTIC_MEMORY_AT_START,
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
  /** What its tactics remember from the last tick of this race (#2463): its state and since when. */
  readonly tactics: TacticMemory;
  /**
   * Its race plan, and in it its capacity (#2463, ADR 0067 D-1.1): built at its
   * first tick from its tier, pace, the course and the seed, then kept for the
   * race. `undefined` on the start line.
   */
  readonly plan: BotRacePlan | undefined;
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
  /**
   * The rider's power, W/kg, as the bots read it (#2463, ADR 0067 D-0): what
   * `RaceView.riderWattsPerKilogram` holds. Absent, the bots read none.
   */
  readonly riderWattsPerKilogram?: number | undefined;
}

/**
 * How far up the road a bot reads the grade ahead, metres (#2463): about 5 s at
 * a race pace, so a bot sees a climb coming before it is on it. ⚠️ A feel
 * number for #2464's harness and the owner.
 */
export const BOT_GRADE_AHEAD_METRES = 50;

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

/** A solo race one tick on: the race, its bots, and the field's draft that tick. */
export interface BotRaceTick {
  readonly race: ItemRaceState;
  readonly bots: readonly LapRaceBot[];
  /**
   * Every racer's draft multiplier `k` this tick, by id, the rider's included:
   * the one {@link lapRaceDraftFactors} call the bots were ridden at (#2461,
   * ADR 0067 D-3.1). Absent with {@link BotRaceStep.draft} off.
   */
  readonly draft?: Readonly<Record<string, number>>;
}

/**
 * A bot on the start line, with its strength, its way of racing and its pace
 * chosen apart. With no pace, it rides the even plan, a rouleur's (#2459), at its
 * tier's full power.
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
    tactics: TACTIC_MEMORY_AT_START,
    plan: undefined,
    energy: { wbalJoules: botWPrimeJoules(tier, pace), exhausted: false },
    ride: BOT_AT_START_LINE,
    power: 0,
  };
}

/**
 * The race and its bots one tick on. Each bot decides from the race as it
 * stood, rides its race plan's power through {@link advancePlannedBot}, and the race
 * takes the bots' effort distances and decisions with the rider's inputs. With
 * the draft on, the field's factors come back with it, the rider's included.
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
): BotRaceTick {
  const effortDistances: Record<string, number> = { ...step.rider?.effortDistances };
  const lanes: Record<string, number> = { ...step.rider?.lanes };
  const uses: string[] = [...(step.rider?.uses ?? [])];
  // #2460: the field's shelter, once for every racer, as the race stood.
  const factors = step.draft === true ? lapRaceDraftFactors(race) : undefined;
  // #2463: the race as it stood, once for the field: the racers still racing,
  // the leader first on effort distance, ties by id so a replay is the same.
  const racing = race.racers
    .filter((entry) => entry.racer.finishedAtMs === null)
    .map((entry) => entry.racer)
    .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1));
  const seats = new Map(racing.map((racer, at) => [racer.id, at]));
  const field = new Map(bots.map((bot) => [bot.id, bot]));
  const rider = race.racers.find((entry) => !field.has(entry.racer.id))?.racer;
  const riderPerKilogram = step.riderWattsPerKilogram ?? null;
  const raceMetres = race.course.lapLengthMetres * race.course.laps;
  const moved = bots.map((bot, seat): LapRaceBot => {
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
    // Its capacity, once a race (ADR 0067 D-1.1): nothing below changes it.
    const plan = bot.plan ?? botRacePlan(bot.tier, race.course, step.seed, bot.pace);
    // #2463: its tactic, from the race as it stood, while it is still racing.
    const at = seats.get(bot.id);
    let tactics = bot.tactics;
    let tactic: BotPlanTactic | undefined;
    if (at !== undefined) {
      const own = racing[at] as (typeof racing)[number];
      const ahead = racing[at - 1];
      const behind = racing[at + 1];
      const aheadBot = ahead === undefined ? undefined : field.get(ahead.id);
      const view: RaceView = {
        atMs: race.atMs,
        botIndex: seat,
        rank: at + 1,
        fieldSize: racing.length,
        gapAheadMetres: ahead === undefined ? null : ahead.effortDistance - own.effortDistance,
        gapBehindMetres: behind === undefined ? null : own.effortDistance - behind.effortDistance,
        // A bot ahead over its own CP is in a move; so is the rider ahead pushing.
        aheadInMove:
          ahead === undefined
            ? false
            : aheadBot === undefined
              ? riderPerKilogram !== null &&
                riderPerKilogram * BOT_MASS_KILOGRAMS >
                  plan.capacity.cpWatts * (1 + BOT_TACTIC_MOVE_SHARE)
              : aheadBot.plan !== undefined && aheadBot.power > aheadBot.plan.capacity.cpWatts,
        riderGapMetres: rider === undefined ? 0 : rider.effortDistance - own.effortDistance,
        riderWattsPerKilogram: riderPerKilogram,
        // On effort distance, as every distance here: an item's offset moves no lap.
        lapsLeft: Math.max(
          0,
          race.course.laps - Math.floor(own.effortDistance / race.course.lapLengthMetres),
        ),
        metresToLine: raceMetres - own.effortDistance,
        gradeAheadPercent: gradeAt(
          step.conditions.profile,
          distanceOnRoute(step.conditions.profile, bot.ride.distance + BOT_GRADE_AHEAD_METRES),
        ),
        energy: bot.energy,
        capacity: plan.capacity,
      };
      const decided = decideTactic(
        view,
        plan.archetype,
        bot.strategy.skill,
        bot.tactics,
        step.seed,
      );
      tactics = decided.memory;
      tactic = { targetWatts: decided.targetWatts, kick: decided.tactic === 'kick' };
    }
    // The plan reads the bot's own odometer, its effort distance, and the
    // grade under it there: never the race's view of where the bot is.
    const planned = botPlanStep(plan, bot.energy, {
      effortDistance: bot.ride.distance,
      grade: botDemand(bot.ride, course).grade,
      elapsed: step.elapsed,
      tactic,
    });
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
      plan,
      tactics,
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
    ...(factors === undefined ? {} : { draft: factors }),
  };
}
