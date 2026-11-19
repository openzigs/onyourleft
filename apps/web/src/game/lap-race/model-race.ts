// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A lap race with AI bots, on the device** — #2710, ADR 0071.
 *
 * The race (`ride-race.ts`) holds one {@link LapRaceModel} for a race the
 * rider chose to ride with AI bots, and this module is what it does with one:
 * the moves in force handed to the bots before each tick
 * ({@link applyLapRaceModel}), the race read off in full
 * ({@link modelTacticsRaceOf}), the ask for one bot ({@link askLapRaceModel}),
 * the answer logged at the race time it arrived ({@link answerLapRaceModel}),
 * and the record kept with the ride ({@link lapRaceModelFact}). Every rule
 * about which move a bot rides, and which moves it is offered, is
 * `@onyourleft/domain` §`model-race.ts`'s and §`model-tactics.ts`'s; this
 * module only moves the log and the race past it.
 *
 * ## One bot at a time, round the field (#2836, ADR 0081 D-2)
 *
 * Until bot-code version 7 one call asked for every bot's move, every 4 s. On
 * the owner's race of 2026-11-18 the model answered `sit-in` for five of seven
 * bots in every answer. So an ask is now about ONE bot: the next seat round
 * the field that has something to choose (`@onyourleft/domain`
 * §`modelTacticsAsk`: its menu of two to four moves, its cue words, and the
 * story so far), no more often than once a second and with one call out at a
 * time. A bot with nothing to choose — blown, inside its launch, or with only
 * sitting in on offer — is passed over and costs no call. An answer holds for
 * the bot it names, and a `sit-in` leaves the bot to its seeded tactics.
 *
 * ## The race never waits (D-4.5, D-7)
 *
 * Ticks run at the race's rate whatever the model does. An ask goes out only
 * between frames, and only one at a time; its answer is logged on the first
 * frame after it settles, at that frame's race time, and applies from the next
 * tactics window. An answer more than `MODEL_TACTICS_LATE_MS` (8 s since
 * #2759, ADR 0076 D-11) after its ask, of race time, is logged late and never
 * applied; a call still out that long is given up as late, and the next ask
 * goes out. **An invalid answer, a
 * refusal, a failure and an instance that cannot be reached all apply
 * nothing**, so the bots ride their seeded choice — and a race that loses its
 * instance mid-race finishes on seeded tactics. Nothing retries in a loop, and
 * nothing asks the rider anything mid-race.
 *
 * ## What the race reads off, and an ask is made from (D-3.4, ADR 0073 D-5)
 *
 * {@link modelTacticsRaceOf}: `@onyourleft/domain` §`ModelTacticsRace`, read
 * off the race on effort distance — seats, each bot's racing style dealt from
 * the race's seed (`modelRacingStyles`), which since #2759 decides its legs
 * (so they are not sent: ADR 0076 D-11), and how it compares with the field on the flat,
 * a climb, a sprint and in punch (`modelFieldStrengths`, ADR 0076 D-4), ranks,
 * who is ahead and its move, gaps, W′ shares and whether a bot is blown,
 * drafting, moves and the seconds held, the lull, laps and metres to the line
 * **as each bot misreads them** (`botTacticsMisjudgement`, the reading seeded
 * `decideTactic` launches on: ADR 0073 D-3.5), launch distance, grade ahead,
 * each bot's gap to the rider, and the rider's own state: rank, W/kg, who is
 * ahead of them, their gaps and whether they draft (D-5.2). There is no attack
 * gate (D-5.3). **The course ahead (#2794)**, once for the race from the
 * leading bot: the next climb and descent before the line, the lap's metres
 * and climbing left, and the grade of the last 500 m (§`lapRaceCourseAhead`).
 * **No coordinate, no place name, no rider name, no date and no
 * identifier**: every field is a number, a boolean or a word from a closed
 * list, and the device checks it with the instance's own reader before it is
 * sent. **Rounded for latency** (#2759, ADR 0076 D-11): every gap to whole
 * metres, the grade to a whole percent and a W′ share to a tenth, because
 * each digit is a token the model reads and none of them moves a decision. **The rider's state (#2715):** where the racer directly ahead of a bot
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
 *
 * **And what explains the race afterwards** (#2836, ADR 0081 D-5), which no
 * replay reads: each bot's racing style, personality and skill; with every
 * call, the bot asked about, its place, its cue words and menu, and the
 * model's reason word; and every change of move with who chose it — the
 * model, the bot's seeded tactics, or its sprint instinct
 * ({@link LapRaceMoveTrace}). Numbers and closed words only.
 */

import {
  applyModelMoves,
  BOT_HARD_TACTICS,
  BOT_TACTIC_MOVE_SHARE,
  BOT_TACTICS_WINDOW_MS,
  botLaunchMetres,
  botTacticsMisjudgement,
  COURSE_ROUNDING_METRES,
  courseAverageGrade,
  courseClimbing,
  courseHillsAhead,
  distanceOnRoute,
  gradeAt,
  LAP_RACE_BOT_CODE_VERSION,
  LAP_RACE_MODEL_MOST_MOVES,
  MODEL_TACTICS_ASK_EVERY_MS,
  MODEL_TACTICS_FIRST_ASK_MS,
  MODEL_TACTICS_LATE_MS,
  MODEL_TACTICS_LOG_REASONS,
  modelMoveChooser,
  modelMovesInForce,
  modelFieldStrengths,
  modelRacingStyleOf,
  modelTacticsAsk,
  modelTacticsBreak,
  modelTacticsMoveOf,
  modelTacticsNextAskAtMs,
  readModelTacticsAnswer,
  readModelTacticsInput,
  type BotRacePlan,
  type BotTactic,
  type ItemRaceState,
  type LapRaceModelRecord,
  type LapRaceModelRode,
  type ModelBotStrengths,
  type ModelMoveChooser,
  type ModelTacticsBotView,
  type ModelTacticsCourse,
  type ModelTacticsCue,
  type ModelTacticsInput,
  type ModelTacticsLogEntry,
  type ModelTacticsLogReason,
  type ModelTacticsMenuEntry,
  type ModelTacticsRace,
} from '@onyourleft/domain';
import {
  lapRaceBotMassKilograms,
  lapRaceDraftFactors,
  type LapRaceBot,
  type LapRaceBotConditions,
} from '@onyourleft/physics';

/** How far up the road a bot's grade ahead is read, metres: the bots' own look-ahead (`physics` §`BOT_GRADE_AHEAD_METRES`). */
const GRADE_AHEAD_METRES = 50;

/** The road the bots ride, as the model is shown it: the route and the line (#2800). */
export type BotRoad = Pick<LapRaceBotConditions, 'profile' | 'lineMetres'>;

/** The stretch before the line whose grade is the finish's, metres: **500** (#2794). */
const FINISH_STRETCH_METRES = 500;

/**
 * The course ahead of `leader` (#2794): its next climb and descent before the
 * line, what is left of its lap and the climbing in it, and the grade of the
 * last {@link FINISH_STRETCH_METRES} to the line. Read on the road the bots
 * ride, `bot.ride.distance` from the race's line on the route (#2800), as their
 * grade ahead is, so the summary is the road they will feel; the lap and the
 * line are on effort distance, as every other distance the model is shown.
 */
function lapRaceCourseAhead(
  race: ItemRaceState,
  leader: LapRaceBot,
  effortDistance: number,
  road: BotRoad,
): ModelTacticsCourse {
  const { profile } = road;
  const { laps, lapLengthMetres } = race.course;
  const from = (leader.ride.distance as number) + (road.lineMetres ?? 0);
  const toLine = Math.max(0, laps * lapLengthMetres - effortDistance);
  const intoLap = effortDistance - Math.floor(effortDistance / lapLengthMetres) * lapLengthMetres;
  const lapLeft = Math.min(toLine, lapLengthMetres - intoLap);
  const finish = Math.min(FINISH_STRETCH_METRES, lapLengthMetres);
  return {
    ...courseHillsAhead(profile, from, toLine),
    lapLeftM: Math.round(lapLeft / COURSE_ROUNDING_METRES) * COURSE_ROUNDING_METRES,
    lapClimbM: courseClimbing(profile, from, lapLeft),
    finishPct: courseAverageGrade(profile, from + toLine - finish, from + toLine),
  };
}

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

/**
 * What the race notes of each bot as it goes (#2836), written in place as
 * the rider's trace is, so a tick allocates nothing for it but a change of
 * move. Every list but {@link rode} is by seat.
 */
export interface LapRaceMoveTrace {
  /** The race time it was last in a move of its own (`BOT_HARD_TACTICS`), ms; unset with none. */
  readonly lastMoveMs: number[];
  /** The move it was riding after the last tick; unset before its first (sitting in). */
  readonly riding: BotTactic[];
  /** Who chose in the tactics window it is in; unset before its first (its seeded tactics). */
  readonly chosenBy: ModelMoveChooser[];
  /** Every change of move, in race order: `LapRaceModelRecord.rode`. */
  readonly rode: LapRaceModelRode[];
}

/** A model call out now: when it was asked, about which bot, and the race it belongs to. */
export interface LapRaceModelAsk {
  readonly askedAtMs: number;
  /** The race's own trace: what tells an answer for this race from one for a race since ended. */
  readonly race: LapRaceRiderTrace;
  /** The seat asked about, and its place in the race then. */
  readonly bot: number;
  readonly rank: number;
  /** The cue words it was sent with. */
  readonly cues: readonly ModelTacticsCue[];
  /** The menu it was offered, which an answer must pick from. */
  readonly menu: readonly ModelTacticsMenuEntry[];
}

/** The AI side of a lap race. */
export interface LapRaceModel {
  readonly version: number;
  readonly log: readonly ModelTacticsLogEntry[];
  /** The call out now, or `undefined`. */
  readonly asked: LapRaceModelAsk | undefined;
  /** Race time of the next ask, ms. */
  readonly nextAskAtMs: number;
  /** The seat last asked about, or -1 before the first ask: the next ask starts at the seat after it. */
  readonly lastSeat: number;
  /** The last race time any bot was attacking or on a flyer, ms, or nought. */
  readonly quietSinceMs: number;
  /** The race time an ask first found the break that is away now, ms, or `null` with nobody away. */
  readonly awaySinceMs: number | null;
  readonly rider: LapRaceRiderTrace;
  /** What the race notes of each bot's moves. */
  readonly moves: LapRaceMoveTrace;
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
    nextAskAtMs: MODEL_TACTICS_FIRST_ASK_MS,
    lastSeat: -1,
    quietSinceMs: 0,
    awaySinceMs: null,
    rider: { effortDistances: [], wattsPerKilogram: [], lanes: [], uses: [] },
    moves: { lastMoveMs: [], riding: [], chosenBy: [], rode: [] },
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

/** A gap that cannot be below nought, in whole metres (#2759, ADR 0076 D-11). */
const wholeMetres = (metres: number): number => round(Math.max(0, metres), 0);

/** The race read off in full, and what an ask needs of it that the read does not hold. */
interface RaceRead {
  readonly view: ModelTacticsRace;
  /** Every racer still racing, the rider included: effort distances, the leader first. */
  readonly distances: readonly number[];
  /** By seat: metres the bot is behind the leading bot, on effort distance. */
  readonly behindLeader: ReadonlyMap<number, number>;
}

/**
 * The race at `race.atMs` read off in full (D-3.4), or `undefined` when no
 * bot is still racing. See the file comment. Since #2836 this is what an ask
 * for one bot is made from (`@onyourleft/domain` §`modelTacticsAsk`), not
 * what is sent.
 *
 * @param road - the road the bots ride (`ride-race.ts` §`LapRaceRide.conditions`):
 * the route, and the line their odometers read nought at (#2800), so the grade
 * ahead and the course ahead the model is shown are the road each bot reads,
 * where it is drawn.
 * @param seed - the race's own seed: each bot's misread of the line.
 * @param riderWattsPerKilogram - the rider's power as the bots read it, or `null`.
 */
export function modelTacticsRaceOf(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  road: BotRoad,
  seed: number,
  draft: boolean,
  riderWattsPerKilogram: number | null,
  quietSinceMs: number,
): ModelTacticsRace | undefined {
  return readRace(race, bots, road, seed, draft, riderWattsPerKilogram, quietSinceMs)?.view;
}

function readRace(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  road: BotRoad,
  seed: number,
  draft: boolean,
  riderWattsPerKilogram: number | null,
  quietSinceMs: number,
): RaceRead | undefined {
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
  // #2759, ADR 0076 D-4: how each bot compares with the whole field, every
  // bot that has its capacity, racing or finished, so the words hold all race.
  const planned = bots.flatMap((bot) => (bot.plan === undefined ? [] : [bot]));
  const strengths = new Map(
    modelFieldStrengths(planned.map((bot) => (bot.plan as BotRacePlan).capacity)).map(
      (words, at) => [(planned[at] as LapRaceBot).id, words],
    ),
  );
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
        : riderWattsPerKilogram * lapRaceBotMassKilograms(bot) >
            bot.plan.capacity.cpWatts * (1 + BOT_TACTIC_MOVE_SHARE)
          ? 'attack'
          : 'sit-in';
    const misread = botTacticsMisjudgement(seed, seat, bot.strategy.skill, race.atMs).lineMetres;
    views.push({
      bot: seat,
      // #2759, ADR 0076 D-3: the style its pace was dealt for, so style, legs
      // and body never drift apart.
      style: modelRacingStyleOf(bot.pace.style),
      ...(strengths.get(bot.id) as ModelBotStrengths),
      rank: at + 1,
      ahead: ahead === undefined ? null : (aheadSeat ?? 'rider'),
      aheadMove:
        ahead === undefined
          ? null
          : aheadSeat === undefined
            ? riderMove
            : (bots[aheadSeat] as LapRaceBot).tactics.tactic,
      gapAheadM:
        ahead === undefined ? null : wholeMetres(ahead.effortDistance - own.effortDistance),
      gapBehindM:
        behind === undefined ? null : wholeMetres(own.effortDistance - behind.effortDistance),
      wbal: round(
        Math.min(1, Math.max(0, bot.energy.wbalJoules / bot.plan.capacity.wPrimeJoules)),
        1,
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
        0,
      ),
      riderGapM: rider === undefined ? 0 : round(rider.effortDistance - own.effortDistance, 0),
    });
  });
  if (views.length === 0) return undefined;
  // #2794: the course ahead once for the race, from the bot at its head.
  const head = views.reduce((best, view) => (view.rank < best.rank ? view : best));
  const riderAt = rider === undefined ? undefined : rank.get(rider.id);
  const riderAhead = riderAt === undefined ? undefined : racing[riderAt - 1];
  const riderBehind = riderAt === undefined ? undefined : racing[riderAt + 1];
  const riderDistance = rider?.effortDistance ?? 0;
  const leaderDistance = (racing[head.rank - 1] as (typeof racing)[number]).effortDistance;
  const view: ModelTacticsRace = {
    laps,
    quietS: Math.max(0, Math.floor((race.atMs - quietSinceMs) / 1_000)),
    rider: {
      rank: riderAt === undefined ? 0 : riderAt + 1,
      wPerKg: riderWattsPerKilogram === null ? null : round(riderWattsPerKilogram, 1),
      ahead: riderAhead === undefined ? null : (seats.get(riderAhead.id) ?? null),
      gapAheadM:
        riderAhead === undefined ? null : wholeMetres(riderAhead.effortDistance - riderDistance),
      gapBehindM:
        riderBehind === undefined ? null : wholeMetres(riderDistance - riderBehind.effortDistance),
      drafting: rider !== undefined && riderAt !== undefined && (factors?.[rider.id] ?? 1) < 1,
    },
    bots: views,
    course: lapRaceCourseAhead(race, bots[head.bot] as LapRaceBot, leaderDistance, road),
  };
  return {
    view,
    distances: racing.map((racer) => racer.effortDistance),
    behindLeader: new Map(
      views.map((each) => [
        each.bot,
        leaderDistance - (racing[each.rank - 1] as (typeof racing)[number]).effortDistance,
      ]),
    ),
  };
}

/** What {@link lapRaceAskFor} found to ask: the ask, the seat it is about, and the break as it stands. */
interface FoundAsk {
  readonly input: ModelTacticsInput | undefined;
  readonly seat: number;
  readonly awaySinceMs: number | null;
}

/**
 * The ask for the next bot round the field after `model.lastSeat` that has
 * something to choose (#2836, ADR 0081 D-2.1), or no `input` when no bot has:
 * every one blown, inside its launch, or offered only sitting in.
 */
function lapRaceAskFor(model: LapRaceModel, read: RaceRead, atMs: number, seats: number): FoundAsk {
  const { view } = read;
  const split = modelTacticsBreak(read.distances);
  const awaySinceMs = split === null ? null : (model.awaySinceMs ?? atMs);
  const away =
    split === null || awaySinceMs === null
      ? null
      : { ...split, s: Math.max(0, Math.floor((atMs - awaySinceMs) / 1_000)) };
  const climb = view.course?.climb ?? null;
  for (let step = 1; step <= seats; step += 1) {
    const seat = (model.lastSeat + step) % seats;
    const lastMoveMs = model.moves.lastMoveMs[seat];
    const input = modelTacticsAsk(view, seat, {
      sinceMoveS:
        lastMoveMs === undefined ? null : Math.max(0, Math.floor((atMs - lastMoveMs) / 1_000)),
      raceS: Math.floor(atMs / 1_000),
      away,
      moved: model.quietSinceMs > 0,
      // #2794's climb is the leading bot's: a bot behind it is its gap further from it.
      climbInM:
        climb === null
          ? null
          : Math.round((climb.inM + (read.behindLeader.get(seat) ?? 0)) / COURSE_ROUNDING_METRES) *
            COURSE_ROUNDING_METRES,
    });
    if (input !== undefined) return { input, seat, awaySinceMs };
  }
  return { input: undefined, seat: model.lastSeat, awaySinceMs };
}

/**
 * The bots before the tick at `race.atMs`, with the moves in force applied to
 * each whose tactics window opens on it (`@onyourleft/domain`
 * §`applyModelMoves`). The log is read only on a tick that opens a window,
 * and on that tick who chose for each bot is noted in `model.moves`, in
 * place, for {@link noteLapRaceModelTick} to keep with a change of move.
 */
export function applyLapRaceModel(
  model: LapRaceModel,
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  seed: number,
): readonly LapRaceBot[] {
  const window = Math.floor(race.atMs / BOT_TACTICS_WINDOW_MS);
  if (bots.every((bot) => bot.plan === undefined || bot.tactics.window === window)) return bots;
  const applied = applyModelMoves(race, bots, modelMovesInForce(model.log, race.atMs), seed);
  applied.seats.forEach((seat, at) => {
    model.moves.chosenBy[seat] = modelMoveChooser(
      applied.outcomes[at] as (typeof applied.outcomes)[number],
    );
  });
  return applied.bots;
}

/** One tick of the rider's own input, as the race handed it to the bots. */
export interface LapRaceRiderTick {
  readonly effortDistance: number;
  readonly wattsPerKilogram: number | null;
  readonly lane: number;
  readonly used: boolean;
}

/**
 * The AI side after a tick: the rider's input appended to the trace, the lull
 * moved on while any bot is attacking or on a flyer, and (#2836) each bot's
 * last move of its own and any change of move noted, with who chose it.
 * Nothing once every bot has finished. O(racers).
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
  const moves = model.moves;
  let moving = false;
  for (let seat = 0; seat < bots.length; seat += 1) {
    const tactic = (bots[seat] as LapRaceBot).tactics.tactic;
    if (tactic === 'attack' || tactic === 'flyer') moving = true;
    if (BOT_HARD_TACTICS.includes(tactic)) moves.lastMoveMs[seat] = race.atMs;
    // On the line every bot sits in (`TACTIC_MEMORY_AT_START`).
    if ((moves.riding[seat] ?? 'sit-in') === tactic) continue;
    moves.riding[seat] = tactic;
    if (moves.rode.length < LAP_RACE_MODEL_MOST_MOVES) {
      moves.rode.push({
        atMs: race.atMs,
        bot: seat,
        move: tactic,
        by: moves.chosenBy[seat] ?? 'seeded',
      });
    }
  }
  return moving ? { ...model, quietSinceMs: race.atMs } : model;
}

/** What a call was about, as its log entry keeps it (#2836): the bot, its place, its cues and its menu. */
function about(ask: LapRaceModelAsk): Pick<ModelTacticsLogEntry, 'bot' | 'rank' | 'cues' | 'menu'> {
  return { bot: ask.bot, rank: ask.rank, cues: ask.cues, menu: ask.menu };
}

/** `model` with `entry` logged and the call it settles let go. */
function settled(model: LapRaceModel, entry: ModelTacticsLogEntry): LapRaceModel {
  return {
    ...model,
    log: [...model.log, entry],
    asked: undefined,
    nextAskAtMs: modelTacticsNextAskAtMs(entry.askedAtMs, entry.arrivedAtMs),
  };
}

/** What {@link askLapRaceModel} sends, and the model as it stands once it has. */
export interface LapRaceModelAsking {
  readonly model: LapRaceModel;
  /** One bot's ask to send, and the call it answers, or `undefined` with nothing to send now. */
  readonly send: { readonly input: ModelTacticsInput; readonly ask: LapRaceModelAsk } | undefined;
}

/**
 * Between frames: give up a call out longer than `MODEL_TACTICS_LATE_MS`, and
 * ask about the next bot round the field when an ask is due and none is out
 * (#2836). With no bot that has anything to choose, nothing is sent and the
 * race looks again `MODEL_TACTICS_ASK_EVERY_MS` on. Nothing once the instance
 * said AI bots are not available for this race.
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
      ...about(out),
    });
  }
  if (next.unavailable !== undefined || next.asked !== undefined || race.atMs < next.nextAskAtMs) {
    return { model: next, send: undefined };
  }
  const read = readRace(race, bots, road, seed, draft, riderWattsPerKilogram, next.quietSinceMs);
  if (read === undefined) return { model: next, send: undefined };
  const found = lapRaceAskFor(next, read, race.atMs, bots.length);
  next = { ...next, awaySinceMs: found.awaySinceMs };
  const input = found.input;
  if (input === undefined) {
    // Nobody has anything to choose: no call, and a look again a second on.
    return {
      model: { ...next, nextAskAtMs: race.atMs + MODEL_TACTICS_ASK_EVERY_MS },
      send: undefined,
    };
  }
  const ask: LapRaceModelAsk = {
    askedAtMs: race.atMs,
    race: next.rider,
    bot: found.seat,
    rank: input.you.rank,
    cues: input.you.cues,
    menu: input.you.menu,
  };
  next = { ...next, lastSeat: found.seat };
  // The instance's own reader, before anything leaves (D-3.4): an ask it
  // would refuse is never sent, and the bot rides its seeded tactics.
  if (!readModelTacticsInput(input).ok) {
    return {
      model: settled(next, {
        askedAtMs: race.atMs,
        arrivedAtMs: race.atMs,
        outcome: 'failed',
        reason: 'validation_failed',
        ...about(ask),
      }),
      send: undefined,
    };
  }
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
  const times = { askedAtMs: ask.askedAtMs, arrivedAtMs: race.atMs, ...about(ask) };
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
      // Against the menu this ask offered: a move off it is no decision.
      const read = readModelTacticsAnswer(text, ask.menu);
      return read.ok
        ? settled(model, {
            ...times,
            outcome: 'decision',
            moves: [modelTacticsMoveOf(ask.bot, read.pick, ask.menu)],
            why: read.pick.reason,
          })
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

/**
 * The record of a model race, to keep with the ride: copies, so nothing the
 * race appends later changes it. With (#2836) who each of `bots` is and every
 * change of move, for somebody reading the race afterwards.
 */
export function lapRaceModelFact(
  model: LapRaceModel,
  seed: number,
  bots: readonly LapRaceBot[],
): LapRaceModelRecord {
  return {
    version: model.version,
    seed,
    log: [...model.log],
    bots: bots.map((bot) => ({
      style: modelRacingStyleOf(bot.pace.style),
      personality: bot.strategy.personality,
      skill: bot.strategy.skill,
    })),
    rode: [...model.moves.rode],
    rider: {
      effortDistances: [...model.rider.effortDistances],
      wattsPerKilogram: [...model.rider.wattsPerKilogram],
      lanes: [...model.rider.lanes],
      uses: [...model.rider.uses],
    },
  };
}
