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
 * written had it chosen the move itself. The tick then rides it exactly as it
 * rides a seeded choice: the target from the view, the wheel held, `wbal.ts`
 * §`spendableWatts` capping it at the bot's peak, at CP once it is exhausted,
 * and the plan limiting it to what the W′ balance pays for. **No shipped
 * module is changed**: the adapter writes the one field of `LapRaceBot` the
 * tactics already round-trip, through its public type.
 *
 * ## Two rule sets (#2720)
 *
 * {@link ModelRules} names which rules a model's move is ridden under, so that
 * a log recorded under one replays under the same one.
 *
 * **`adr-0073`, the default** (ADR 0073, Proposed, #2720): the strategy rules
 * are lifted and the body's limits kept. A bot keeps today's seeded choice for
 * the window only when no decision is in force, the decision does not name it,
 * or **it is exhausted**: a blown bot rides as the seeded tactics ride it, and
 * `spendableWatts` holds it to CP either way. Anything else the model names is
 * ridden: an `attack` or `chase` under the W′ floor (a gamble, and a bot may
 * blow up), a `flyer` on any lap and at any W′, an `attack` for as long as the
 * model keeps it, a `kick` wherever the model launches it, and a move other
 * than the kick inside the launch distance (a launch held late). A `follow`
 * or `chase` may name any racer, the rider included ({@link aimedAt}).
 *
 * **`adr-0071`** (ADR 0071 D-3.6, the rules #2616 and #2708 recorded their
 * logs under): a bot keeps today's seeded choice when no decision is in
 * force or the decision does not name it; inside its launch distance; when it
 * is exhausted, or a spending move (`attack`, `chase`) is asked of it under
 * `BOT_TACTIC_WBAL_FLOOR`; when the move is not open to it (a `kick` outside
 * its launch, a `flyer` before the last `BOT_TACTIC_FLYER_LAPS` laps or under
 * its W′ share, an `attack` held for `BOT_TACTIC_ATTACK_MS` already); and when
 * a `follow` or `chase` names a racer who is not directly ahead.
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
  type BotTactic,
  type ItemRaceState,
} from '@onyourleft/domain';
import type { LapRaceBot } from '@onyourleft/physics';

import type { ModelMove } from './decision';

/** Which rules a model's move is ridden under: ADR 0073's (#2720), or ADR 0071 D-3.6's (#2616, #2708). */
export type ModelRules = 'adr-0071' | 'adr-0073';

/** The rules a log that names none was recorded under: #2616's and #2708's. */
export const MODEL_RULES_BEFORE_2720: ModelRules = 'adr-0071';

/** What became of the model's say over one bot for one window. */
export type MoveOutcome =
  | 'applied'
  /** `adr-0073`: a `follow` or `chase` of a racer further up the road, ridden as a `chase` to them. */
  | 'bridging'
  /** `adr-0073`: a `follow` or `chase` of a racer behind, ridden as `sit-in` until they come by. */
  | 'marking'
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

/** Under `adr-0071`: whether `move` may be carried out by `bot` now, or why not. */
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

/**
 * What a `follow` or `chase` aimed at `move.target` is ridden as under
 * `adr-0073` (#2720). Today's physics carries both moves to the wheel
 * directly ahead and no other, so a target elsewhere is reached through the
 * moves the bot already has:
 *
 * - **directly ahead**, or no target, or a target that is the bot itself or
 *   is no longer racing: the move as named, on the wheel ahead;
 * - **further up the road**: a `chase`, which rides past the racers between
 *   until the target is the one directly ahead, and the next window's move
 *   is ridden on its wheel;
 * - **behind**: `sit-in`, which rides the wheel ahead at that wheel's pace
 *   and never waits, so the marked racer comes by as the bunch rides, when a
 *   `follow` takes its wheel.
 */
function aimedAt(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  seat: number,
  move: ModelMove,
  order: readonly string[],
): { readonly outcome: MoveOutcome; readonly ridden: BotTactic } {
  const as = { outcome: 'applied', ridden: move.move } as const;
  if ((move.move !== 'follow' && move.move !== 'chase') || move.target === undefined) return as;
  const own = order.indexOf((bots[seat] as LapRaceBot).id);
  const wanted = move.target === 'rider' ? riderId(race, bots) : bots[move.target]?.id;
  const at = wanted === undefined ? -1 : order.indexOf(wanted);
  if (at < 0 || at === own || at === own - 1) return as;
  return at < own
    ? { outcome: 'bridging', ridden: 'chase' }
    : { outcome: 'marking', ridden: 'sit-in' };
}

/** The rider's id: the one racer that is not a bot. */
function riderId(race: ItemRaceState, bots: readonly LapRaceBot[]): string | undefined {
  const ids = new Set(bots.map((bot) => bot.id));
  return race.racers.find((entry) => !ids.has(entry.racer.id))?.racer.id;
}

/**
 * The bots, before the tick at `race.atMs`, with `moves` applied to each whose
 * tactics window opens on it, under `rules`. `moves` `undefined` is no
 * decision in force: every bot keeps today's seeded tactics, and the bots
 * come back unchanged.
 */
export function applyModelMoves(
  race: ItemRaceState,
  bots: readonly LapRaceBot[],
  moves: readonly ModelMove[] | undefined,
  rules: ModelRules = 'adr-0073',
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
    if (move === undefined) {
      outcomes.push(moves === undefined ? 'no-decision' : 'not-named');
      return bot;
    }
    const { outcome, ridden } =
      rules === 'adr-0071'
        ? { outcome: legality(race, bots, seat, move, order), ridden: move.move }
        : bot.energy.exhausted
          ? { outcome: 'exhausted' as const, ridden: move.move }
          : aimedAt(race, bots, seat, move, order);
    outcomes.push(outcome);
    if (outcome !== 'applied' && outcome !== 'bridging' && outcome !== 'marking') return bot;
    const kept = ridden === bot.tactics.tactic;
    return {
      ...bot,
      tactics: {
        tactic: ridden,
        sinceMs: kept ? (bot.tactics.sinceMs ?? race.atMs) : race.atMs,
        window,
      },
    };
  });
  return { bots: next, outcomes };
}
