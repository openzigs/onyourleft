// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: what the comparison reads off a ridden field, for the
 * seeded tactics and the model's alike. Feel is the owner's to judge on the
 * tablet; these are the numbers that say whether the two races differ at all,
 * and how.
 *
 * Spike code: see `decision.ts`.
 */

import { BOT_TACTICS, type BotTactic } from '@onyourleft/domain';

import { LAP_RACE_TICK_SECONDS } from '../../src/game/lap-race/ride-race';

import type { FieldRun, FieldTick } from './race';

/** A move this far clear of the racer behind it has left the group, metres: #2561's 5 m. */
const AWAY_METRES = 5;
/** A draft multiplier at or under this is in a draft: #2561's hilly bound, **0.8**. */
const IN_DRAFT_K = 0.8;
/** When the pack is read, seconds: #2561's 30. */
const PACK_BY_SECONDS = 30;

/** What one field came to. */
export interface FieldNumbers {
  /** The share of bot-ticks in each move, to 3 places. */
  readonly tacticShare: Readonly<Record<BotTactic, number>>;
  /** Changes of move per bot per minute. */
  readonly changesPerBotMinute: number;
  /** Attacks and flyers that got {@link AWAY_METRES} clear of the racer behind. */
  readonly awayMoves: number;
  /** Bots in a draft at {@link PACK_BY_SECONDS}. */
  readonly draftingAt30s: number;
  /** How often the lead among the bots changed hands. */
  readonly leadChanges: number;
  /** Metres from the first bot to the last at the end. */
  readonly spreadAtEndM: number;
  /** The lowest W′ share any bot read. */
  readonly lowestWbal: number;
  /** The rider's place at the end, 1 for the leader. */
  readonly riderPlaceAtEnd: number;
  /** When a bot first attacked or went on a flyer, seconds, or `null` if none did (#2708). */
  readonly firstMoveS: number | null;
  /** The most bots attacking or on a flyer on any one tick (#2708). */
  readonly mostMovingAtOnce: number;
  /** For each chase, the gap to the racer ahead on its first tick, metres to 1 place (#2708). */
  readonly chaseStartGapsM: readonly number[];
}

const round = (value: number): number => Math.round(value * 1_000) / 1_000;

function gapAhead(tick: FieldTick, id: string): number | null {
  const own = tick.at.get(id) as number;
  const ahead = [...tick.at.values()].filter((at) => at > own);
  return ahead.length === 0 ? null : Math.min(...ahead) - own;
}

const moving = (tactic: BotTactic | undefined): boolean =>
  tactic === 'attack' || tactic === 'flyer';

/** For each run of ticks in which a bot chased, the gap ahead on its first tick. */
function chaseStartGaps(ticks: readonly FieldTick[], bots: readonly string[]): number[] {
  const gaps: number[] = [];
  for (const id of bots) {
    ticks.forEach((tick, at) => {
      if (tick.tactic.get(id) === 'chase' && ticks[at - 1]?.tactic.get(id) !== 'chase') {
        gaps.push(Math.round((gapAhead(tick, id) ?? 0) * 10) / 10);
      }
    });
  }
  return gaps;
}

function gapBehind(tick: FieldTick, id: string): number | null {
  const own = tick.at.get(id) as number;
  const behind = [...tick.at.values()].filter((at) => at < own);
  return behind.length === 0 ? null : own - Math.max(...behind);
}

/** Runs of ticks in which a bot attacked or went on a flyer and got clear, as #2561 reads them. */
function awayMoves(ticks: readonly FieldTick[]): number {
  const bots = [...(ticks[0]?.tactic.keys() ?? [])];
  let away = 0;
  for (const id of bots) {
    let from: number | undefined;
    const close = (to: number): void => {
      if (from === undefined) return;
      const after = ticks.slice(from, Math.min(ticks.length, to + 10 / LAP_RACE_TICK_SECONDS));
      if (after.some((tick) => (gapBehind(tick, id) ?? 0) > AWAY_METRES)) away += 1;
      from = undefined;
    };
    ticks.forEach((tick, at) => {
      const going = moving(tick.tactic.get(id));
      if (going && from === undefined) from = at;
      if (!going) close(at);
    });
    close(ticks.length);
  }
  return away;
}

/** The numbers of one ridden field. */
export function fieldNumbers(run: FieldRun, riderId: string): FieldNumbers {
  const { ticks } = run;
  const bots = [...(ticks[0]?.tactic.keys() ?? [])];
  const counts = Object.fromEntries(BOT_TACTICS.map((each) => [each, 0])) as Record<
    BotTactic,
    number
  >;
  let changes = 0;
  let leadChanges = 0;
  let leader: string | undefined;
  ticks.forEach((tick, at) => {
    for (const id of bots) {
      const tactic = tick.tactic.get(id) as BotTactic;
      counts[tactic] += 1;
      if (at > 0 && ticks[at - 1]?.tactic.get(id) !== tactic) changes += 1;
    }
    const first = bots.reduce((best, id) =>
      (tick.at.get(id) as number) > (tick.at.get(best) as number) ? id : best,
    );
    if (leader !== undefined && first !== leader) leadChanges += 1;
    leader = first;
  });
  const total = ticks.length * bots.length;
  const minutes = (ticks.length * LAP_RACE_TICK_SECONDS) / 60;
  const pack = ticks[Math.round(PACK_BY_SECONDS / LAP_RACE_TICK_SECONDS) - 1];
  const end = ticks.at(-1) as FieldTick;
  const places = [...end.at.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const botPlaces = bots.map((id) => end.at.get(id) as number);
  const movingCounts = ticks.map((tick) => bots.filter((id) => moving(tick.tactic.get(id))).length);
  const firstMoving = movingCounts.findIndex((count) => count > 0);
  return {
    tacticShare: Object.fromEntries(
      BOT_TACTICS.map((each) => [each, round(counts[each] / total)]),
    ) as Record<BotTactic, number>,
    changesPerBotMinute: round(changes / bots.length / minutes),
    awayMoves: awayMoves(ticks),
    draftingAt30s:
      pack === undefined ? 0 : bots.filter((id) => (pack.k.get(id) ?? 1) <= IN_DRAFT_K).length,
    leadChanges,
    spreadAtEndM: round(Math.max(...botPlaces) - Math.min(...botPlaces)),
    lowestWbal: round(Math.min(...ticks.flatMap((tick) => [...tick.wbal.values()]))),
    riderPlaceAtEnd: places.indexOf(riderId) + 1,
    firstMoveS: firstMoving < 0 ? null : round((ticks[firstMoving] as FieldTick).second),
    mostMovingAtOnce: Math.max(0, ...movingCounts),
    chaseStartGapsM: chaseStartGaps(ticks, bots),
  };
}
