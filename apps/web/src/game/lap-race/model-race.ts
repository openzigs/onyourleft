// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A lap race with AI bots, on the device** — #2710, ADR 0071.
 *
 * The race (`ride-race.ts`) holds one {@link LapRaceModel} for a race the
 * rider chose to ride with AI bots, and this module is what it does with one:
 * the moves in force handed to the bots before each tick
 * ({@link applyLapRaceModel}), the race state the model is shown
 * ({@link modelTacticsInputOf}), the ask ({@link askLapRaceModel}), the answer
 * logged at the race time it arrived ({@link answerLapRaceModel}), and the
 * record kept with the ride ({@link lapRaceModelFact}). Every rule about which
 * move a bot rides is `@onyourleft/domain` §`model-race.ts`'s; this module only
 * moves the log and the race past it.
 *
 * ## The race never waits (D-4.5, D-7)
 *
 * Ticks run at the race's rate whatever the model does. An ask goes out only
 * between frames, and only one at a time; its answer is logged on the first
 * frame after it settles, at that frame's race time, and applies from the next
 * tactics window. An answer more than `MODEL_TACTICS_LATE_MS` after its ask,
 * of race time, is logged late and never applied; a call still out that long
 * is given up as late, and the next ask goes out. **An invalid answer, a
 * refusal, a failure and an instance that cannot be reached all apply
 * nothing**, so the bots ride their seeded choice — and a race that loses its
 * instance mid-race finishes on seeded tactics. Nothing retries in a loop, and
 * nothing asks the rider anything mid-race.
 *
 * ## What the model is shown (D-3.4, ADR 0073 D-5)
 *
 * {@link modelTacticsInputOf}: `@onyourleft/domain` §`ModelTacticsInput`, read
 * off the race on effort distance — seats, each bot's racing style dealt from
 * the race's seed (`modelRacingStyles`) and its legs (its archetype), ranks,
 * who is ahead and its move, gaps, W′ shares and whether a bot is blown,
 * drafting, moves and the seconds held, the lull, laps and metres to the line
 * **as each bot misreads them** (`botTacticsMisjudgement`, the reading seeded
 * `decideTactic` launches on: ADR 0073 D-3.5), launch distance, grade ahead,
 * each bot's gap to the rider, and the rider's own state: rank, W/kg, who is
 * ahead of them, their gaps and whether they draft (D-5.2). There is no attack
 * gate (D-5.3). **No coordinate, no place name, no rider name, no date and no
 * identifier**: every field is a number, a boolean or a word from a closed
 * list, and the device checks it with the instance's own reader before it is
 * sent. **The rider's state (#2715):** where the racer directly ahead of a bot
 * is the rider, that bot's `aheadMove` is the rider's move as the seeded race
 * reads it — `attack` while the rider pushes over the bot's critical power by
 * `BOT_TACTIC_MOVE_SHARE` (`physics` §`stepBotRace`'s `aheadInMove`), `sit-in`
 * otherwise, `null` with no power to read — so a bot can mark the rider: go
 * with the rider's move as it would with a bot's.
 *
 * ## What is kept (D-4.4)
 *
 * The seed, the log, the bot-code version and the rider's own input at every
 * race tick (effort distance, W/kg, lane, item use): what a replay needs,
 * because the bots read the rider. Kept on the device, with the ride. The
 * model's text is never kept; the model input is not kept, because it is
 * rederived from the rest (D-11 R-7).
 */

import {
  applyModelMoves,
  BOT_MASS_KILOGRAMS,
  BOT_TACTIC_MOVE_SHARE,
  BOT_TACTICS_WINDOW_MS,
  botLaunchMetres,
  botTacticsMisjudgement,
  distanceOnRoute,
  gradeAt,
  LAP_RACE_BOT_CODE_VERSION,
  MODEL_TACTICS_ASK_EVERY_MS,
  MODEL_TACTICS_LATE_MS,
  MODEL_TACTICS_LOG_REASONS,
  modelMovesInForce,
  modelRacingStyles,
  modelTacticsNextAskAtMs,
  readModelTacticsAnswer,
  readModelTacticsInput,
  type ItemRaceState,
  type LapRaceModelRecord,
  type ModelTacticsBotView,
  type ModelTacticsInput,
  type ModelTacticsLogEntry,
  type ModelTacticsLogReason,
  type ModelRacingStyle,
} from '@onyourleft/domain';
import {
  lapRaceDraftFactors,
  type LapRaceBot,
  type LapRaceBotConditions,
} from '@onyourleft/physics';

/** How far up the road a bot's grade ahead is read, metres: the bots' own look-ahead (`physics` §`BOT_GRADE_AHEAD_METRES`). */
const GRADE_AHEAD_METRES = 50;

/** The road the bots ride, as the model is shown it: the route and the line (#2800). */
export type BotRoad = Pick<LapRaceBotConditions, 'profile' | 'lineMetres'>;

/**
 * The rider's own input at every race tick, appended in place, one entry a
 * tick: what a replay of the bots needs (D-4.1). Appended, never copied, so a
 * tick allocates nothing for it beyond the arrays' own growth.
 */
export interface LapRaceRiderTrace {
  /** The rider's effort distance after each tick, metres. */
  readonly effortDistances: number[];
  /** The rider's power as the bots read it, W/kg, or `null` with none. */
  readonly wattsPerKilogram: (number | null)[];
  /** The lane the rider rode each tick. */
  readonly lanes: number[];
  /** The ticks, from 0, on which the rider used their held item. */
  readonly uses: number[];
}

/** A model call out now: when it was asked, and the race it belongs to. */
export interface LapRaceModelAsk {
  readonly askedAtMs: number;
  /** The race's own trace: what tells an answer for this race from one for a race since ended. */
  readonly race: LapRaceRiderTrace;
  /** The seats the race state named, which an answer may name. */
  readonly seats: readonly number[];
}

/** The AI side of a lap race. */
export interface LapRaceModel {
  readonly version: number;
  readonly log: readonly ModelTacticsLogEntry[];
  /** The call out now, or `undefined`. */
  readonly asked: LapRaceModelAsk | undefined;
  /** Race time of the next ask, ms. */
  readonly nextAskAtMs: number;
  /** The last race time any bot was attacking or on a flyer, ms, or nought. */
  readonly quietSinceMs: number;
  readonly rider: LapRaceRiderTrace;
  /**
   * Why AI bots are not riding this race, as the instance said at its start
   * (D-6.3): the race rides seeded tactics and asks nothing more. `undefined`
   * while they may.
   */
  readonly unavailable: ModelTacticsLogReason | undefined;
}

/** A new race's AI side: nothing asked, nothing logged. */
export function startLapRaceModel(): LapRaceModel {
  return {
    version: LAP_RACE_BOT_CODE_VERSION,
    log: [],
    asked: undefined,
    // The first ask four seconds after Go: the start is the bots' own.
    nextAskAtMs: MODEL_TACTICS_ASK_EVERY_MS,
    quietSinceMs: 0,
    rider: { effortDistances: [], wattsPerKilogram: [], lanes: [], uses: [] },
    unavailable: undefined,
  };
}

/** What a call on the instance came to, as the device's tactics port reads it. */
export type ModelTacticsReply =
  /** A 200 and its body, not yet checked here: the device checks it again (D-3.2). */
  | { readonly kind: 'answer'; readonly body: unknown }
  /** The instance refused, with its code when it named one. */
  | { readonly kind: 'refused'; readonly code?: string | undefined }
  /** No answer could be had or read. */
  | { readonly kind: 'unreachable' };

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/**
 * The race at `race.atMs` as the model is shown it (D-3.4), or `undefined`
 * when no bot is still racing. See the file comment.
 *
 * @param road - the road the bots ride (`ride-race.ts` §`LapRaceRide.conditions`):
 * the route, and the line their odometers read nought at (#2800), so the grade
 * ahead the model is shown is the one each bot reads, where it is drawn.
 * @param seed - the race's own seed: the styles' deal and each bot's misread of the line.
 * @param riderWattsPerKilogram - the rider's power as the bots read it, or `null`.
 */
export function modelTacticsInputOf(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  road: BotRoad,
  seed: number,
  draft: boolean,
  riderWattsPerKilogram: number | null,
  quietSinceMs: number,
): ModelTacticsInput | undefined {
  const { profile } = road;
  const line = road.lineMetres ?? 0;
  const racing = race.racers
    .filter((entry) => entry.racer.finishedAtMs === null)
    .map((entry) => entry.racer)
    .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1));
  const rank = new Map(racing.map((racer, at) => [racer.id, at]));
  const seats = new Map(bots.map((bot, seat) => [bot.id, seat]));
  const rider = race.racers.find((entry) => !seats.has(entry.racer.id))?.racer;
  const factors = draft ? lapRaceDraftFactors(race) : undefined;
  const { laps, lapLengthMetres } = race.course;
  const styles = modelRacingStyles(seed, bots.length);
  const views: ModelTacticsBotView[] = [];
  bots.forEach((bot, seat) => {
    const at = rank.get(bot.id);
    if (at === undefined || bot.plan === undefined) return;
    const own = racing[at] as (typeof racing)[number];
    const ahead = racing[at - 1];
    const behind = racing[at + 1];
    const aheadSeat = ahead === undefined ? undefined : seats.get(ahead.id);
    const riderMove =
      riderWattsPerKilogram === null
        ? null
        : riderWattsPerKilogram * BOT_MASS_KILOGRAMS >
            bot.plan.capacity.cpWatts * (1 + BOT_TACTIC_MOVE_SHARE)
          ? 'attack'
          : 'sit-in';
    const misread = botTacticsMisjudgement(seed, seat, bot.strategy.skill, race.atMs).lineMetres;
    views.push({
      bot: seat,
      style: styles[seat] as ModelRacingStyle,
      legs: bot.plan.archetype,
      rank: at + 1,
      ahead: ahead === undefined ? null : (aheadSeat ?? 'rider'),
      aheadMove:
        ahead === undefined
          ? null
          : aheadSeat === undefined
            ? riderMove
            : (bots[aheadSeat] as LapRaceBot).tactics.tactic,
      gapAheadM:
        ahead === undefined
          ? null
          : round(Math.max(0, ahead.effortDistance - own.effortDistance), 1),
      gapBehindM:
        behind === undefined
          ? null
          : round(Math.max(0, own.effortDistance - behind.effortDistance), 1),
      wbal: round(
        Math.min(1, Math.max(0, bot.energy.wbalJoules / bot.plan.capacity.wPrimeJoules)),
        2,
      ),
      blown: bot.energy.exhausted,
      drafting: (factors?.[bot.id] ?? 1) < 1,
      move: bot.tactics.tactic,
      secondsInMove:
        bot.tactics.sinceMs === null
          ? 0
          : Math.max(0, Math.floor((race.atMs - bot.tactics.sinceMs) / 1_000)),
      lapsLeft: Math.max(0, laps - Math.floor(own.effortDistance / lapLengthMetres)),
      toLineM: Math.round(laps * lapLengthMetres - own.effortDistance + misread),
      launchM: Math.round(botLaunchMetres(bot.plan.archetype)),
      gradeAheadPct: round(
        gradeAt(profile, distanceOnRoute(profile, bot.ride.distance + line + GRADE_AHEAD_METRES)),
        1,
      ),
      riderGapM: rider === undefined ? 0 : round(rider.effortDistance - own.effortDistance, 1),
    });
  });
  if (views.length === 0) return undefined;
  const riderAt = rider === undefined ? undefined : rank.get(rider.id);
  const riderAhead = riderAt === undefined ? undefined : racing[riderAt - 1];
  const riderBehind = riderAt === undefined ? undefined : racing[riderAt + 1];
  const riderDistance = rider?.effortDistance ?? 0;
  return {
    laps,
    field: racing.length,
    quietS: Math.max(0, Math.floor((race.atMs - quietSinceMs) / 1_000)),
    rider: {
      rank: riderAt === undefined ? 0 : riderAt + 1,
      wPerKg: riderWattsPerKilogram === null ? null : round(riderWattsPerKilogram, 1),
      ahead: riderAhead === undefined ? null : (seats.get(riderAhead.id) ?? null),
      gapAheadM:
        riderAhead === undefined
          ? null
          : round(Math.max(0, riderAhead.effortDistance - riderDistance), 1),
      gapBehindM:
        riderBehind === undefined
          ? null
          : round(Math.max(0, riderDistance - riderBehind.effortDistance), 1),
      drafting: rider !== undefined && riderAt !== undefined && (factors?.[rider.id] ?? 1) < 1,
    },
    bots: views,
  };
}

/**
 * The bots before the tick at `race.atMs`, with the moves in force applied to
 * each whose tactics window opens on it (`@onyourleft/domain`
 * §`applyModelMoves`). The log is read only on a tick that opens a window.
 */
export function applyLapRaceModel(
  model: LapRaceModel,
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  seed: number,
): readonly LapRaceBot[] {
  const window = Math.floor(race.atMs / BOT_TACTICS_WINDOW_MS);
  if (bots.every((bot) => bot.plan === undefined || bot.tactics.window === window)) return bots;
  return applyModelMoves(race, bots, modelMovesInForce(model.log, race.atMs), seed).bots;
}

/** One tick of the rider's own input, as the race handed it to the bots. */
export interface LapRaceRiderTick {
  readonly effortDistance: number;
  readonly wattsPerKilogram: number | null;
  readonly lane: number;
  readonly used: boolean;
}

/**
 * The AI side after a tick: the rider's input appended to the trace, and the
 * lull moved on while any bot is attacking or on a flyer. Nothing once every
 * bot has finished. O(racers).
 */
export function noteLapRaceModelTick(
  model: LapRaceModel,
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  rider: LapRaceRiderTick,
): LapRaceModel {
  // Once every bot is over the line nothing more of the race can change, and
  // the ride may go on for hours: the trace stops with the race.
  const ids = new Set(bots.map((bot) => bot.id));
  const racing = race.racers.some(
    (entry) => ids.has(entry.racer.id) && entry.racer.finishedAtMs === null,
  );
  if (!racing) return model;
  const trace = model.rider;
  if (rider.used) trace.uses.push(trace.effortDistances.length);
  trace.effortDistances.push(rider.effortDistance);
  trace.wattsPerKilogram.push(rider.wattsPerKilogram);
  trace.lanes.push(rider.lane);
  const moving = bots.some(
    (bot) => bot.tactics.tactic === 'attack' || bot.tactics.tactic === 'flyer',
  );
  return moving ? { ...model, quietSinceMs: race.atMs } : model;
}

/** `model` with `entry` logged and the call it settles let go. */
function settled(model: LapRaceModel, entry: ModelTacticsLogEntry): LapRaceModel {
  return {
    ...model,
    log: [...model.log, entry],
    asked: undefined,
    nextAskAtMs: modelTacticsNextAskAtMs(entry.arrivedAtMs),
  };
}

/** What {@link askLapRaceModel} sends, and the model as it stands once it has. */
export interface LapRaceModelAsking {
  readonly model: LapRaceModel;
  /** The race state to send, and the ask it answers, or `undefined` with nothing to send now. */
  readonly send: { readonly input: ModelTacticsInput; readonly ask: LapRaceModelAsk } | undefined;
}

/**
 * Between frames: give up a call out longer than `MODEL_TACTICS_LATE_MS`, and
 * ask again when an ask is due and none is out. Nothing once the instance said
 * AI bots are not available for this race.
 */
export function askLapRaceModel(
  model: LapRaceModel,
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  road: BotRoad,
  seed: number,
  draft: boolean,
  riderWattsPerKilogram: number | null,
): LapRaceModelAsking {
  let next = model;
  const out = next.asked;
  if (out !== undefined && race.atMs - out.askedAtMs > MODEL_TACTICS_LATE_MS) {
    next = settled(next, {
      askedAtMs: out.askedAtMs,
      arrivedAtMs: race.atMs,
      outcome: 'late',
      reason: 'no-answer',
    });
  }
  if (next.unavailable !== undefined || next.asked !== undefined || race.atMs < next.nextAskAtMs) {
    return { model: next, send: undefined };
  }
  const input = modelTacticsInputOf(
    race,
    bots,
    road,
    seed,
    draft,
    riderWattsPerKilogram,
    next.quietSinceMs,
  );
  if (input === undefined) return { model: next, send: undefined };
  // The instance's own reader, before anything leaves (D-3.4): a race state it
  // would refuse is never sent, and the window rides its seeded tactics.
  if (!readModelTacticsInput(input).ok) {
    return {
      model: settled(next, {
        askedAtMs: race.atMs,
        arrivedAtMs: race.atMs,
        outcome: 'failed',
        reason: 'validation_failed',
      }),
      send: undefined,
    };
  }
  const ask: LapRaceModelAsk = {
    askedAtMs: race.atMs,
    race: next.rider,
    seats: input.bots.map((view) => view.bot),
  };
  return { model: { ...next, asked: ask }, send: { input, ask } };
}

const REASONS: ReadonlySet<string> = new Set(MODEL_TACTICS_LOG_REASONS);

/** A refusal's code as the log keeps it: one of the closed list, else `refused`. */
function refusalReason(code: string | undefined): ModelTacticsLogReason {
  return code !== undefined && REASONS.has(code) ? (code as ModelTacticsLogReason) : 'refused';
}

/**
 * The model once `reply` to `ask` arrived at `race.atMs`: logged at that race
 * time, the device's second check made of an answer (D-3.2), and late past
 * `MODEL_TACTICS_LATE_MS`. An answer to an ask this race has given up, or to
 * another race, changes nothing.
 */
export function answerLapRaceModel(
  model: LapRaceModel,
  race: ItemRaceState,
  ask: LapRaceModelAsk,
  reply: ModelTacticsReply,
): LapRaceModel {
  if (model.asked !== ask) return model;
  const times = { askedAtMs: ask.askedAtMs, arrivedAtMs: race.atMs };
  if (race.atMs - ask.askedAtMs > MODEL_TACTICS_LATE_MS) {
    return settled(model, { ...times, outcome: 'late', reason: 'no-answer' });
  }
  switch (reply.kind) {
    case 'unreachable':
      return settled(model, { ...times, outcome: 'failed', reason: 'unreachable' });
    case 'refused': {
      const reason = refusalReason(reply.code);
      return settled(model, {
        ...times,
        outcome:
          reason === 'tactics_invalid'
            ? 'invalid'
            : reason === 'tactics_failed'
              ? 'failed'
              : 'refused',
        reason,
      });
    }
    case 'answer': {
      let text: string;
      try {
        text = JSON.stringify(reply.body) ?? '';
      } catch {
        return settled(model, { ...times, outcome: 'invalid', reason: 'not-json' });
      }
      const read = readModelTacticsAnswer(text, ask.seats);
      return read.ok
        ? settled(model, { ...times, outcome: 'decision', moves: read.moves })
        : settled(model, { ...times, outcome: 'invalid', reason: read.reason });
    }
  }
}

/**
 * The model once the instance answered the race's start (D-6.3, D-6.5): a
 * refusal means AI bots are not riding this race, which rides its seeded
 * tactics and asks nothing more. A start that could not be had says nothing:
 * the race asks, and a decision that fails falls back on its own.
 */
export function startedLapRaceModel(model: LapRaceModel, reply: ModelTacticsReply): LapRaceModel {
  if (reply.kind !== 'refused') return model;
  return { ...model, unavailable: refusalReason(reply.code), asked: undefined };
}

/** The record of a model race, to keep with the ride: copies, so nothing the race appends later changes it. */
export function lapRaceModelFact(model: LapRaceModel, seed: number): LapRaceModelRecord {
  return {
    version: model.version,
    seed,
    log: [...model.log],
    rider: {
      effortDistances: [...model.rider.effortDistances],
      wattsPerKilogram: [...model.rider.wattsPerKilogram],
      lanes: [...model.rider.lanes],
      uses: [...model.rider.uses],
    },
  };
}
