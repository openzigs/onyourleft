// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The blocks of a structured workout, as the recording states them — #1319.
 *
 * A workout's blocks are its own sections: a warm-up, a set of intervals, a
 * cool-down. This module keeps, block by block, where on the ride's clock each
 * one began and ended and what became of it, and works out what was ridden in
 * it when the ride is saved.
 *
 * ## Two halves, as a lap has
 *
 * | figure | from |
 * |---|---|
 * | where the block began and ended | the ride's clock and the recorder's moving time, as the player moved into and out of it |
 * | what became of it | ridden, cut short, or never reached; and whether the stall rescue eased it |
 * | its power, heart rate and cadence | the recorded series between the two marks — the samples the save writes, by the rule a lap's are (`laps.ts` §`stretchFigures`) |
 *
 * The first two are what the recording keeps (`@onyourleft/store`
 * §`RecordedWorkoutBlock`), on its header, so a ride recovered after a crash
 * has them. The third is worked out once, by {@link workoutBlocksToSave}.
 *
 * ## Where a block begins and ends
 *
 * ⚠️ **Back-dated from the tick that sees it, by how far past the boundary the
 * workout already is.** The player is ticked about once a second, and in a
 * background tab much less often, so the tick that sees block 3 may come
 * seconds after block 3 began — or after block 3 has already ended. A
 * boundary the workout is `d` seconds past is put `d` seconds before the
 * tick's mark, on both clocks: the workout's clock and the recording's both
 * stand still while the ride is paused, and both run while it is ridden. It is
 * never put before the block in front of it began.
 *
 * ⚠️ **A block the tick jumped over is still a row**, with the marks of its
 * two boundaries, so the page never calls the fourth block the third.
 *
 * ## What is said of a block
 *
 * - **Ridden** — from its start to its end.
 * - **Cut short** — begun and not finished: the workout was ended in it, the
 *   recording ended or died in it (the block being ridden is held as cut short
 *   until it ends, so a recovered ride says so), or it had begun before the
 *   recording saw it. Its figures are over what was ridden of it.
 * - **Skipped** — the workout ended before the block came up. It has no times
 *   and no figures, so it can never read as a block ridden badly.
 * - **Eased** — beside either of the first two: the stall rescue (#441)
 *   eased the trainer at some point in the block, so its power is not the
 *   target's.
 *
 * Pure: it reads no clock and no store. `ride/controller.ts` keeps one
 * {@link BlockLog} per workout and hands the recorder its blocks.
 */

import type { PlayerStatus, Seconds, WorkoutTimeline } from '@onyourleft/domain';
import { seconds, unixSeconds } from '@onyourleft/domain';
import type { RecordedWorkoutBlock, WorkoutBlockFact } from '@onyourleft/store';

import { heldToTheRide, stretchFigures, type LapMark, type LapSeries } from './laps';

/**
 * How far past a block's start a workout begun before the recording may be
 * when the recording first sees it, and the block still count as seen from
 * its start: a tick's worth, since #45's grid is 1 Hz.
 */
export const BLOCK_SEEN_LATE_SECONDS = 1;

/** One workout's blocks so far, and the one being ridden. */
export interface BlockLog {
  /** In the order they came up. The last is the open one while {@link open} is set. */
  readonly blocks: readonly RecordedWorkoutBlock[];
  /** The plan's index of the block being ridden, or `undefined` with none open. */
  readonly open: number | undefined;
  /** The open block had begun before this log saw it, so it is cut short however it ends. */
  readonly openLate: boolean;
  /**
   * The mark this workout began at, when it began while the recording ran —
   * no block of it begins earlier. `undefined` for a workout begun before the
   * recording, whose first block is seen from the first tick and, unless that
   * tick is within {@link BLOCK_SEEN_LATE_SECONDS} of its start, is late.
   */
  readonly floor: LapMark | undefined;
  /** The workout has ended: nothing more is logged. */
  readonly ended: boolean;
}

/** A log for a workout that has not been seen yet. */
export const NO_BLOCKS: BlockLog = {
  blocks: [],
  open: undefined,
  openLate: false,
  floor: undefined,
  ended: false,
};

/** A log for a workout begun at `mark` while the recording runs. */
export function blockLogFrom(mark: LapMark): BlockLog {
  return { ...NO_BLOCKS, floor: mark };
}

/** What one tick of the workout says, read after the session's own tick. */
export interface BlockTick {
  readonly status: PlayerStatus;
  /** The plan's index of the block being ridden; `undefined` when not running. */
  readonly block: number | undefined;
  /** How far into the workout the rider is, paused time left out. */
  readonly elapsed: Seconds;
  /** The plan being ridden, whose segments say where each block begins. */
  readonly timeline: WorkoutTimeline;
  /** The stall rescue holds the target down this tick. */
  readonly eased: boolean;
  /** The recording's clock and moving time, now. */
  readonly mark: LapMark;
}

/** Where block `index` begins in `timeline`, or the workout's end past its last block. */
function blockStart(timeline: WorkoutTimeline, index: number): Seconds {
  const segment = timeline.segments.find((each) => each.block === index);
  return segment?.startsAt ?? timeline.totalSeconds;
}

/**
 * The mark of the instant the workout was at `offset`: `elapsed - offset`
 * seconds before `mark` on both clocks — never before `floor` on either.
 */
function backDated(mark: LapMark, elapsed: Seconds, offset: Seconds, floor: LapMark): LapMark {
  const behind = Math.min(
    Math.max(0, elapsed - offset),
    Math.max(0, mark.at - floor.at),
    Math.max(0, mark.movingTime - floor.movingTime),
  );
  return { at: unixSeconds(mark.at - behind), movingTime: seconds(mark.movingTime - behind) };
}

/** The log with its open block closed at `to`, as ridden unless it was late. */
function closed(log: BlockLog, to: LapMark): BlockLog {
  const last = log.blocks.at(-1);
  if (log.open === undefined || last === undefined || last.outcome === 'skipped') {
    return log;
  }
  return {
    ...log,
    blocks: [
      ...log.blocks.slice(0, -1),
      { ...last, to, outcome: log.openLate ? 'cut-short' : 'ridden' },
    ],
    open: undefined,
    openLate: false,
  };
}

/** The log with block `index` of `timeline` opened at `from`. Held as cut short until it ends. */
function opened(
  log: BlockLog,
  timeline: WorkoutTimeline,
  index: number,
  from: LapMark,
  late: boolean,
): BlockLog {
  const block = timeline.workout.blocks[index];
  if (block === undefined) {
    return log;
  }
  return {
    ...log,
    blocks: [...log.blocks, { outcome: 'cut-short', block, from, to: from }],
    open: index,
    openLate: late,
  };
}

/** The open block's `to` moved on, and eased if it is eased now. */
function extended(log: BlockLog, to: LapMark, eased: boolean): BlockLog {
  const last = log.blocks.at(-1);
  if (log.open === undefined || last === undefined || last.outcome === 'skipped') {
    return log;
  }
  return {
    ...log,
    blocks: [...log.blocks.slice(0, -1), { ...last, to, ...(eased ? { eased: true } : {}) }],
  };
}

/** The mark the open block began at, or `fallback` with none open. */
function openFrom(log: BlockLog, fallback: LapMark): LapMark {
  const last = log.blocks.at(-1);
  return log.open !== undefined && last !== undefined && last.outcome !== 'skipped'
    ? last.from
    : fallback;
}

/**
 * The log after one tick of the workout.
 *
 * Running in the block already open, that block runs on to now. Running in a
 * later block, every block from the open one up to it is closed and opened at
 * its own boundary ({@link backDated}). Finished, the open block and any
 * after it are closed at the workout's end. Paused, or not yet running,
 * nothing moves: no block is ridden while the workout stands still.
 */
export function logTick(log: BlockLog, tick: BlockTick): BlockLog {
  if (log.ended) {
    return log;
  }
  const { timeline, elapsed, mark } = tick;
  const reached =
    tick.status === 'finished'
      ? timeline.workout.blocks.length
      : tick.status === 'running'
        ? tick.block
        : undefined;
  if (reached === undefined) {
    return log;
  }
  let next = log;
  if (next.open === undefined && next.blocks.length === 0) {
    if (next.floor !== undefined) {
      // Begun while recording: its first block from its own start, and every
      // block up to the one now ridden from theirs, below.
      next = opened(next, timeline, 0, backDated(mark, elapsed, seconds(0), next.floor), false);
    } else {
      if (tick.status === 'finished') {
        return next;
      }
      // Begun before the recording: the first block it sees is from now, and
      // late unless it has only just begun.
      const late = elapsed - blockStart(timeline, reached) > BLOCK_SEEN_LATE_SECONDS;
      return extended(opened(next, timeline, reached, mark, late), mark, tick.eased);
    }
  }
  if (next.open !== undefined && reached > next.open) {
    for (let index = next.open + 1; index <= reached; index += 1) {
      const boundary = backDated(mark, elapsed, blockStart(timeline, index), openFrom(next, mark));
      next = closed(next, boundary);
      if (index < timeline.workout.blocks.length) {
        next = opened(next, timeline, index, boundary, false);
      }
    }
  }
  return tick.status === 'running' ? extended(next, mark, tick.eased) : next;
}

/**
 * The log once the workout has ended — finished, ended by the rider, replaced
 * by another, or the ride stopped. The block being ridden stays cut short,
 * run on to `mark`; every block of the plan after it is skipped. A finished
 * workout has nothing open, and nothing after it.
 *
 * `timeline` is the plan the rest would have been ridden from — a revision
 * waiting for the next block's boundary included, as the ride screen shows it.
 */
export function logEnd(log: BlockLog, timeline: WorkoutTimeline, mark: LapMark): BlockLog {
  if (log.ended) {
    return log;
  }
  if (log.open === undefined) {
    return { ...log, ended: true };
  }
  const run = extended(log, mark, false);
  const skipped: RecordedWorkoutBlock[] = timeline.workout.blocks
    .slice(log.open + 1)
    .map((block) => ({ outcome: 'skipped', block }));
  return {
    ...run,
    blocks: [...run.blocks, ...skipped],
    open: undefined,
    openLate: false,
    ended: true,
  };
}

/**
 * The block entries to save with a ride, in the order they came up, worked
 * out from `series` — the samples the save writes.
 *
 * ⚠️ **Their moving times are held to `rideMovingTime`**, by the walk a lap's
 * are (`laps.ts` §`heldToTheRide`), so no block says it moved for longer than
 * the ride did. A skipped block has no marks and is not in the walk.
 */
export function workoutBlocksToSave(
  recorded: readonly RecordedWorkoutBlock[],
  series: LapSeries,
  rideMovingTime: Seconds,
): readonly WorkoutBlockFact[] {
  const ridden = recorded.flatMap((entry) => (entry.outcome === 'skipped' ? [] : [entry]));
  const held = heldToTheRide(ridden, rideMovingTime);
  let next = 0;
  return recorded.map((entry): WorkoutBlockFact => {
    if (entry.outcome === 'skipped') {
      return { outcome: 'skipped', block: entry.block };
    }
    const stretch = held[next] ?? entry;
    next += 1;
    return {
      outcome: entry.outcome,
      block: entry.block,
      ...(entry.eased === true ? { eased: true as const } : {}),
      ...stretchFigures(series, stretch.from, stretch.to),
    };
  });
}
