// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ring behind the HUD's recent graph — #2078: bounded, once a second, and
 * a gap where a sensor dropped.
 */

import { describe, expect, it } from 'vitest';

import { createRecentTrace, RECENT_TRACE_SECONDS, sampleSecond } from './recent-trace';

const live = (power: number, heartRate: number) => ({ power, heartRate });

describe('the recent trace (#2078)', () => {
  it('holds ten minutes, and never more however long the ride', () => {
    expect(RECENT_TRACE_SECONDS).toBe(600);
    const trace = createRecentTrace();
    for (let second = 0; second < 4 * 3600; second += 1) {
      trace.write(second, live(200 + (second % 50), 140));
    }
    expect(trace.capacity).toBe(RECENT_TRACE_SECONDS);
    expect(trace.written).toBe(4 * 3600);
    const held = trace.read();
    expect(held).toHaveLength(RECENT_TRACE_SECONDS);
    // The newest last, and the oldest held the one ten minutes before it.
    expect(held.at(-1)?.power).toBe(200 + ((4 * 3600 - 1) % 50));
    expect(held[0]?.power).toBe(200 + ((4 * 3600 - RECENT_TRACE_SECONDS) % 50));
  });

  it('holds what it was given, oldest first, before the ring is full', () => {
    const trace = createRecentTrace(5);
    trace.write(0, live(100, 120));
    trace.write(1, live(110, 121));
    expect(trace.read()).toEqual([live(100, 120), live(110, 121)]);
  });

  it('keeps a dropped reading as a gap, never a zero', () => {
    const trace = createRecentTrace(5);
    trace.write(0, live(100, 120));
    trace.write(1, { power: undefined, heartRate: 121 });
    trace.write(2, { power: 0, heartRate: undefined });
    expect(trace.read()).toEqual([
      live(100, 120),
      { power: undefined, heartRate: 121 },
      // A real nought — the rider stopped pedalling — is a reading, and kept.
      { power: 0, heartRate: undefined },
    ]);
  });

  it('fills seconds a ride skipped with gaps, and never more than a ring of them', () => {
    const trace = createRecentTrace(5);
    trace.write(0, live(100, 120));
    trace.write(3, live(130, 123));
    expect(trace.read().map((each) => each.power)).toEqual([100, undefined, undefined, 130]);
    trace.write(1_000, live(140, 124));
    expect(trace.read()).toHaveLength(5);
    expect(trace.read().map((each) => each.power)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      140,
    ]);
  });

  it('writes nothing for a second it has written or one before it', () => {
    const trace = createRecentTrace(5);
    trace.write(4, live(100, 120));
    trace.write(4, live(999, 999));
    trace.write(2, live(999, 999));
    expect(trace.read()).toEqual([live(100, 120)]);
    expect(trace.second).toBe(4);
  });
});

describe('sampling once a second (#2078)', () => {
  it('samples a frame only when it crosses a whole second of the ride’s clock', () => {
    // Sixty frames a second for three seconds: three samples, never sixty.
    let last = -1;
    let written = 0;
    for (let frame = 0; frame < 180; frame += 1) {
      const second = sampleSecond(last, frame / 60);
      if (second !== undefined) {
        written += 1;
        last = second;
      }
    }
    expect(written).toBe(3);
    expect(last).toBe(2);
  });

  it('samples nothing while the clock stands still, as a paused ride’s does', () => {
    expect(sampleSecond(5, 5.9)).toBeUndefined();
    expect(sampleSecond(5, 6)).toBe(6);
    expect(sampleSecond(-1, Number.NaN)).toBeUndefined();
  });
});
