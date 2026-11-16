// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: what the model is shown of the race, about 1 000 tokens.
 *
 * Each bot's rank and gaps, who is directly ahead of it and that bot's move,
 * its W′ share, whether it is drafting, its move and how long it has held it,
 * its laps and metres to the line, the grade ahead, the rider's gap; and the
 * rider's rank and W/kg. (#2708 added the racer ahead, its move and the
 * seconds held, so a `follow` or `chase` can name the one racer it may.) **Every field is a number, a move or an archetype read off
 * the race on effort distance: no coordinate, no place name, no route name
 * and no rider name is ever read**, so nothing in it can say where a rider
 * lives (CLAUDE.md §6, location data). `model-input.test.ts` rides a circuit
 * whose points carry real latitudes and longitudes and finds none of them in
 * the text.
 *
 * Spike code: see `decision.ts`.
 */

import {
  botLaunchMetres,
  distanceOnRoute,
  gradeAt,
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
 * How long the field must have been quiet, no bot attacking or on a flyer,
 * before the model is told a new attack is open, seconds: **30** (#2708).
 * Told only the seconds, gemma4:12b started attacks inside the lull anyway
 * (at 4 s on the hilly circuit, and straight after another bot's); a yes or
 * no it reads off the race is what it mostly kept to (spike 0039 §10.3 says
 * where it did not).
 */
export const MODEL_ATTACK_QUIET_SECONDS = 30;

/** One bot as the model reads it. */
export interface ModelBotView {
  readonly bot: number;
  readonly style: string;
  readonly rank: number;
  /**
   * Who is directly ahead (#2708): `"rider"`, another bot's seat, or `null`
   * when it leads. The only racer a `follow` or `chase` may name.
   */
  readonly ahead: 'rider' | number | null;
  /** The move of the bot directly ahead, or `null` when that is the rider or nobody (#2708). */
  readonly aheadMove: string | null;
  readonly gapAheadM: number | null;
  readonly gapBehindM: number | null;
  readonly wbal: number;
  readonly drafting: boolean;
  readonly move: string;
  /** Whole seconds the bot has held {@link move}, 0 on the line (#2708). */
  readonly secondsInMove: number;
  readonly lapsLeft: number;
  readonly toLineM: number;
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
  /** Whether a new attack or flyer may start: {@link quietS} at {@link MODEL_ATTACK_QUIET_SECONDS} or more (#2708). */
  readonly attackOpen: boolean;
  readonly rider: { readonly rank: number; readonly wPerKg: number | null };
  readonly bots: readonly ModelBotView[];
}

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/**
 * The race at `race.atMs` as the model is shown it.
 *
 * @param draft - whether the field drafts (ADR 0066 D-6's switch).
 * @param riderWattsPerKilogram - the rider's power as the bots read it, or `null`.
 * @param quietSeconds - seconds since any bot was last attacking or on a flyer (`race.ts` §`quietSeconds`).
 */
export function modelInput(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  profile: RouteProfile,
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
  const views: ModelBotView[] = [];
  bots.forEach((bot, seat) => {
    const at = rank.get(bot.id);
    if (at === undefined || bot.plan === undefined) return;
    const own = racing[at] as (typeof racing)[number];
    const ahead = racing[at - 1];
    const behind = racing[at + 1];
    const aheadSeat = ahead === undefined ? undefined : seats.get(ahead.id);
    views.push({
      bot: seat,
      style: bot.plan.archetype,
      rank: at + 1,
      ahead: ahead === undefined ? null : (aheadSeat ?? 'rider'),
      aheadMove: aheadSeat === undefined ? null : (bots[aheadSeat] as LapRaceBot).tactics.tactic,
      gapAheadM: ahead === undefined ? null : round(ahead.effortDistance - own.effortDistance, 1),
      gapBehindM:
        behind === undefined ? null : round(own.effortDistance - behind.effortDistance, 1),
      wbal: round(bot.energy.wbalJoules / bot.plan.capacity.wPrimeJoules, 2),
      drafting: (factors?.[bot.id] ?? 1) < 1,
      move: bot.tactics.tactic,
      secondsInMove:
        bot.tactics.sinceMs === null ? 0 : Math.floor((race.atMs - bot.tactics.sinceMs) / 1_000),
      lapsLeft: Math.max(0, laps - Math.floor(own.effortDistance / lapLengthMetres)),
      toLineM: Math.round(laps * lapLengthMetres - own.effortDistance),
      launchM: Math.round(botLaunchMetres(bot.plan.archetype)),
      gradeAheadPct: round(
        gradeAt(profile, distanceOnRoute(profile, bot.ride.distance + MODEL_GRADE_AHEAD_METRES)),
        1,
      ),
      riderGapM: rider === undefined ? 0 : round(rider.effortDistance - own.effortDistance, 1),
    });
  });
  return {
    laps,
    field: racing.length,
    quietS: Math.floor(quietSeconds),
    attackOpen: quietSeconds >= MODEL_ATTACK_QUIET_SECONDS,
    rider: {
      rank: rider === undefined ? 0 : (rank.get(rider.id) ?? -1) + 1,
      wPerKg: riderWattsPerKilogram === null ? null : round(riderWattsPerKilogram, 1),
    },
    bots: views,
  };
}
