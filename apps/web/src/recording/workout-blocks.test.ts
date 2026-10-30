// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  expandWorkout,
  seconds,
  unixSeconds,
  watts,
  type PlayerStatus,
  type ThresholdShare,
  type Workout,
} from '@onyourleft/domain';
import type { RecordedWorkoutBlock } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import type { LapMark } from './laps';
import {
  blockLogFrom,
  logEnd,
  logTick,
  NO_BLOCKS,
  workoutBlocksToSave,
  type BlockLog,
} from './workout-blocks';

const share = (value: number): ThresholdShare => value as ThresholdShare;

const WARM_UP = { kind: 'steady', seconds: seconds(60), target: share(0.6) } as const;
const EFFORTS = {
  kind: 'intervals',
  repeats: 2,
  hardSeconds: seconds(30),
  hardTarget: share(1.1),
  easySeconds: seconds(30),
  easyTarget: share(0.5),
} as const;
const COOL_DOWN = { kind: 'free-ride', seconds: seconds(60) } as const;
const WORKOUT: Workout = { name: 'Over-unders', blocks: [WARM_UP, EFFORTS, COOL_DOWN] };
/** Blocks begin at 0, 60 and 180 s; the workout ends at 240 s. */
const TIMELINE = expandWorkout(WORKOUT);

const T0 = 1_700_000_000;
/** The recording's mark `t` seconds in, with `paused` seconds of it not moving. */
const mark = (t: number, paused = 0): LapMark => ({
  at: unixSeconds(T0 + t),
  movingTime: seconds(t - paused),
});

/** The block the player is in at `elapsed` seconds into the workout. */
function blockAt(elapsed: number): number {
  return TIMELINE.segments.find((each) => elapsed >= each.startsAt && elapsed < each.endsAt)!.block;
}

/** One tick, at `elapsed` seconds into the workout and the recording's mark `at`. */
function tick(
  log: BlockLog,
  elapsed: number,
  at: LapMark,
  options: { status?: PlayerStatus; eased?: boolean } = {},
): BlockLog {
  const status = options.status ?? (elapsed >= TIMELINE.totalSeconds ? 'finished' : 'running');
  return logTick(log, {
    status,
    block: status === 'running' ? blockAt(elapsed) : undefined,
    elapsed: seconds(Math.min(elapsed, TIMELINE.totalSeconds)),
    timeline: TIMELINE,
    eased: options.eased ?? false,
    mark: at,
  });
}

/** A workout begun `offset` s into the recording, ticked every second to `to` s into it. */
function riddenTo(to: number, offset = 10, eased?: (elapsed: number) => boolean): BlockLog {
  let log = blockLogFrom(mark(offset));
  for (let elapsed = 1; elapsed <= to; elapsed += 1) {
    log = tick(log, elapsed, mark(offset + elapsed), { eased: eased?.(elapsed) ?? false });
  }
  return log;
}

const span = (from: number, to: number) => ({ from: mark(from), to: mark(to) });

describe('a workout begun while recording — #1319', () => {
  it('ridden to its end is three blocks ridden, each from its own start to its own end', () => {
    const log = riddenTo(241);
    expect(log.blocks).toEqual([
      { outcome: 'ridden', block: WARM_UP, ...span(10, 70) },
      { outcome: 'ridden', block: EFFORTS, ...span(70, 190) },
      { outcome: 'ridden', block: COOL_DOWN, ...span(190, 250) },
    ]);
    expect(log.open).toBeUndefined();
  });

  it('holds the block being ridden as cut short, run on to now — what a crash recovers', () => {
    const log = riddenTo(100);
    expect(log.blocks).toEqual([
      { outcome: 'ridden', block: WARM_UP, ...span(10, 70) },
      { outcome: 'cut-short', block: EFFORTS, ...span(70, 110) },
    ]);
    expect(log.open).toBe(1);
  });

  it('ended early: the block being ridden is cut short and every block after it skipped', () => {
    const log = logEnd(riddenTo(100), TIMELINE, mark(111));
    expect(log.blocks).toEqual([
      { outcome: 'ridden', block: WARM_UP, ...span(10, 70) },
      { outcome: 'cut-short', block: EFFORTS, ...span(70, 111) },
      { outcome: 'skipped', block: COOL_DOWN },
    ]);
    // And nothing after the end moves it.
    expect(tick(log, 200, mark(300))).toBe(log);
  });

  it('ended after it finished: nothing is cut short and nothing skipped', () => {
    const finished = riddenTo(241);
    expect(logEnd(finished, TIMELINE, mark(260)).blocks).toEqual(finished.blocks);
  });

  it('marks the block the stall rescue eased, and only that block', () => {
    const log = riddenTo(241, 10, (elapsed) => elapsed > 90 && elapsed < 95);
    expect(log.blocks.map((each) => (each as { eased?: true }).eased)).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });

  it('back-dates a boundary a late tick saw, and keeps a block the tick jumped over', () => {
    // A background tab: one tick at 5 s, then none until 200 s — past the
    // whole of the second block.
    let log = tick(blockLogFrom(mark(10)), 5, mark(15));
    log = tick(log, 200, mark(210));
    expect(log.blocks).toEqual([
      { outcome: 'ridden', block: WARM_UP, ...span(10, 70) },
      { outcome: 'ridden', block: EFFORTS, ...span(70, 190) },
      { outcome: 'cut-short', block: COOL_DOWN, ...span(190, 210) },
    ]);
  });

  it('moves nothing while the workout stands still, and the pause is in no block’s moving time', () => {
    let log = riddenTo(30);
    const before = log;
    // The ride paused for 100 s at 40 s in: the workout is paused, nothing moves.
    log = tick(log, 30, mark(90), { status: 'paused' });
    expect(log).toBe(before);
    // Resumed: the workout is 31 s in, the recording 141 s in with 100 s paused.
    for (let elapsed = 31; elapsed <= 61; elapsed += 1) {
      log = tick(log, elapsed, mark(110 + elapsed, 100));
    }
    expect(log.blocks[0]).toEqual({
      outcome: 'ridden',
      block: WARM_UP,
      from: mark(10),
      to: mark(170, 100),
    });
  });
});

describe('a workout begun before the recording — #1319', () => {
  it('cuts short the block the recording came in on, and rides the rest whole', () => {
    // The recording starts with the workout 30 s into its warm-up.
    let log = NO_BLOCKS;
    for (let elapsed = 30; elapsed <= 100; elapsed += 1) {
      log = tick(log, elapsed, mark(elapsed - 30));
    }
    expect(log.blocks).toEqual([
      { outcome: 'cut-short', block: WARM_UP, ...span(0, 30) },
      { outcome: 'cut-short', block: EFFORTS, ...span(30, 70) },
    ]);
    expect(logEnd(log, TIMELINE, mark(70)).blocks.at(-1)).toEqual({
      outcome: 'skipped',
      block: COOL_DOWN,
    });
    log = tick(log, 181, mark(151));
    expect(log.blocks[1]).toEqual({ outcome: 'ridden', block: EFFORTS, ...span(30, 150) });
  });

  it('counts a block seen within a tick of its start as seen from its start', () => {
    const log = tick(NO_BLOCKS, 1, mark(1));
    expect(tick(log, 61, mark(61)).blocks[0]).toEqual({
      outcome: 'ridden',
      block: WARM_UP,
      ...span(1, 60),
    });
  });

  it('logs nothing for a workout that had finished before the recording saw it', () => {
    expect(tick(NO_BLOCKS, 240, mark(5)).blocks).toEqual([]);
  });
});

describe('workoutBlocksToSave — #1319', () => {
  const series = {
    startedAt: unixSeconds(T0),
    sampleInterval: seconds(1),
    sampleCount: 260,
    channels: {
      // 100 W through the warm-up, 300 W after; one dropout, which counts as nothing.
      power: Array.from({ length: 260 }, (_, index) =>
        index === 20 ? undefined : watts(index < 70 ? 100 : 300),
      ),
    },
  };

  it('works each ridden block out from the samples between its marks, by the lap rule', () => {
    const recorded: RecordedWorkoutBlock[] = [
      { outcome: 'ridden', block: WARM_UP, ...span(10, 70) },
      { outcome: 'cut-short', block: EFFORTS, eased: true, ...span(70, 111) },
      { outcome: 'skipped', block: COOL_DOWN },
    ];
    expect(workoutBlocksToSave(recorded, series, seconds(250))).toEqual([
      {
        outcome: 'ridden',
        block: WARM_UP,
        startedAt: T0 + 10,
        elapsedTime: 60,
        movingTime: 60,
        averagePower: 100,
        maxPower: 100,
      },
      {
        outcome: 'cut-short',
        block: EFFORTS,
        eased: true,
        startedAt: T0 + 70,
        elapsedTime: 41,
        movingTime: 41,
        averagePower: 300,
        maxPower: 300,
      },
      { outcome: 'skipped', block: COOL_DOWN },
    ]);
  });

  it('holds the blocks’ moving times to the ride’s', () => {
    const recorded: RecordedWorkoutBlock[] = [
      { outcome: 'ridden', block: WARM_UP, ...span(10, 70) },
      { outcome: 'ridden', block: EFFORTS, ...span(70, 190) },
    ];
    const saved = workoutBlocksToSave(recorded, series, seconds(150));
    expect(saved.map((each) => ('movingTime' in each ? each.movingTime : undefined))).toEqual([
      60, 80,
    ]);
  });
});
