// SPDX-License-Identifier: Apache-2.0

/**
 * **A lap race whose bots' moves a language model picks: the decision log,
 * when a logged decision is in force, and how a move is ridden** — #2710,
 * ADR 0071 D-4 and D-7, ADR 0073 D-2 to D-4, which supersedes ADR 0071 D-3.6
 * for a model race, ADR 0074, which puts a sprint backstop behind it, and
 * ADR 0081 (#2836), under which the model is asked about one bot at a time
 * and its `sit-in` is no opinion.
 *
 * Written fresh for #2710 (ADR 0071 D-8.7): the spike's AGPL copies under
 * `apps/web/tools/model-tactics-spike/` are not moved.
 *
 * ## The race is the seed, the log and the bot-code version (D-4)
 *
 * Every model call is one {@link ModelTacticsLogEntry}: the race time it was
 * asked at, the race time its answer **arrived** at, and the answer as checked
 * or the closed reason it was not applied. Since bot-code version 7 a call is
 * about ONE bot (ADR 0081 D-2), and a decision holds for the bot it names: it
 * applies from the first tactics window (`archetype.ts`
 * §`BOT_TACTICS_WINDOW_MS`) that starts after it arrived
 * ({@link modelTacticsAppliedAtMs}) and lapses {@link MODEL_TACTICS_HOLD_MS}
 * later unless the next decision for that bot replaces it
 * ({@link modelMovesInForce}). Race time only, never a wall clock, so a race
 * replays from the seed, the log, {@link LAP_RACE_BOT_CODE_VERSION} and the
 * rider's own input, to the bit. A seeded race is a model race with an empty
 * log.
 *
 * ## What explains a race afterwards (#2836, ADR 0081 D-5)
 *
 * The owner's race of 2026-11-18 could not be explained from its record
 * without recomputing the field. So, beside what a replay reads, an entry
 * keeps the bot asked about, its place, the cue words and the menu it was
 * offered, and the model's reason word; and the record keeps each bot's
 * racing style, personality and skill ({@link LapRaceModelRecord.bots}) and
 * every change of move with who chose it ({@link LapRaceModelRecord.rode}):
 * the model, the seeded tactics, or the sprint instinct. Numbers and closed
 * words only. **No replay reads any of it.**
 *
 * ## How a move is ridden: through the tactics' own memory
 *
 * `tactics.ts` §`decideTactic` chooses a state at the first call in each
 * window and holds it for the rest. So {@link applyModelMoves}, before the tick
 * that opens a window, hands a bot the memory `decideTactic` would have written
 * had it chosen the model's move itself. The tick then rides it exactly as it
 * rides a seeded choice: the target from the race, the wheel held, `wbal.ts`
 * §`spendableWatts` capping it at the bot's peak, and at CP once it is
 * exhausted, and the plan limiting it to what the W′ balance pays for. **No
 * answer names a power, and nothing here changes a capacity** (D-3.1, D-8.3).
 *
 * ## The body's limits, and the strategy seam (the owner's ruling of 2026-11-16)
 *
 * Two kinds of rule decide whether a bot rides the model's move:
 *
 * - **The body's**, which nothing loosens: an exhausted bot keeps its seeded
 *   choice (it cannot surge), and its power is `spendableWatts`' whatever the
 *   move. These are checked here, outside the seam.
 * - **Strategy rules**, behind ONE seam, {@link ModelMoveStrategy}.
 *   {@link ADR_0081_MOVE_STRATEGY} is what a model race rides since bot-code
 *   version 7: ADR 0074's, under which **a `sit-in` from the model is no
 *   opinion**, so the bot's seeded tactics decide (and already send a climber
 *   up a climb, `tactics.ts` §`BOT_TACTIC_CLIMB_GRADE_PERCENT`); the model
 *   overrides them only with a move. {@link ADR_0074_MOVE_STRATEGY} (versions
 *   3 to 6) is ADR 0073's freedom with a sprint-instinct backstop, so
 *   a bot the model has not sent on its kick by its launch distance launches
 *   its own, and every race gets a finish. {@link ADR_0073_MOVE_STRATEGY}
 *   (version 2) refuses nothing, and only carries a `follow` or `chase` of a
 *   racer who is not directly ahead through the moves a bot has (D-3.4).
 *   {@link ADR_0071_MOVE_STRATEGY} is ADR 0071 D-3.6's rules, which version 1
 *   rode. The three are kept behind the seam as the rules a superseding ADR
 *   would hand back, and no race uses any of them.
 *
 * ## The line as the bot misreads it (#2705, ADR 0073 D-3.5)
 *
 * Seeded `decideTactic` launches its kick when the line **as the bot misreads
 * it** (`archetype.ts` §`botTacticsMisjudgement`'s `lineMetres`) is inside its
 * launch distance. {@link ModelMoveAsk.readToLineMetres} is the same misread
 * distance, and the model is shown it too (`toLineM`), so a launch the model
 * times is timed on what the bot believes is left.
 */

import {
  botTacticsMisjudgement,
  BOT_TACTICS_MISJUDGE_LINE_METRES,
  BOT_TACTICS_WINDOW_MS,
  type BotArchetype,
} from './archetype';
import type { ItemRaceState } from './items';
import {
  BOT_EFFORTS,
  BOT_TACTICS,
  BOT_TACTIC_ATTACK_MS,
  BOT_TACTIC_FLYER_LAPS,
  BOT_TACTIC_FLYER_WBAL_SHARE,
  BOT_TACTIC_WBAL_FLOOR,
  botLaunchMetres,
  type BotEffort,
  type BotTactic,
  type TacticMemory,
} from './tactics';
import type { BotRacePlan } from './plan';
import type { BotEnergy } from './wbal';
import {
  MODEL_RACING_STYLES,
  MODEL_TACTICS_CUES,
  MODEL_TACTICS_MENU_MOST,
  MODEL_TACTICS_MOST_SEATS,
  MODEL_TACTICS_REASONS,
  type ModelRacingStyle,
  type ModelTacticsCue,
  type ModelTacticsInvalid,
  type ModelTacticsMenuEntry,
  type ModelTacticsMove,
  type ModelTacticsReason,
  type ModelTacticsTarget,
} from './model-tactics';
import { BOT_PERSONALITIES, BOT_SKILLS, type BotPersonality, type BotSkill } from './strategy';

/**
 * **The bot-code version: 7** (ADR 0071 D-4.3, ADR 0073 D-6, ADR 0074, ADR 0076, ADR 0081).
 * Version 1 rode ADR 0071 D-3.6's strategy rules; version 2 ADR 0073's, with
 * D-5's input; version 3 ADR 0073's with ADR 0074's sprint backstop; version 4
 * a field with bodies that fit their styles and a spread of strength, and an
 * effort that never softens an attack (#2759, ADR 0076); version 5 version 4's
 * race with a decision held {@link MODEL_TACTICS_HOLD_MS} of 10 s, not 5 s
 * (#2759, ADR 0076 D-11), which changes the moves in force for a logged race;
 * version 6 version 5's on the road from the race's line rather than from the
 * route's start (#2800), which moves every bot on a race started off the
 * route's 0 over a hill and none started at it; version 7 (#2836, ADR 0081) a
 * decision for one bot at a time, held for that bot alone, and a `sit-in` from
 * the model left to the bot's seeded tactics. Raised by any change that
 * alters any bot's output for some seed and log — a tactic, a plan, the W′
 * model, the adapter, a seam's rule, a physics step. Stored beside the seed and
 * the log; a log recorded under another version is not replayed.
 * `apps/web` §`model-race-replay.test.ts` holds committed seeds and logs to
 * their outcomes, keyed by this number.
 */
export const LAP_RACE_BOT_CODE_VERSION = 7;

/**
 * The least time between two asks, ms of race time: **1 s** (#2836, ADR 0081
 * D-2.1; 4 s for the whole field until bot-code version 7). One bot is asked
 * about at a time, round the field, so with seven bots each is asked about
 * every seven seconds or so. Only one call is ever out, so a call slower than
 * this sets the pace itself ({@link modelTacticsNextAskAtMs}).
 */
export const MODEL_TACTICS_ASK_EVERY_MS = 1_000;

/**
 * The race time of the first ask, ms: **4 s** after Go, as it was (ADR 0071
 * D-7): the start is the bots' own.
 */
export const MODEL_TACTICS_FIRST_ASK_MS = 4_000;

/**
 * An answer that arrives more than this after it was asked is **late**, ms of
 * race time: **8 s** (#2759, ADR 0076 D-11; ADR 0071 D-7 leaves the figure to
 * the build). It is logged and never applied: it describes a race that has
 * moved on. A call still out this long is given up as late too, so a call that
 * never settles cannot stop the next, and the race never waits on it.
 *
 * Spike 0039's 5 s was server time on the owner's PC. On the owner's tablet,
 * 2026-11-17, the round trip through the instance's tunnel added more than a
 * second to a median 3.9 s of server time, and 41 of 46 asks were given up at
 * 5 s: the race rode seeded tactics. 8 s holds the measured device round trip
 * with room, and an answer up to 8 s old still describes a race whose moves
 * last 10 s and more.
 */
export const MODEL_TACTICS_LATE_MS = 8_000;

/**
 * How long an applied decision holds for the bot it names, ms, unless that
 * bot's next replaces it first: **10 s** (#2759, ADR 0076 D-11; spike 0039
 * drafted 5 s against a 5 s late limit). Until bot-code version 7 it was set
 * against one call for the whole field every 8 s or so. Since #2836 (ADR 0081
 * D-2.5) a bot is asked about once a round of the field: seven bots at a call
 * a second is 7 s, so 10 s holds a move until the bot's next answer with 3 s
 * to spare, and a round slower than that lets the bot fall back to its seeded
 * tactics rather than ride a stale move on. ⚠️ Unchanged, and to be set
 * against the round measured on the owner's tablet (ADR 0081 R-3).
 */
export const MODEL_TACTICS_HOLD_MS = 10_000;

/** What one model call came to (D-4.2). */
export type ModelTacticsLogOutcome = 'decision' | 'late' | 'invalid' | 'refused' | 'failed';

/** Every outcome, for a reader. */
export const MODEL_TACTICS_LOG_OUTCOMES: readonly ModelTacticsLogOutcome[] = [
  'decision',
  'late',
  'invalid',
  'refused',
  'failed',
];

/**
 * Why a call applied nothing, from a closed list: an answer's invalid reason
 * (`model-tactics.ts` §`ModelTacticsInvalid`), an instance's refusal code, or
 * the device's own. Never the model's text, never a value.
 */
export type ModelTacticsLogReason =
  | ModelTacticsInvalid
  | 'local_unavailable'
  | 'tactics_consent_required'
  | 'tactics_busy'
  | 'rate_limited'
  | 'tactics_invalid'
  | 'tactics_failed'
  | 'validation_failed'
  | 'unauthenticated'
  | 'unavailable'
  /** The instance could not be reached, or its answer could not be read. */
  | 'unreachable'
  /** No answer within {@link MODEL_TACTICS_LATE_MS}: given up. */
  | 'no-answer'
  /** A refusal this build has no word for. */
  | 'refused';

/** Every reason, for a reader. */
export const MODEL_TACTICS_LOG_REASONS: readonly ModelTacticsLogReason[] = [
  'too-long',
  'not-json',
  'not-an-object',
  'unknown-key',
  'not-a-list',
  'bad-bot',
  'duplicate-bot',
  'bad-move',
  'bad-target',
  'bad-effort',
  'bad-reason',
  'off-menu',
  'local_unavailable',
  'tactics_consent_required',
  'tactics_busy',
  'rate_limited',
  'tactics_invalid',
  'tactics_failed',
  'validation_failed',
  'unauthenticated',
  'unavailable',
  'unreachable',
  'no-answer',
  'refused',
];

/** One model call, as the log keeps it (D-4.2): times, and the answer as checked. No model text. */
export interface ModelTacticsLogEntry {
  /** Race time it was asked at, ms. */
  readonly askedAtMs: number;
  /** Race time its answer arrived at (or it was given up at), ms. */
  readonly arrivedAtMs: number;
  readonly outcome: ModelTacticsLogOutcome;
  /**
   * The moves, for a `decision` only. Since bot-code version 7 one move, the
   * bot's the call was about; until then one for each bot the model named.
   */
  readonly moves?: readonly ModelTacticsMove[];
  /** Why it applied nothing, for every other outcome. */
  readonly reason?: ModelTacticsLogReason;
  /**
   * What the call was about, since bot-code version 7 (#2836, ADR 0081 D-5):
   * the seat asked about, its place in the race then, the cue words and the
   * menu the device offered it. Kept so a race can be explained afterwards;
   * no replay reads them.
   */
  readonly bot?: number;
  readonly rank?: number;
  readonly cues?: readonly ModelTacticsCue[];
  readonly menu?: readonly ModelTacticsMenuEntry[];
  /** The model's reason word, for a `decision` only (ADR 0081 D-3). Never its text. */
  readonly why?: ModelTacticsReason;
}

/** The race time a decision that arrived at `arrivedAtMs` applies from: the next window's start. */
export function modelTacticsAppliedAtMs(arrivedAtMs: number): number {
  return (Math.floor(arrivedAtMs / BOT_TACTICS_WINDOW_MS) + 1) * BOT_TACTICS_WINDOW_MS;
}

/**
 * The race time of the next ask after a call asked at `askedAtMs` settled at
 * `settledAtMs`: as soon as it settled, and no sooner than
 * {@link MODEL_TACTICS_ASK_EVERY_MS} after it was asked. So a model that
 * answers inside a second is asked once a second, and a slower one as fast as
 * it answers, with one call out at a time.
 */
export function modelTacticsNextAskAtMs(askedAtMs: number, settledAtMs: number): number {
  return Math.max(settledAtMs, askedAtMs + MODEL_TACTICS_ASK_EVERY_MS);
}

/**
 * The moves in force at race time `atMs`, one a bot at most, or `undefined`
 * with none: **for each bot, the move of the latest `decision` naming it**
 * that applied at or before `atMs`, for {@link MODEL_TACTICS_HOLD_MS} (ADR
 * 0081 D-2.5). A decision for one bot leaves every other bot's in force. Any
 * other outcome applies nothing. Reads the log and nothing else, so a replay
 * from the log finds the same moves at the same instant.
 */
export function modelMovesInForce(
  log: readonly ModelTacticsLogEntry[],
  atMs: number,
): readonly ModelTacticsMove[] | undefined {
  const latest = new Map<number, { readonly move: ModelTacticsMove; readonly from: number }>();
  for (const entry of log) {
    if (entry.outcome !== 'decision' || entry.moves === undefined) continue;
    const from = modelTacticsAppliedAtMs(entry.arrivedAtMs);
    if (from > atMs) continue;
    for (const move of entry.moves) {
      const had = latest.get(move.bot);
      if (had === undefined || from >= had.from) latest.set(move.bot, { move, from });
    }
  }
  const inForce: ModelTacticsMove[] = [];
  for (const { move, from } of latest.values()) {
    if (atMs < from + MODEL_TACTICS_HOLD_MS) inForce.push(move);
  }
  return inForce.length === 0 ? undefined : inForce;
}

// ---------------------------------------------------------------------------
// The strategy seam.
// ---------------------------------------------------------------------------

/** What a strategy rule is shown of one bot's asked move, at the tick that opens its window. */
export interface ModelMoveAsk {
  readonly move: BotTactic;
  readonly target: ModelTacticsTarget | undefined;
  /** Race time, ms. */
  readonly atMs: number;
  readonly archetype: BotArchetype;
  /**
   * Metres to the line **as the bot reads it**: the true distance plus its
   * seeded misread this window, the reading seeded `decideTactic` launches on
   * (#2705). What a naive bot misjudges is part of who it is.
   */
  readonly readToLineMetres: number;
  /** Metres to the line as it truly is: what ADR 0074's hold of a kick in progress reads. */
  readonly toLineMetres: number;
  /** Laps left, the one it is on counted whole. */
  readonly lapsLeft: number;
  /** Its actual W′ balance as a share of its W′, 0 to 1. */
  readonly wbalShare: number;
  /** What its tactics remember: the move it is in and since when. */
  readonly tactics: TacticMemory;
  /** Who is directly ahead: `"rider"`, a seat, or `null` when it leads. */
  readonly ahead: ModelTacticsTarget | null;
  /**
   * Where {@link target} is on the road from this bot: the racer directly
   * `ahead`, further `up-the-road`, or `behind`; `undefined` with no target, a
   * target that is the bot itself, or one no longer racing.
   */
  readonly targetAt: 'ahead' | 'up-the-road' | 'behind' | undefined;
}

/**
 * A move ridden as another the bot has (ADR 0073 D-3.4): `bridging`, a
 * `follow` or `chase` of a racer up the road ridden as a `chase` to them;
 * `marking`, of a racer behind, ridden as `sit-in` until they come by;
 * `backstop`, any move but a kick ridden as the bot's own `kick` (ADR 0074),
 * at the kick's own target and never at the model's effort.
 */
export interface ModelMoveRide {
  readonly outcome: 'bridging' | 'marking' | 'backstop';
  readonly ride: BotTactic;
}

/**
 * Why a strategy rule kept a bot on its seeded choice. `no-opinion` is ADR
 * 0081's: the model said `sit-in`, which names no move to ride.
 */
export type ModelMoveStrategyRefusal =
  | 'launch'
  | 'wbal-floor'
  | 'kick-closed'
  | 'flyer-closed'
  | 'attack-over'
  | 'target-not-ahead'
  | 'no-opinion';

/**
 * **The one strategy seam** (the owner's ruling of 2026-11-16 on #2710): every
 * rule that decides whether a bot may ride a move it is *able* to ride, and
 * as what. Given an ask, the refusal, the move it is ridden as, or `undefined`
 * to ride the move as named. The body's limits are not in it, and cannot be
 * loosened through it.
 */
export type ModelMoveStrategy = (
  ask: ModelMoveAsk,
) => ModelMoveStrategyRefusal | ModelMoveRide | undefined;

/**
 * **ADR 0073's strategy: the model's** (ADR 0073 D-3, accepted 2026-11-16 by
 * the owner: *"I approve 1-5 , 6 ai can choose"*). What a model race rides.
 * Every strategy rule of ADR 0071 D-3.6 is lifted, so nothing is refused:
 *
 * - an `attack` or `chase` under the W′ floor is ridden: a gamble, and the bot
 *   may blow up (D-3.1);
 * - a `flyer` is ridden on any lap and at any W′ (D-3.2);
 * - an `attack` is ridden for as long as the model keeps naming it (D-3.3);
 * - a `kick` is ridden wherever the model names it, and inside the launch a
 *   move other than the kick is ridden too, so the model may launch long or
 *   late and may end a kick, seeded or its own (D-3.5). **The kick-in-progress
 *   hold of version 1 is dropped**: D-3.5 makes ending a kick the model's
 *   choice, and D-4 hands a lapsed kick back to the seeded tactics, which hold
 *   it to the line;
 * - a `follow` or `chase` may name any racer (D-3.4): the one directly ahead,
 *   or none, is the move as named; one further up the road is ridden as a
 *   `chase` (bridging), and one behind as `sit-in` (marking).
 */
export const ADR_0073_MOVE_STRATEGY: ModelMoveStrategy = (ask) => {
  if (ask.move !== 'follow' && ask.move !== 'chase') return undefined;
  if (ask.targetAt === 'up-the-road') return { outcome: 'bridging', ride: 'chase' };
  if (ask.targetAt === 'behind') return { outcome: 'marking', ride: 'sit-in' };
  return undefined;
};

/**
 * **ADR 0074's strategy: ADR 0073's, with a sprint instinct behind it**
 * (accepted 2026-11-16 by the owner on #2724). What a model race rides since
 * bot-code version 3. A `kick` is ridden wherever the model names it, as under
 * ADR 0073. Otherwise:
 *
 * - **inside its launch distance, as it reads the line** (the misread line
 *   seeded `decideTactic` launches on), a bot the model has not sent on its
 *   kick rides its own kick, the one seeded `decideTactic` launches there:
 *   `backstop`;
 * - **a kick in progress holds to the line** once the bot is within its launch
 *   distance and the largest misread
 *   (`archetype.ts` §`BOT_TACTICS_MISJUDGE_LINE_METRES`) of the true line, so a
 *   misread redrawn a window later cannot end it, nor the model: `backstop`.
 *   *The author's choice*, so that every race gets a finish; a kick the model
 *   launches further out is still the model's to end;
 * - everything else is {@link ADR_0073_MOVE_STRATEGY}'s.
 */
export const ADR_0074_MOVE_STRATEGY: ModelMoveStrategy = (ask) => {
  if (ask.move !== 'kick') {
    const launch = botLaunchMetres(ask.archetype);
    const inLaunch = ask.readToLineMetres <= launch;
    const holding =
      ask.tactics.tactic === 'kick' &&
      ask.toLineMetres <= launch + BOT_TACTICS_MISJUDGE_LINE_METRES;
    if (inLaunch || holding) return BACKSTOP;
  }
  return ADR_0073_MOVE_STRATEGY(ask);
};

const BACKSTOP: ModelMoveRide = Object.freeze({ outcome: 'backstop', ride: 'kick' });

/**
 * **ADR 0081's strategy: ADR 0074's, under which the model's `sit-in` is no
 * opinion** (#2836; the owner's ruling of 2026-11-18, *"yes fold these in"*).
 * What a model race rides since bot-code version 7.
 *
 * On the owner's race of 2026-11-18 the model answered `sit-in` for five of
 * seven bots in every answer, and {@link applyModelMoves} wrote each one over
 * the bot's seeded tactics: the climber was held on a wheel up the climb its
 * own tactics would have attacked on. So a `sit-in` from the model now
 * **writes nothing**: the bot keeps its seeded choice (`no-opinion`), and
 * `tactics.ts` §`decideTactic` decides for that window as it does in a
 * seeded race, on its own terrain and inside its own rules. The model
 * overrides the seeded tactics only with a move.
 *
 * - **A `sit-in` is `no-opinion` everywhere, the launch included.** So a bot
 *   with a model `sit-in` in force rides exactly what it rides with no
 *   decision in force, and a model that only ever says `sit-in` rides the
 *   seeded race to the bit. Inside its launch the seeded tactics launch the
 *   kick themselves, as they do in every seeded race: ADR 0074's instinct was
 *   needed there because the `sit-in` used to be written over it.
 * - **Every other move is {@link ADR_0074_MOVE_STRATEGY}'s**, so its sprint
 *   instinct still stands behind a move the model names: inside its launch,
 *   or holding a kick near the line, a bot sent on anything but its kick rides
 *   its own kick (`backstop`). And a `follow` or `chase` of a racer behind is
 *   still ridden as sitting in (`marking`), because there the model named a
 *   move and a racer.
 *
 * The body's limits are outside the seam, as ever, and a seeded choice is
 * capped by the same `wbal.ts` §`spendableWatts` as a model's.
 */
export const ADR_0081_MOVE_STRATEGY: ModelMoveStrategy = (ask) =>
  ask.move === 'sit-in' ? 'no-opinion' : ADR_0074_MOVE_STRATEGY(ask);

/**
 * ADR 0071 D-3.6's strategy rules, the ones bot-code version 1 rode. No race
 * uses them since version 2:
 *
 * - inside its launch distance, as it reads the line, or already in its kick,
 *   a bot sprints its own seeded way: the kick is never the model's to time
 *   or to end;
 * - an `attack` or `chase` under `BOT_TACTIC_WBAL_FLOOR` of its W′ is refused;
 * - a `kick` outside its launch is refused;
 * - a `flyer` before the last `BOT_TACTIC_FLYER_LAPS` laps, or under
 *   `BOT_TACTIC_FLYER_WBAL_SHARE`, is refused;
 * - an `attack` it has held `BOT_TACTIC_ATTACK_MS` already is over;
 * - a `follow` or `chase` that names a target other than the racer directly
 *   ahead is refused: those moves act on the wheel ahead.
 */
export const ADR_0071_MOVE_STRATEGY: ModelMoveStrategy = (ask) => {
  if (ask.readToLineMetres <= botLaunchMetres(ask.archetype)) return 'launch';
  // A bot already in its kick holds it: the line it misreads is redrawn every
  // window, so it can read itself outside its launch a window later, and the
  // kick is never the model's to end.
  if (ask.tactics.tactic === 'kick') return 'launch';
  switch (ask.move) {
    case 'kick':
      return 'kick-closed';
    case 'attack':
    case 'chase':
      if (ask.wbalShare < BOT_TACTIC_WBAL_FLOOR) return 'wbal-floor';
      break;
    case 'flyer':
      if (ask.lapsLeft > BOT_TACTIC_FLYER_LAPS || ask.wbalShare < BOT_TACTIC_FLYER_WBAL_SHARE) {
        return 'flyer-closed';
      }
      break;
    default:
      break;
  }
  if (
    ask.move === 'attack' &&
    ask.tactics.tactic === 'attack' &&
    ask.tactics.sinceMs !== null &&
    ask.atMs - ask.tactics.sinceMs >= BOT_TACTIC_ATTACK_MS
  ) {
    return 'attack-over';
  }
  if ((ask.move === 'follow' || ask.move === 'chase') && ask.target !== undefined) {
    if (ask.ahead === null || ask.target !== ask.ahead) return 'target-not-ahead';
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

/**
 * What {@link applyModelMoves} reads of a bot: `@onyourleft/physics`
 * §`LapRaceBot`'s fields of these names, so a bot is passed as it is.
 */
export interface ModelRaceBot {
  readonly id: string;
  readonly tactics: TacticMemory;
  readonly energy: BotEnergy;
  readonly plan: BotRacePlan | undefined;
  readonly strategy: { readonly skill: BotSkill };
}

/** What became of the model's say over one bot for one window. */
export type ModelMoveOutcome =
  | 'applied'
  | ModelMoveRide['outcome']
  | 'no-decision'
  | 'not-named'
  | 'exhausted'
  | ModelMoveStrategyRefusal;

/** The bots with the moves in force applied, and what became of each whose window opened. */
export interface AppliedModelMoves<B extends ModelRaceBot> {
  readonly bots: readonly B[];
  /** One per racing bot whose window opens on this tick, in seat order; none mid-window. */
  readonly outcomes: readonly ModelMoveOutcome[];
  /** The seat of each of {@link outcomes}, in the same order. */
  readonly seats: readonly number[];
}

const NONE: readonly ModelMoveOutcome[] = Object.freeze([]);
const NO_SEATS: readonly number[] = Object.freeze([]);

/**
 * Who chose a move a bot took up (#2836, ADR 0081 D-5): the `model`, when its
 * move was written for the bot (as named, bridging or marking); the bot's
 * sprint `instinct` (ADR 0074's backstop); or its `seeded` tactics, for every
 * other outcome, a model's `sit-in` included.
 */
export type ModelMoveChooser = 'model' | 'seeded' | 'instinct';

/** Every chooser, for a reader. */
export const MODEL_MOVE_CHOOSERS: readonly ModelMoveChooser[] = ['model', 'seeded', 'instinct'];

/** Who chose the move a bot rides in a window whose outcome was `outcome`. */
export function modelMoveChooser(outcome: ModelMoveOutcome): ModelMoveChooser {
  if (outcome === 'backstop') return 'instinct';
  return outcome === 'applied' || outcome === 'bridging' || outcome === 'marking'
    ? 'model'
    : 'seeded';
}

/** The seat or `"rider"` of the racer directly ahead of `id` in `order`, or `null`. */
function aheadOf(
  order: readonly string[],
  id: string,
  seats: ReadonlyMap<string, number>,
): ModelTacticsTarget | null {
  const ahead = order[order.indexOf(id) - 1];
  if (ahead === undefined) return null;
  return seats.get(ahead) ?? 'rider';
}

/** Where `target` is on the road from `id` in `order` (see {@link ModelMoveAsk.targetAt}). */
function placeOf(
  order: readonly string[],
  id: string,
  target: ModelTacticsTarget | undefined,
  bots: readonly ModelRaceBot[],
  seats: ReadonlyMap<string, number>,
): ModelMoveAsk['targetAt'] {
  if (target === undefined) return undefined;
  const wanted = target === 'rider' ? order.find((each) => !seats.has(each)) : bots[target]?.id;
  const at = wanted === undefined ? -1 : order.indexOf(wanted);
  const own = order.indexOf(id);
  if (at < 0 || at === own) return undefined;
  if (at === own - 1) return 'ahead';
  return at < own ? 'up-the-road' : 'behind';
}

/**
 * The bots, before the tick at `race.atMs`, with `moves` applied to each whose
 * tactics window opens on it. `moves` `undefined` is no decision in force:
 * every bot keeps its seeded tactics. A tick inside every bot's window returns
 * `bots` itself and allocates nothing (ADR 0067 D-6.4).
 *
 * @param seed - the race's own seed, which the misread line is drawn from.
 * @param strategy - the strategy rules (see the file comment); ADR 0081's unless given.
 */
export function applyModelMoves<B extends ModelRaceBot>(
  race: ItemRaceState,
  bots: readonly B[],
  moves: readonly ModelTacticsMove[] | undefined,
  seed: number,
  strategy: ModelMoveStrategy = ADR_0081_MOVE_STRATEGY,
): AppliedModelMoves<B> {
  const window = Math.floor(race.atMs / BOT_TACTICS_WINDOW_MS);
  // Nothing to decide on a tick inside every bot's window: the common tick.
  if (bots.every((bot) => bot.plan === undefined || bot.tactics.window === window)) {
    return { bots, outcomes: NONE, seats: NO_SEATS };
  }
  // The racers still racing, the leader first, ties by id: `stepBotRace`'s order.
  const racing = race.racers
    .filter((entry) => entry.racer.finishedAtMs === null)
    .map((entry) => entry.racer)
    .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1));
  const order = racing.map((racer) => racer.id);
  const effort = new Map(racing.map((racer) => [racer.id, racer.effortDistance]));
  const seats = new Map(bots.map((bot, seat) => [bot.id, seat]));
  const { laps, lapLengthMetres } = race.course;
  const outcomes: ModelMoveOutcome[] = [];
  const decided: number[] = [];
  let changed = false;
  const next = bots.map((bot, seat): B => {
    const plan = bot.plan;
    const own = effort.get(bot.id);
    // On the line (no plan yet), finished, or already chosen: nothing to decide.
    if (plan === undefined || own === undefined || bot.tactics.window === window) return bot;
    const move = moves?.find((each) => each.bot === seat);
    let outcome: ModelMoveOutcome;
    let ridden = move?.move;
    if (moves === undefined) outcome = 'no-decision';
    else if (move === undefined) outcome = 'not-named';
    // The body's limit, outside the seam: an exhausted bot cannot surge.
    else if (bot.energy.exhausted) outcome = 'exhausted';
    else {
      const misread = botTacticsMisjudgement(seed, seat, bot.strategy.skill, race.atMs).lineMetres;
      const toLineMetres = laps * lapLengthMetres - own;
      const ruling = strategy({
        move: move.move,
        target: move.target,
        atMs: race.atMs,
        archetype: plan.archetype,
        readToLineMetres: toLineMetres + misread,
        toLineMetres,
        lapsLeft: Math.max(0, laps - Math.floor(own / lapLengthMetres)),
        wbalShare: bot.energy.wbalJoules / plan.capacity.wPrimeJoules,
        tactics: bot.tactics,
        ahead: aheadOf(order, bot.id, seats),
        targetAt: placeOf(order, bot.id, move.target, bots, seats),
      });
      if (ruling === undefined) outcome = 'applied';
      else if (typeof ruling === 'string') outcome = ruling;
      else {
        outcome = ruling.outcome;
        ridden = ruling.ride;
      }
    }
    outcomes.push(outcome);
    decided.push(seat);
    if (
      (outcome !== 'applied' &&
        outcome !== 'bridging' &&
        outcome !== 'marking' &&
        outcome !== 'backstop') ||
      move === undefined ||
      ridden === undefined
    ) {
      return bot;
    }
    // The bot's own kick, at the kick's own target: never the model's effort.
    const asked = outcome === 'backstop' ? undefined : move.effort;
    changed = true;
    const kept = ridden === bot.tactics.tactic;
    return {
      ...bot,
      tactics: {
        tactic: ridden,
        sinceMs: kept ? (bot.tactics.sinceMs ?? race.atMs) : race.atMs,
        window,
        ...(asked === undefined ? {} : { effort: asked }),
      },
    };
  });
  return { bots: changed ? next : bots, outcomes, seats: decided };
}

// ---------------------------------------------------------------------------
// Reading a stored log back.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ENTRY_KEYS: ReadonlySet<string> = new Set([
  'askedAtMs',
  'arrivedAtMs',
  'outcome',
  'moves',
  'reason',
  'bot',
  'rank',
  'cues',
  'menu',
  'why',
]);
const MOVE_KEYS: ReadonlySet<string> = new Set(['bot', 'move', 'target', 'effort']);
const MENU_KEYS: ReadonlySet<string> = new Set(['move', 'target']);

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isSeat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 64;

function moveOf(value: unknown): ModelTacticsMove | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !MOVE_KEYS.has(key))) return undefined;
  const { bot, move, target, effort } = value;
  if (!isSeat(bot)) return undefined;
  if (typeof move !== 'string' || !(BOT_TACTICS as readonly string[]).includes(move)) {
    return undefined;
  }
  if (
    effort !== undefined &&
    !(typeof effort === 'string' && (BOT_EFFORTS as readonly string[]).includes(effort))
  ) {
    return undefined;
  }
  if (target !== undefined && target !== 'rider' && !isSeat(target)) return undefined;
  return {
    bot,
    move: move as BotTactic,
    ...(target === undefined ? {} : { target }),
    ...(effort === undefined ? {} : { effort: effort as BotEffort }),
  };
}

function menuEntryOf(value: unknown): ModelTacticsMenuEntry | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !MENU_KEYS.has(key))) return undefined;
  const { move, target } = value;
  if (typeof move !== 'string' || !(BOT_TACTICS as readonly string[]).includes(move)) {
    return undefined;
  }
  if (target !== undefined && target !== 'rider' && !isSeat(target)) return undefined;
  return { move: move as BotTactic, ...(target === undefined ? {} : { target }) };
}

/** What an entry says its call was about (version 7 on), each absent or whole; `undefined` for anything else. */
function askedOf(
  value: Readonly<Record<string, unknown>>,
): Pick<ModelTacticsLogEntry, 'bot' | 'rank' | 'cues' | 'menu'> | undefined {
  const { bot, rank, cues, menu } = value;
  if (bot !== undefined && !isSeat(bot)) return undefined;
  if (rank !== undefined && !(isSeat(rank) && rank >= 1 && rank <= MODEL_TACTICS_MOST_SEATS + 1)) {
    return undefined;
  }
  if (
    cues !== undefined &&
    !(
      Array.isArray(cues) &&
      cues.length <= MODEL_TACTICS_CUES.length &&
      (cues as readonly unknown[]).every(
        (cue) => typeof cue === 'string' && (MODEL_TACTICS_CUES as readonly string[]).includes(cue),
      )
    )
  ) {
    return undefined;
  }
  let offered: ModelTacticsMenuEntry[] | undefined;
  if (menu !== undefined) {
    if (!Array.isArray(menu) || menu.length > MODEL_TACTICS_MENU_MOST) return undefined;
    const read = (menu as readonly unknown[]).map(menuEntryOf);
    if (read.some((each) => each === undefined)) return undefined;
    offered = read as ModelTacticsMenuEntry[];
  }
  return {
    ...(bot === undefined ? {} : { bot }),
    ...(rank === undefined ? {} : { rank }),
    ...(cues === undefined ? {} : { cues: cues as ModelTacticsCue[] }),
    ...(offered === undefined ? {} : { menu: offered }),
  };
}

/**
 * One log entry read back from storage, whole or not at all: `undefined` for
 * anything that is not one this build wrote. A `decision` carries its moves
 * and no reason; every other outcome a reason and no moves. What the call was
 * about, and a decision's reason word, are read where an entry has them: one
 * from before bot-code version 7 has none.
 */
export function readModelTacticsLogEntry(value: unknown): ModelTacticsLogEntry | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !ENTRY_KEYS.has(key))) {
    return undefined;
  }
  const { askedAtMs, arrivedAtMs, outcome, moves, reason, why } = value;
  if (!isTime(askedAtMs) || !isTime(arrivedAtMs) || arrivedAtMs < askedAtMs) return undefined;
  if (
    typeof outcome !== 'string' ||
    !(MODEL_TACTICS_LOG_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    return undefined;
  }
  const asked = askedOf(value);
  if (asked === undefined) return undefined;
  if (outcome === 'decision') {
    if (reason !== undefined || !Array.isArray(moves)) return undefined;
    const read = (moves as readonly unknown[]).map(moveOf);
    if (read.some((each) => each === undefined)) return undefined;
    if (
      why !== undefined &&
      !(typeof why === 'string' && (MODEL_TACTICS_REASONS as readonly string[]).includes(why))
    ) {
      return undefined;
    }
    return {
      askedAtMs,
      arrivedAtMs,
      outcome,
      moves: read as ModelTacticsMove[],
      ...asked,
      ...(why === undefined ? {} : { why: why as ModelTacticsReason }),
    };
  }
  if (
    moves !== undefined ||
    why !== undefined ||
    typeof reason !== 'string' ||
    !(MODEL_TACTICS_LOG_REASONS as readonly string[]).includes(reason)
  ) {
    return undefined;
  }
  return {
    askedAtMs,
    arrivedAtMs,
    outcome: outcome as ModelTacticsLogOutcome,
    reason: reason as ModelTacticsLogReason,
    ...asked,
  };
}

// ---------------------------------------------------------------------------
// The record kept with the ride (D-4.4).
// ---------------------------------------------------------------------------

/**
 * **What a race with AI bots keeps with the ride, on the device** (ADR 0071
 * D-4.4): its seed, its bot-code version, its log and the rider's own input
 * at every race tick — what a replay needs, because the bots read the rider
 * (D-4.1). Never the model's text, and not the model input, which is
 * rederived from the rest (D-11 R-7). The instance keeps no copy (D-7).
 *
 * Since bot-code version 7 (#2836, ADR 0081 D-5) it also keeps what explains
 * the race to somebody reading it afterwards, which no replay reads:
 * {@link bots} and {@link rode}. Numbers and closed words only.
 */
export interface LapRaceModelRecord {
  readonly version: number;
  readonly seed: number;
  readonly log: readonly ModelTacticsLogEntry[];
  /** Who each bot is, by seat: its racing style, its personality and its skill. Absent before version 7. */
  readonly bots?: readonly LapRaceModelBot[];
  /**
   * Every change of move, in race order: the bot, the move it took up, and who
   * chose it. So "which moves were seeded" is read off, not recomputed. At
   * most {@link LAP_RACE_MODEL_MOST_MOVES}. Absent before version 7.
   */
  readonly rode?: readonly LapRaceModelRode[];
  /** The rider at every race tick, one entry a tick in each list but `uses`. */
  readonly rider: {
    /** Effort distance after each tick, metres. */
    readonly effortDistances: readonly number[];
    /** Their power as the bots read it, W/kg, or `null` with none. */
    readonly wattsPerKilogram: readonly (number | null)[];
    /** The lane ridden each tick. */
    readonly lanes: readonly number[];
    /** The ticks, from 0, an item was used on. */
    readonly uses: readonly number[];
  };
}

/** One bot of a race with AI bots, as its record names it (#2836): closed words only. */
export interface LapRaceModelBot {
  readonly style: ModelRacingStyle;
  readonly personality: BotPersonality;
  readonly skill: BotSkill;
}

/** One change of move in a race with AI bots (#2836): when, which bot, to what, and who chose it. */
export interface LapRaceModelRode {
  /** Race time of the tick it took the move up on, ms. */
  readonly atMs: number;
  /** Its seat. */
  readonly bot: number;
  readonly move: BotTactic;
  readonly by: ModelMoveChooser;
}

/**
 * The most race ticks a record holds: **four hours** at the race's 20 Hz. A
 * list longer is not one this build wrote.
 */
export const LAP_RACE_MODEL_MOST_TICKS = 4 * 60 * 60 * 20;

/**
 * The most changes of move a record holds: **100 800**, every one of seven
 * bots changing its move in every 1 s window of four hours, which no race
 * comes near. A race stops appending there; a list longer is not one this
 * build wrote.
 */
export const LAP_RACE_MODEL_MOST_MOVES = MODEL_TACTICS_MOST_SEATS * 4 * 60 * 60;

const RECORD_KEYS: ReadonlySet<string> = new Set([
  'version',
  'seed',
  'log',
  'rider',
  'bots',
  'rode',
]);
const BOT_KEYS: ReadonlySet<string> = new Set(['style', 'personality', 'skill']);
const RODE_KEYS: ReadonlySet<string> = new Set(['atMs', 'bot', 'move', 'by']);

const isWord = (value: unknown, words: readonly string[]): boolean =>
  typeof value === 'string' && words.includes(value);

function recordBotOf(value: unknown): LapRaceModelBot | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !BOT_KEYS.has(key))) return undefined;
  const { style, personality, skill } = value;
  return isWord(style, MODEL_RACING_STYLES) &&
    isWord(personality, BOT_PERSONALITIES) &&
    isWord(skill, BOT_SKILLS)
    ? {
        style: style as ModelRacingStyle,
        personality: personality as BotPersonality,
        skill: skill as BotSkill,
      }
    : undefined;
}

function rodeOf(value: unknown): LapRaceModelRode | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !RODE_KEYS.has(key))) return undefined;
  const { atMs, bot, move, by } = value;
  return isTime(atMs) && isSeat(bot) && isWord(move, BOT_TACTICS) && isWord(by, MODEL_MOVE_CHOOSERS)
    ? { atMs, bot, move: move as BotTactic, by: by as ModelMoveChooser }
    : undefined;
}

/** A list read whole, each item by `each`, no longer than `most`; `undefined` for anything else. */
function listOf<T>(
  value: unknown,
  most: number,
  each: (item: unknown) => T | undefined,
): readonly T[] | undefined {
  if (!Array.isArray(value) || value.length > most) return undefined;
  const read = (value as readonly unknown[]).map(each);
  return read.some((item) => item === undefined) ? undefined : (read as T[]);
}
const RIDER_KEYS: ReadonlySet<string> = new Set([
  'effortDistances',
  'wattsPerKilogram',
  'lanes',
  'uses',
]);

const numbersOf = <T>(
  value: unknown,
  each: (item: unknown) => item is T,
): readonly T[] | undefined =>
  Array.isArray(value) &&
  value.length <= LAP_RACE_MODEL_MOST_TICKS &&
  (value as readonly unknown[]).every(each)
    ? (value as readonly T[])
    : undefined;

const isFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * A stored record read back, whole or not at all: `undefined` for anything
 * that is not one this build wrote — a key it does not name, a log entry that
 * does not read, lists of different lengths, a use past the last tick.
 */
export function readLapRaceModelRecord(value: unknown): LapRaceModelRecord | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !RECORD_KEYS.has(key))) {
    return undefined;
  }
  const { version, seed, log, rider } = value;
  if (!isWhole(version) || version < 1 || !isWhole(seed) || !Array.isArray(log)) return undefined;
  const bots =
    value.bots === undefined ? [] : listOf(value.bots, MODEL_TACTICS_MOST_SEATS, recordBotOf);
  const rode =
    value.rode === undefined ? [] : listOf(value.rode, LAP_RACE_MODEL_MOST_MOVES, rodeOf);
  if (bots === undefined || rode === undefined) return undefined;
  const entries = (log as readonly unknown[]).map(readModelTacticsLogEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  if (!isRecord(rider) || Object.keys(rider).some((key) => !RIDER_KEYS.has(key))) return undefined;
  const effortDistances = numbersOf(rider.effortDistances, isFinite);
  const wattsPerKilogram = numbersOf(
    rider.wattsPerKilogram,
    (item): item is number | null => item === null || isFinite(item),
  );
  const lanes = numbersOf(rider.lanes, isWhole);
  const uses = numbersOf(rider.uses, isWhole);
  if (
    effortDistances === undefined ||
    wattsPerKilogram === undefined ||
    lanes === undefined ||
    uses === undefined
  ) {
    return undefined;
  }
  const ticks = effortDistances.length;
  if (wattsPerKilogram.length !== ticks || lanes.length !== ticks) return undefined;
  if (uses.some((tick) => tick >= ticks)) return undefined;
  return {
    version,
    seed,
    log: entries as ModelTacticsLogEntry[],
    rider: { effortDistances, wattsPerKilogram, lanes, uses },
    ...(value.bots === undefined ? {} : { bots }),
    ...(value.rode === undefined ? {} : { rode }),
  };
}
