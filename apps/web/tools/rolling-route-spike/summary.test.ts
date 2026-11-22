// SPDX-License-Identifier: AGPL-3.0-or-later

/** #2882: the arithmetic behind the write-up's frame tables. */

import { describe, expect, it } from 'vitest';

import {
  around,
  frameStats,
  outside,
  percentile,
  summariseRun,
  type FrameRecord,
  type SpikeRun,
} from './summary';

/** Frames 1/60 s apart from 0 to `ms`, with `slow` gaps of 50 ms at the times given. */
function frames(ms: number, slow: readonly number[] = []): FrameRecord[] {
  const out: FrameRecord[] = [];
  let at = 0;
  while (at < ms) {
    const gap = slow.some((when) => Math.abs(when - at) < 8) ? 50 : 1000 / 60;
    at += gap;
    out.push({ at, gapMs: gap, cpuMs: gap === 50 ? 40 : 4, calls: 30, triangles: 1_000 });
  }
  return out;
}

describe('the frame summary (#2882)', () => {
  it('takes the nearest-rank percentile', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('counts a 50 ms gap at 60 Hz as two dropped frames, and only in the spans asked about', () => {
    const ride = frames(10_000, [5_000]);
    const turns = around([5_000], 1_500);
    const atTurns = frameStats(ride, [], 1000 / 60, turns);
    expect(atTurns.dropped).toBe(2);
    expect(atTurns.maxMs).toBe(50);
    expect(atTurns.cpuP95Ms).toBeLessThan(40);
    expect(atTurns.cpuMaxMs).toBe(40);
    const steady = frameStats(ride, [], 1000 / 60, outside({ from: 0, to: 10_100 }, turns));
    expect(steady.dropped).toBe(0);
    expect(steady.p95Ms).toBeCloseTo(16.7, 1);
    expect(steady.frames + atTurns.frames).toBe(ride.length);
  });

  it('counts the long tasks that start inside the spans', () => {
    const tasks = [
      { at: 4_900, durationMs: 120 },
      { at: 8_000, durationMs: 60 },
    ];
    const stats = frameStats(frames(10_000), tasks, 1000 / 60, around([5_000], 1_500));
    expect(stats.longTasks).toBe(1);
    expect(stats.longTaskMaxMs).toBe(120);
  });

  it('leaves out the spans, merged where they overlap', () => {
    expect(
      outside({ from: 0, to: 100 }, [
        { from: 20, to: 40 },
        { from: 30, to: 50 },
      ]),
    ).toEqual([
      { from: 0, to: 20 },
      { from: 50, to: 100 },
    ]);
    // A span inside another leaves nothing of the outer one's end.
    expect(
      outside({ from: 0, to: 100 }, [
        { from: 20, to: 60 },
        { from: 30, to: 50 },
      ]),
    ).toEqual([
      { from: 0, to: 20 },
      { from: 60, to: 100 },
    ]);
  });

  it('summarises a run: the stall at the swap, none in the steady ride, and the start plan left out', () => {
    const plan = (latencyMs: number) => ({
      at: 0,
      mode: 'main' as const,
      plans: 10,
      buildingsHeld: 12,
      timings: { corridorMs: 0, landMs: 1, urbanMs: 1, plansMs: latencyMs - 2 },
      mainMs: latencyMs,
      latencyMs,
    });
    const run: SpikeRun = {
      ready: true,
      done: true,
      config: {},
      displayMs: 1000 / 60,
      rideFrom: 0,
      rideTo: 10_000,
      frames: frames(10_000, [5_000]),
      longTasks: [{ at: 4_990, durationMs: 50 }],
      swaps: [5_000],
      junctions: [8_000],
      plans: [plan(900), plan(40)],
      blocks: [{ at: 0, key: 1, readMs: 300, decodeMs: 2, bytes: 2048, tiles: 1, buildings: 5 }],
      tilesAsked: 1,
    };
    const summed = summariseRun(run);
    expect(summed.atSwaps.dropped).toBe(2);
    expect(summed.atSwaps.longTasks).toBe(1);
    expect(summed.steady.dropped).toBe(0);
    expect(summed.atCorners.dropped).toBe(0);
    expect(summed.plans.count).toBe(1);
    expect(summed.plans.latencyMsMax).toBe(40);
    expect(summed.blocks.tilesPerHour).toBe(360);
    expect(summed.blocks.kibMax).toBe(2);
  });
});
