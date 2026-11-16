// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: what the model is shown of the race, about 1 300 tokens.
 *
 * Each bot's racing style (#2720: dealt from the race's seed) and its legs
 * (its archetype), rank and gaps, who is directly ahead of it and that bot's
 * move, its W′ share and whether it is blown, whether it is drafting, its
 * move and how long it has held it, its laps and the metres to the line **as
 * it reads them**, the grade ahead and the rider's gap; and the rider's own
 * state: rank, W/kg, who is ahead of them, their gaps and whether they are
 * drafting (#2720, so a bot can mark the rider). **Every field is a number, a
 * move, a style or an archetype read off the race on effort distance: no
 * coordinate, no place name, no route name and no rider name is ever read**,
 * so nothing in it can say where a rider lives (CLAUDE.md §6, location data).
 * `model-input.test.ts` rides a circuit whose points carry real latitudes and
 * longitudes and finds none of them in the text.
 *
 * Spike code: see `decision.ts`.
 */

import {
  botLaunchMetres,
  botTacticsMisjudgement,
  distanceOnRoute,
  gradeAt,
  nextUnit,
  raceRandom,
  type ItemRaceState,
  type RouteProfile,
} from '@onyourleft/domain';
import { lapRaceDraftFactors, type LapRaceBot } from '@onyourleft/physics';

/**
 * How far up the road a bot's grade ahead is read, metres: **50**, the same
 * look-ahead the bots' own view takes (`@onyourleft/physics` §`BOT_GRADE_AHEAD_METRES`,
 * which the package does not export).
 */
export const MODEL_GRADE_AHEAD_METRES = 50;

/**
 * The racing styles a bot is dealt (#2720): how it likes to race, apart from
 * what its legs are good at. A `sprinter` is a wheel-sitter who waits for the
 * line; the prompt (`ollama.ts`) says what each of the others does.
 */
export const MODEL_RACING_STYLES = [
  'breakaway',
  'sprinter',
  'climber',
  'rouleur',
  'opportunist',
] as const;

export type ModelRacingStyle = (typeof MODEL_RACING_STYLES)[number];

/** What the styles' deal adds to the race's seed, so it draws apart from every other draw. */
const STYLE_SALT = 0x5717_1e5d;

/**
 * Each of `count` seats its racing style, dealt from the race's `seed`: every
 * style once before any twice, in an order the seed shuffles. So a field of
 * seven always holds all five, and the same seed deals the same field.
 */
export function modelRacingStyles(seed: number, count: number): readonly ModelRacingStyle[] {
  const deck = Array.from(
    { length: count },
    (_, at) => MODEL_RACING_STYLES[at % MODEL_RACING_STYLES.length] as ModelRacingStyle,
  );
  let random = raceRandom((seed ^ STYLE_SALT) >>> 0);
  for (let at = deck.length - 1; at > 0; at -= 1) {
    const drawn = nextUnit(random);
    random = drawn.next;
    const swap = Math.floor(drawn.value * (at + 1));
    [deck[at], deck[swap]] = [deck[swap] as ModelRacingStyle, deck[at] as ModelRacingStyle];
  }
  return deck;
}

/** One bot as the model reads it. */
export interface ModelBotView {
  readonly bot: number;
  /** How it likes to race, dealt from the seed (#2720). */
  readonly style: ModelRacingStyle;
  /** What its legs are good at: its archetype, which sets its sprint and its launch distance. */
  readonly legs: string;
  readonly rank: number;
  /**
   * Who is directly ahead (#2708): `"rider"`, another bot's seat, or `null`
   * when it leads. Since #2720 a `follow` or `chase` may name any racer; this
   * is the one it acts on without a target.
   */
  readonly ahead: 'rider' | number | null;
  /** The move of the bot directly ahead, or `null` when that is the rider (see `rider`) or nobody (#2708). */
  readonly aheadMove: string | null;
  readonly gapAheadM: number | null;
  readonly gapBehindM: number | null;
  /** The share of its W′ left, 0 to 1. */
  readonly wbal: number;
  /** Whether it is blown (#2720): its W′ ran out, and it rides no harder than CP until it has refilled some. */
  readonly blown: boolean;
  readonly drafting: boolean;
  readonly move: string;
  /** Whole seconds the bot has held {@link move}, 0 on the line (#2708). */
  readonly secondsInMove: number;
  readonly lapsLeft: number;
  /**
   * Metres to the line **as the bot reads them** (#2720): the true distance
   * plus its skill's misjudgement for the window (`@onyourleft/domain`
   * §`botTacticsMisjudgement`), the distance seeded `decideTactic` reads too.
   * A launch the model times is timed on what the bot thinks is left.
   */
  readonly toLineM: number;
  /** Where its legs would launch the sprint, metres to the line: a guide, not a rule, since #2720. */
  readonly launchM: number;
  readonly gradeAheadPct: number;
  /** Metres the rider is ahead of the bot, below 0 behind it. */
  readonly riderGapM: number;
}

/** The race as the model reads it at one instant. */
export interface ModelInput {
  readonly laps: number;
  readonly field: number;
  /**
   * Whole seconds since any bot was last attacking or on a flyer, or since
   * the start (#2708): the lull a rider reads before going, and what lets a
   * model that remembers nothing between calls space its attacks out.
   */
  readonly quietS: number;
  /** The rider's state (#2720), so a bot can mark them. */
  readonly rider: ModelRiderView;
  readonly bots: readonly ModelBotView[];
}

/** The rider as the model reads them (#2720). */
export interface ModelRiderView {
  readonly rank: number;
  readonly wPerKg: number | null;
  /** Who is directly ahead of the rider: a bot's seat, or `null` when the rider leads. */
  readonly ahead: number | null;
  readonly gapAheadM: number | null;
  readonly gapBehindM: number | null;
  readonly drafting: boolean;
}

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/**
 * The race at `race.atMs` as the model is shown it.
 *
 * @param seed - the race's own seed: the styles' deal and each bot's misread of the line.
 * @param draft - whether the field drafts (ADR 0066 D-6's switch).
 * @param riderWattsPerKilogram - the rider's power as the bots read it, or `null`.
 * @param quietSeconds - seconds since any bot was last attacking or on a flyer (`race.ts` §`quietSeconds`).
 */
export function modelInput(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  profile: RouteProfile,
  seed: number,
  draft: boolean,
  riderWattsPerKilogram: number | null,
  quietSeconds: number,
): ModelInput {
  const racing = race.racers
    .filter((entry) => entry.racer.finishedAtMs === null)
    .map((entry) => entry.racer)
    .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1));
  const rank = new Map(racing.map((racer, at) => [racer.id, at]));
  const ids = new Set(bots.map((bot) => bot.id));
  const rider = race.racers.find((entry) => !ids.has(entry.racer.id))?.racer;
  const seats = new Map(bots.map((bot, seat) => [bot.id, seat]));
  const factors = draft ? lapRaceDraftFactors(race) : undefined;
  const { laps, lapLengthMetres } = race.course;
  const styles = modelRacingStyles(seed, bots.length);
  const views: ModelBotView[] = [];
  bots.forEach((bot, seat) => {
    const at = rank.get(bot.id);
    if (at === undefined || bot.plan === undefined) return;
    const own = racing[at] as (typeof racing)[number];
    const ahead = racing[at - 1];
    const behind = racing[at + 1];
    const aheadSeat = ahead === undefined ? undefined : seats.get(ahead.id);
    const misread = botTacticsMisjudgement(seed, seat, bot.strategy.skill, race.atMs).lineMetres;
    views.push({
      bot: seat,
      style: styles[seat] as ModelRacingStyle,
      legs: bot.plan.archetype,
      rank: at + 1,
      ahead: ahead === undefined ? null : (aheadSeat ?? 'rider'),
      aheadMove: aheadSeat === undefined ? null : (bots[aheadSeat] as LapRaceBot).tactics.tactic,
      gapAheadM: ahead === undefined ? null : round(ahead.effortDistance - own.effortDistance, 1),
      gapBehindM:
        behind === undefined ? null : round(own.effortDistance - behind.effortDistance, 1),
      wbal: round(bot.energy.wbalJoules / bot.plan.capacity.wPrimeJoules, 2),
      blown: bot.energy.exhausted,
      drafting: (factors?.[bot.id] ?? 1) < 1,
      move: bot.tactics.tactic,
      secondsInMove:
        bot.tactics.sinceMs === null ? 0 : Math.floor((race.atMs - bot.tactics.sinceMs) / 1_000),
      lapsLeft: Math.max(0, laps - Math.floor(own.effortDistance / lapLengthMetres)),
      toLineM: Math.round(laps * lapLengthMetres - own.effortDistance + misread),
      launchM: Math.round(botLaunchMetres(bot.plan.archetype)),
      gradeAheadPct: round(
        gradeAt(profile, distanceOnRoute(profile, bot.ride.distance + MODEL_GRADE_AHEAD_METRES)),
        1,
      ),
      riderGapM: rider === undefined ? 0 : round(rider.effortDistance - own.effortDistance, 1),
    });
  });
  const riderAt = rider === undefined ? undefined : rank.get(rider.id);
  const riderAhead = riderAt === undefined ? undefined : racing[riderAt - 1];
  const riderBehind = riderAt === undefined ? undefined : racing[riderAt + 1];
  return {
    laps,
    field: racing.length,
    quietS: Math.floor(quietSeconds),
    rider: {
      rank: riderAt === undefined ? 0 : riderAt + 1,
      wPerKg: riderWattsPerKilogram === null ? null : round(riderWattsPerKilogram, 1),
      ahead: riderAhead === undefined ? null : (seats.get(riderAhead.id) ?? null),
      gapAheadM:
        rider === undefined || riderAhead === undefined
          ? null
          : round(riderAhead.effortDistance - rider.effortDistance, 1),
      gapBehindM:
        rider === undefined || riderBehind === undefined
          ? null
          : round(rider.effortDistance - riderBehind.effortDistance, 1),
      drafting: rider !== undefined && (factors?.[rider.id] ?? 1) < 1,
    },
    bots: views,
  };
}
