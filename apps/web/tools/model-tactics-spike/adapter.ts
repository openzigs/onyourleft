// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: the model-tactics adapter. It turns the moves in force into
 * the bots' existing tactics, and nothing else.
 *
 * ## How a move is carried out: through the tactics' own memory
 *
 * `@onyourleft/domain` §`decideTactic` chooses a state at the first call in
 * each 1 s window and holds it for the rest; within a window it only works out
 * the state's power target from the race view. So the adapter, before the
 * tick that opens a window, hands a bot the memory `decideTactic` would have
 * written had it chosen the model's move itself: that move, this window. The
 * tick then rides it exactly as it rides a seeded choice: the target from the
 * view, the wheel held, `wbal.ts` §`spendableWatts` capping it at the bot's
 * peak, at CP once it is exhausted, and the plan limiting it to what the W′
 * balance pays for. **No shipped module is changed**: the adapter writes the
 * one field of `LapRaceBot` the tactics already round-trip, through its public
 * type.
 *
 * ## What stays local, and what falls back
 *
 * A bot keeps today's seeded choice for the window ({@link MoveOutcome}) when:
 *
 * - no decision is in force, or the decision does not name it;
 * - it is inside its launch distance (`botLaunchMetres`): **the sprint launch
 *   stays local**, so the kick is never a model's to time;
 * - its W′ is exhausted, or a spending move (`attack`, `chase`) is asked of it
 *   under `BOT_TACTIC_WBAL_FLOOR`: **the low-W′ overrides stay local**;
 * - the move is not open to it: a `kick` outside its launch, a `flyer` before
 *   the last `BOT_TACTIC_FLYER_LAPS` laps or under its W′ share, an `attack`
 *   it has held for `BOT_TACTIC_ATTACK_MS` already;
 * - a `follow` or `chase` names a target that is not the racer directly ahead
 *   of it: those moves act on the wheel ahead, and today's physics has no
 *   other wheel to carry them to.
 *
 * Spike code: see `decision.ts`.
 */

import {
  BOT_TACTIC_ATTACK_MS,
  BOT_TACTIC_FLYER_LAPS,
  BOT_TACTIC_FLYER_WBAL_SHARE,
  BOT_TACTIC_WBAL_FLOOR,
  BOT_TACTICS_WINDOW_MS,
  botLaunchMetres,
  type ItemRaceState,
} from '@onyourleft/domain';
import type { LapRaceBot } from '@onyourleft/physics';

import type { ModelMove } from './decision';

/** What became of the model's say over one bot for one window. */
export type MoveOutcome =
  | 'applied'
  | 'no-decision'
  | 'not-named'
  | 'launch'
  | 'exhausted'
  | 'wbal-floor'
  | 'kick-closed'
  | 'flyer-closed'
  | 'attack-over'
  | 'target-not-ahead';

/** The bots with the moves in force applied, and what became of each that opened a window. */
export interface AppliedMoves {
  readonly bots: readonly LapRaceBot[];
  /** One per racing bot whose window opens on this tick; none mid-window. */
  readonly outcomes: readonly MoveOutcome[];
}

/** Whether `move` may be carried out by `bot` now, or why not. */
function legality(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  seat: number,
  move: ModelMove,
  order: readonly string[],
): MoveOutcome {
  const bot = bots[seat] as LapRaceBot;
  const plan = bot.plan as NonNullable<LapRaceBot['plan']>;
  const own = race.racers.find((entry) => entry.racer.id === bot.id)?.racer;
  const effort = own?.effortDistance ?? 0;
  const { laps, lapLengthMetres } = race.course;
  const toLine = laps * lapLengthMetres - effort;
  const inLaunch = toLine <= botLaunchMetres(plan.archetype);
  if (inLaunch) return 'launch';
  if (bot.energy.exhausted) return 'exhausted';
  const share = bot.energy.wbalJoules / plan.capacity.wPrimeJoules;
  const lapsLeft = Math.max(0, laps - Math.floor(effort / lapLengthMetres));
  switch (move.move) {
    case 'kick':
      return 'kick-closed';
    case 'attack':
    case 'chase':
      if (share < BOT_TACTIC_WBAL_FLOOR) return 'wbal-floor';
      break;
    case 'flyer':
      if (lapsLeft > BOT_TACTIC_FLYER_LAPS || share < BOT_TACTIC_FLYER_WBAL_SHARE) {
        return 'flyer-closed';
      }
      break;
    default:
      break;
  }
  if (
    move.move === 'attack' &&
    bot.tactics.tactic === 'attack' &&
    bot.tactics.sinceMs !== null &&
    race.atMs - bot.tactics.sinceMs >= BOT_TACTIC_ATTACK_MS
  ) {
    return 'attack-over';
  }
  if ((move.move === 'follow' || move.move === 'chase') && move.target !== undefined) {
    const ahead = order[order.indexOf(bot.id) - 1];
    const wanted = move.target === 'rider' ? riderId(race, bots) : bots[move.target]?.id;
    if (ahead === undefined || wanted !== ahead) return 'target-not-ahead';
  }
  return 'applied';
}

/** The rider's id: the one racer that is not a bot. */
function riderId(race: ItemRaceState, bots: readonly LapRaceBot[]): string | undefined {
  const ids = new Set(bots.map((bot) => bot.id));
  return race.racers.find((entry) => !ids.has(entry.racer.id))?.racer.id;
}

/**
 * The bots, before the tick at `race.atMs`, with `moves` applied to each whose
 * tactics window opens on it. `moves` `undefined` is no decision in force:
 * every bot keeps today's seeded tactics, and the bots come back unchanged.
 */
export function applyModelMoves(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  moves: readonly ModelMove[] | undefined,
): AppliedMoves {
  const window = Math.floor(race.atMs / BOT_TACTICS_WINDOW_MS);
  // The racers still racing, the leader first, ties by id: `stepBotRace`'s order.
  const order = race.racers
    .filter((entry) => entry.racer.finishedAtMs === null)
    .map((entry) => entry.racer)
    .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1))
    .map((racer) => racer.id);
  const outcomes: MoveOutcome[] = [];
  const next = bots.map((bot, seat): LapRaceBot => {
    // A bot on the line (no plan yet), one that has finished, or one whose
    // window is already chosen: nothing to decide on this tick.
    if (bot.plan === undefined || !order.includes(bot.id) || bot.tactics.window === window) {
      return bot;
    }
    const move = moves?.find((each) => each.bot === seat);
    const outcome =
      moves === undefined
        ? 'no-decision'
        : move === undefined
          ? 'not-named'
          : legality(race, bots, seat, move, order);
    outcomes.push(outcome);
    if (outcome !== 'applied' || move === undefined) return bot;
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
  return { bots: next, outcomes };
}
