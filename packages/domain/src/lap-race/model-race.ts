// SPDX-License-Identifier: Apache-2.0

/**
 * **A lap race whose bots' moves a language model picks: the decision log,
 * when a logged decision is in force, and how a move is ridden** — #2710,
 * ADR 0071 D-3.6, D-4 and D-7.
 *
 * Written fresh for #2710 (ADR 0071 D-8.7): the spike's AGPL copies under
 * `apps/web/tools/model-tactics-spike/` are not moved.
 *
 * ## The race is the seed, the log and the bot-code version (D-4)
 *
 * Every model call is one {@link ModelTacticsLogEntry}: the race time it was
 * asked at, the race time its answer **arrived** at, and the answer as checked
 * or the closed reason it was not applied. A decision applies from the first
 * tactics window (`archetype.ts` §`BOT_TACTICS_WINDOW_MS`) that starts after it
 * arrived ({@link modelTacticsAppliedAtMs}) and lapses
 * {@link MODEL_TACTICS_HOLD_MS} later unless the next replaces it
 * ({@link modelMovesInForce}). Race time only, never a wall clock, so a race
 * replays from the seed, the log, {@link LAP_RACE_BOT_CODE_VERSION} and the
 * rider's own input, to the bit. A seeded race is a model race with an empty
 * log.
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
 * - **Strategy rules**, behind ONE seam, {@link ModelMoveStrategy}:
 *   {@link ADR_0071_MOVE_STRATEGY} is ADR 0071 D-3.6's, which the race uses
 *   today. ADR 0073 (#2720) loosens strategy, and only strategy, by handing
 *   {@link applyModelMoves} another.
 *
 * ## The launch band reads the misread line (#2705)
 *
 * Seeded `decideTactic` launches its kick when the line **as the bot misreads
 * it** (`archetype.ts` §`botTacticsMisjudgement`'s `lineMetres`) is inside its
 * launch distance. The spike's adapter read the true distance, so inside a band
 * of up to ±60 m a model's move could replace or end a seeded kick.
 * {@link ModelMoveAsk.readToLineMetres} is the same misread distance, so the
 * two agree to the metre.
 */

import { botTacticsMisjudgement, BOT_TACTICS_WINDOW_MS, type BotArchetype } from './archetype';
import type { ItemRaceState } from './items';
import {
  BOT_TACTICS,
  BOT_TACTIC_ATTACK_MS,
  BOT_TACTIC_FLYER_LAPS,
  BOT_TACTIC_FLYER_WBAL_SHARE,
  BOT_TACTIC_WBAL_FLOOR,
  botLaunchMetres,
  type BotTactic,
  type TacticMemory,
} from './tactics';
import type { BotRacePlan } from './plan';
import type { BotSkill } from './strategy';
import type { BotEnergy } from './wbal';
import type { ModelTacticsInvalid, ModelTacticsMove, ModelTacticsTarget } from './model-tactics';

/**
 * **The bot-code version: 1** (ADR 0071 D-4.3). Raised by any change that
 * alters any bot's output for some seed and log — a tactic, a plan, the W′
 * model, the adapter, a seam's rule, a physics step. Stored beside the seed and
 * the log; a log recorded under another version is not replayed.
 * `apps/web` §`model-race-replay.test.ts` holds committed seeds and logs to
 * their outcomes, keyed by this number.
 */
export const LAP_RACE_BOT_CODE_VERSION = 1;

/** How often the model is asked, ms of race time: every **4 s**, spike 0039's draft (D-7). */
export const MODEL_TACTICS_ASK_EVERY_MS = 4_000;

/**
 * An answer that arrives more than this after it was asked is **late**, ms of
 * race time: **5 s**, spike 0039's figure (D-7). It is logged and never
 * applied: it describes a race that has moved on. A call still out this long
 * is given up as late too, so a call that never settles cannot stop the next.
 */
export const MODEL_TACTICS_LATE_MS = 5_000;

/**
 * How long an applied decision holds, ms, unless the next replaces it first:
 * **5 s**, spike 0039's figure (D-4.2, D-7). So a late or missing answer lets
 * the field fall back to its seeded tactics rather than ride a stale move on.
 */
export const MODEL_TACTICS_HOLD_MS = 5_000;

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
  /** The moves, for a `decision` only. */
  readonly moves?: readonly ModelTacticsMove[];
  /** Why it applied nothing, for every other outcome. */
  readonly reason?: ModelTacticsLogReason;
}

/** The race time a decision that arrived at `arrivedAtMs` applies from: the next window's start. */
export function modelTacticsAppliedAtMs(arrivedAtMs: number): number {
  return (Math.floor(arrivedAtMs / BOT_TACTICS_WINDOW_MS) + 1) * BOT_TACTICS_WINDOW_MS;
}

/** The race time of the next ask after a call settled at `settledAtMs`: the next 4 s mark. */
export function modelTacticsNextAskAtMs(settledAtMs: number): number {
  return (Math.floor(settledAtMs / MODEL_TACTICS_ASK_EVERY_MS) + 1) * MODEL_TACTICS_ASK_EVERY_MS;
}

/**
 * The moves in force at race time `atMs`, or `undefined` with none: the latest
 * `decision` applied at or before it, for {@link MODEL_TACTICS_HOLD_MS}. Any
 * other outcome applies nothing. Reads the log and nothing else, so a replay
 * from the log finds the same moves at the same instant.
 */
export function modelMovesInForce(
  log: readonly ModelTacticsLogEntry[],
  atMs: number,
): readonly ModelTacticsMove[] | undefined {
  let found: ModelTacticsLogEntry | undefined;
  let foundFrom = Number.NEGATIVE_INFINITY;
  for (const entry of log) {
    if (entry.outcome !== 'decision') continue;
    const from = modelTacticsAppliedAtMs(entry.arrivedAtMs);
    if (from > atMs || from < foundFrom) continue;
    found = entry;
    foundFrom = from;
  }
  if (found === undefined || atMs >= foundFrom + MODEL_TACTICS_HOLD_MS) return undefined;
  return found.moves;
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
  /** Laps left, the one it is on counted whole. */
  readonly lapsLeft: number;
  /** Its actual W′ balance as a share of its W′, 0 to 1. */
  readonly wbalShare: number;
  /** What its tactics remember: the move it is in and since when. */
  readonly tactics: TacticMemory;
  /** Who is directly ahead: `"rider"`, a seat, or `null` when it leads. */
  readonly ahead: ModelTacticsTarget | null;
}

/** Why a strategy rule kept a bot on its seeded choice. */
export type ModelMoveStrategyRefusal =
  'launch' | 'wbal-floor' | 'kick-closed' | 'flyer-closed' | 'attack-over' | 'target-not-ahead';

/**
 * **The one strategy seam** (the owner's ruling of 2026-11-16 on #2710): every
 * rule that decides whether a bot may ride a move it is *able* to ride. Given
 * an ask, the refusal, or `undefined` to ride the move. The body's limits are
 * not in it, and cannot be loosened through it.
 */
export type ModelMoveStrategy = (ask: ModelMoveAsk) => ModelMoveStrategyRefusal | undefined;

/**
 * ADR 0071 D-3.6's strategy rules, the ones a model race rides today:
 *
 * - inside its launch distance, as it reads the line, a bot sprints its own
 *   seeded way: the kick is never the model's to time;
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
  'applied' | 'no-decision' | 'not-named' | 'exhausted' | ModelMoveStrategyRefusal;

/** The bots with the moves in force applied, and what became of each whose window opened. */
export interface AppliedModelMoves<B extends ModelRaceBot> {
  readonly bots: readonly B[];
  /** One per racing bot whose window opens on this tick, in seat order; none mid-window. */
  readonly outcomes: readonly ModelMoveOutcome[];
}

const NONE: readonly ModelMoveOutcome[] = Object.freeze([]);

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

/**
 * The bots, before the tick at `race.atMs`, with `moves` applied to each whose
 * tactics window opens on it. `moves` `undefined` is no decision in force:
 * every bot keeps its seeded tactics. A tick inside every bot's window returns
 * `bots` itself and allocates nothing (ADR 0067 D-6.4).
 *
 * @param seed - the race's own seed, which the misread line is drawn from.
 * @param strategy - the strategy rules (see the file comment); ADR 0071's unless given.
 */
export function applyModelMoves<B extends ModelRaceBot>(
  race: ItemRaceState,
  bots: readonly B[],
  moves: readonly ModelTacticsMove[] | undefined,
  seed: number,
  strategy: ModelMoveStrategy = ADR_0071_MOVE_STRATEGY,
): AppliedModelMoves<B> {
  const window = Math.floor(race.atMs / BOT_TACTICS_WINDOW_MS);
  // Nothing to decide on a tick inside every bot's window: the common tick.
  if (bots.every((bot) => bot.plan === undefined || bot.tactics.window === window)) {
    return { bots, outcomes: NONE };
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
  let changed = false;
  const next = bots.map((bot, seat): B => {
    const plan = bot.plan;
    const own = effort.get(bot.id);
    // On the line (no plan yet), finished, or already chosen: nothing to decide.
    if (plan === undefined || own === undefined || bot.tactics.window === window) return bot;
    const move = moves?.find((each) => each.bot === seat);
    let outcome: ModelMoveOutcome;
    if (moves === undefined) outcome = 'no-decision';
    else if (move === undefined) outcome = 'not-named';
    // The body's limit, outside the seam: an exhausted bot cannot surge.
    else if (bot.energy.exhausted) outcome = 'exhausted';
    else {
      const misread = botTacticsMisjudgement(seed, seat, bot.strategy.skill, race.atMs).lineMetres;
      outcome =
        strategy({
          move: move.move,
          target: move.target,
          atMs: race.atMs,
          archetype: plan.archetype,
          readToLineMetres: laps * lapLengthMetres - own + misread,
          lapsLeft: Math.max(0, laps - Math.floor(own / lapLengthMetres)),
          wbalShare: bot.energy.wbalJoules / plan.capacity.wPrimeJoules,
          tactics: bot.tactics,
          ahead: aheadOf(order, bot.id, seats),
        }) ?? 'applied';
    }
    outcomes.push(outcome);
    if (outcome !== 'applied' || move === undefined) return bot;
    changed = true;
    const kept = move.move === bot.tactics.tactic;
    return {
      ...bot,
      tactics: {
        tactic: move.move,
        sinceMs: kept ? (bot.tactics.sinceMs ?? race.atMs) : race.atMs,
        window,
      },
    };
  });
  return { bots: changed ? next : bots, outcomes };
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
]);
const MOVE_KEYS: ReadonlySet<string> = new Set(['bot', 'move', 'target']);

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isSeat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 64;

function moveOf(value: unknown): ModelTacticsMove | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !MOVE_KEYS.has(key))) return undefined;
  const { bot, move, target } = value;
  if (!isSeat(bot)) return undefined;
  if (typeof move !== 'string' || !(BOT_TACTICS as readonly string[]).includes(move)) {
    return undefined;
  }
  if (target === undefined) return { bot, move: move as BotTactic };
  if (target !== 'rider' && !isSeat(target)) return undefined;
  return { bot, move: move as BotTactic, target };
}

/**
 * One log entry read back from storage, whole or not at all: `undefined` for
 * anything that is not one this build wrote. A `decision` carries its moves
 * and no reason; every other outcome a reason and no moves.
 */
export function readModelTacticsLogEntry(value: unknown): ModelTacticsLogEntry | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !ENTRY_KEYS.has(key))) {
    return undefined;
  }
  const { askedAtMs, arrivedAtMs, outcome, moves, reason } = value;
  if (!isTime(askedAtMs) || !isTime(arrivedAtMs) || arrivedAtMs < askedAtMs) return undefined;
  if (
    typeof outcome !== 'string' ||
    !(MODEL_TACTICS_LOG_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    return undefined;
  }
  if (outcome === 'decision') {
    if (reason !== undefined || !Array.isArray(moves)) return undefined;
    const read = (moves as readonly unknown[]).map(moveOf);
    if (read.some((each) => each === undefined)) return undefined;
    return {
      askedAtMs,
      arrivedAtMs,
      outcome,
      moves: read as ModelTacticsMove[],
    };
  }
  if (
    moves !== undefined ||
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
 */
export interface LapRaceModelRecord {
  readonly version: number;
  readonly seed: number;
  readonly log: readonly ModelTacticsLogEntry[];
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

/**
 * The most race ticks a record holds: **four hours** at the race's 20 Hz. A
 * list longer is not one this build wrote.
 */
export const LAP_RACE_MODEL_MOST_TICKS = 4 * 60 * 60 * 20;

const RECORD_KEYS: ReadonlySet<string> = new Set(['version', 'seed', 'log', 'rider']);
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
  };
}
