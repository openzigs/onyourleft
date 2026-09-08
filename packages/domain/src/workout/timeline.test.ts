// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { seconds, type Seconds } from '../quantities';

import { expandWorkout, segmentAt, targetAt } from './timeline';
import { thresholdShare, type SteadyBlock, type Workout, type WorkoutBlock } from './workout';

const steady = (length: number, share: number, label?: string): SteadyBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
  ...(label === undefined ? {} : { label }),
});

const workout = (blocks: readonly WorkoutBlock[]): Workout => ({ name: 'Test', blocks });

describe('expansion', () => {
  it('lays blocks end to end with no gap and no overlap', () => {
    const { segments, totalSeconds } = expandWorkout(
      workout([steady(600, 0.6), steady(300, 0.9), steady(120, 0.5)]),
    );
    expect(segments.map((s) => [s.startsAt, s.endsAt])).toEqual([
      [0, 600],
      [600, 900],
      [900, 1020],
    ]);
    expect(totalSeconds).toBe(1020);
  });

  it('turns an intervals block into two segments per repeat', () => {
    const { segments, totalSeconds } = expandWorkout(
      workout([
        {
          kind: 'intervals',
          repeats: 6,
          hardSeconds: seconds(180),
          hardTarget: thresholdShare(1.05),
          easySeconds: seconds(180),
          easyTarget: thresholdShare(0.6),
        },
      ]),
    );
    expect(segments).toHaveLength(12);
    expect(totalSeconds).toBe(6 * 360);
  });

  it('ends an intervals block on the easy interval, so 6 × means six', () => {
    // A rider wanting to finish on the hard effort writes a steady recovery
    // after the block. Dropping the final easy interval here would make the
    // arithmetic on the screen stop matching the clock.
    const { segments } = expandWorkout(
      workout([
        {
          kind: 'intervals',
          repeats: 2,
          hardSeconds: seconds(60),
          hardTarget: thresholdShare(1.2),
          easySeconds: seconds(30),
          easyTarget: thresholdShare(0.5),
        },
      ]),
    );
    expect(segments.map((s) => s.from)).toEqual([1.2, 0.5, 1.2, 0.5]);
  });

  it('keeps a ramp as ONE segment rather than expanding it into steps', () => {
    // Expanding a ten-minute ramp into 600 one-second segments would make the
    // timeline the size of the ride and quantise a smooth target into stairs.
    const { segments } = expandWorkout(
      workout([
        { kind: 'ramp', seconds: seconds(600), from: thresholdShare(0.4), to: thresholdShare(0.9) },
      ]),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.from).toBe(0.4);
    expect(segments[0]?.to).toBe(0.9);
  });

  it('carries the block index so a screen can group segments back up', () => {
    const { segments } = expandWorkout(
      workout([
        steady(60, 0.5),
        {
          kind: 'intervals',
          repeats: 2,
          hardSeconds: seconds(60),
          hardTarget: thresholdShare(1.2),
          easySeconds: seconds(30),
          easyTarget: thresholdShare(0.5),
        },
      ]),
    );
    expect(segments.map((s) => s.block)).toEqual([0, 1, 1, 1, 1]);
  });

  it('validates before it expands, rather than trusting its caller', () => {
    expect(() => expandWorkout(workout([]))).toThrow(/at least one block/);
  });
});

describe('looking up a segment', () => {
  const timeline = expandWorkout(
    workout([steady(600, 0.6, 'Warm up'), steady(300, 0.9, 'Effort'), steady(120, 0.5, 'Ease')]),
  );

  it('owns its start and not its end, so a boundary belongs to one segment', () => {
    // 600 is the second segment's, not the first's. Without this a player at a
    // boundary would see two targets and write whichever it found first.
    expect(segmentAt(timeline, seconds(599))?.label).toBe('Warm up');
    expect(segmentAt(timeline, seconds(600))?.label).toBe('Effort');
  });

  it('finds a segment in the middle without walking the array', () => {
    expect(segmentAt(timeline, seconds(750))?.label).toBe('Effort');
  });

  it('returns nothing at or past the end', () => {
    expect(segmentAt(timeline, timeline.totalSeconds)).toBeUndefined();
    expect(segmentAt(timeline, seconds(99_999))).toBeUndefined();
  });

  it('returns nothing before the start, which only a cast can reach', () => {
    // `seconds()` refuses a negative, so a negative offset does not exist
    // through the public constructors — the cast is how the case is reached at
    // all. Asserted because the binary search is what answers it: there is no
    // separate range guard to fall back on.
    expect(() => seconds(-1)).toThrow();
    expect(segmentAt(timeline, -1 as Seconds)).toBeUndefined();
  });

  it('agrees with a linear scan at every second of the workout', () => {
    // The binary search is an optimisation, and an optimisation that disagrees
    // with the obvious implementation is a bug. This is the check that the
    // clever version is the same function.
    for (let at = 0; at < timeline.totalSeconds; at += 1) {
      const scanned = timeline.segments.find(
        (segment) => at >= segment.startsAt && at < segment.endsAt,
      );
      expect(segmentAt(timeline, seconds(at))).toBe(scanned);
    }
  });
});

describe('the target at an instant', () => {
  it('is the steady target throughout a steady segment', () => {
    const timeline = expandWorkout(workout([steady(600, 0.6)]));
    expect(targetAt(timeline, seconds(0))).toBe(0.6);
    expect(targetAt(timeline, seconds(599))).toBe(0.6);
  });

  it('interpolates linearly through a ramp', () => {
    const timeline = expandWorkout(
      workout([
        { kind: 'ramp', seconds: seconds(100), from: thresholdShare(0.4), to: thresholdShare(0.9) },
      ]),
    );
    expect(targetAt(timeline, seconds(0))).toBeCloseTo(0.4, 10);
    expect(targetAt(timeline, seconds(50))).toBeCloseTo(0.65, 10);
    expect(targetAt(timeline, seconds(99))).toBeCloseTo(0.895, 10);
  });

  it('is undefined during a free ride — release, not a target of zero', () => {
    // A free ride is where the player releases the trainer. ERG with a small
    // target is the one place a rider cannot simply push harder, and a warm-down
    // nobody can push through is unpleasant.
    const timeline = expandWorkout(workout([{ kind: 'free-ride', seconds: seconds(300) }]));
    expect(targetAt(timeline, seconds(150))).toBeUndefined();
    expect(segmentAt(timeline, seconds(150))).toBeDefined();
  });

  it('is undefined past the end', () => {
    const timeline = expandWorkout(workout([steady(60, 0.6)]));
    expect(targetAt(timeline, seconds(60))).toBeUndefined();
  });

  it('takes no state, so the same offset gives the same answer whatever came before', () => {
    // The bug a cursor would have: a paused-and-resumed workout writing a
    // different number from a fresh one at the same offset.
    const timeline = expandWorkout(
      workout([
        steady(60, 0.6),
        { kind: 'ramp', seconds: seconds(60), from: thresholdShare(0.6), to: thresholdShare(1) },
      ]),
    );
    const forwards = [0, 30, 60, 90, 119].map((at) => targetAt(timeline, seconds(at)));
    const backwards = [119, 90, 60, 30, 0].map((at) => targetAt(timeline, seconds(at))).reverse();
    expect(forwards).toEqual(backwards);
  });
});
