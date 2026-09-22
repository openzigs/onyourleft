// SPDX-License-Identifier: AGPL-3.0-or-later

import { seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { describe as describeError, guarded, MAXIMUM_FRAME_GAP_MS, MeasurementClock } from './loop';

describe('the realism page’s clock — #457', () => {
  it('never hands out a negative elapsed time, whatever order the timestamps arrive in', () => {
    // The tablet's failure: a timestamp earlier than the origin it was
    // measured against. Here a frame goes backwards by 2.1 ms, as it did there.
    const clock = new MeasurementClock(3);
    const times = [1_000, 997.9, 1_016.7, 1_010, 1_033.4];
    for (const now of times) {
      const { elapsedSeconds } = clock.frame(now);
      expect(elapsedSeconds).toBeGreaterThanOrEqual(0);
      // What the harness then does with it, and what threw on the device.
      expect(() => seconds(elapsedSeconds)).not.toThrow();
    }
  });

  it('samples no negative step, and measures the next one from the latest frame seen', () => {
    const clock = new MeasurementClock(0);
    for (const now of [0, 16, 14, 32]) clock.frame(now);
    expect(clock.take().samples).toEqual([16, 16]);
  });

  it('needs more than one frame in a window, however long that one frame was', () => {
    const clock = new MeasurementClock(0);
    clock.frame(0);
    clock.frame(MAXIMUM_FRAME_GAP_MS);
    expect(clock.samples).toEqual([MAXIMUM_FRAME_GAP_MS]);
    expect(clock.windowFull(1)).toBe(false);
  });

  it('counts the warm-up from the first frame drawn, and samples nothing before it ends', () => {
    const clock = new MeasurementClock(3);
    expect(clock.frame(50_000)).toEqual({ elapsedSeconds: 0, sampledMs: undefined });
    let now = 50_000;
    while (now + 16 <= 53_000) {
      now += 16;
      expect(clock.frame(now).sampledMs).toBeUndefined();
    }
    expect(clock.frame(now + 16).sampledMs).toBe(16);
  });

  it('counts a gap too long to be a frame as a stall, and never samples it', () => {
    const clock = new MeasurementClock(0);
    clock.frame(0);
    clock.frame(16);
    expect(clock.frame(16 + MAXIMUM_FRAME_GAP_MS + 1).sampledMs).toBeUndefined();
    clock.frame(16 + MAXIMUM_FRAME_GAP_MS + 17);
    const taken = clock.take();
    expect(taken.stalls).toBe(1);
    expect(taken.samples).toEqual([16, 16]);
  });

  it('does not call one 43-second sample a measurement', () => {
    // The baseline's only published figure on the tablet: `{p50: 43530, count: 1}`.
    const clock = new MeasurementClock(3);
    clock.frame(0);
    clock.frame(43_530);
    expect(clock.windowFull(30)).toBe(false);
    expect(clock.take()).toEqual({ samples: [], stalls: 1 });
  });

  it('is full once it has sampled the window, with more than one frame in it', () => {
    const clock = new MeasurementClock(0);
    clock.frame(0);
    let now = 0;
    while (!clock.windowFull(1)) {
      now += 16;
      clock.frame(now);
    }
    expect(clock.samples.length).toBe(63);
    expect(clock.take().samples.reduce((sum, each) => sum + each, 0)).toBeGreaterThanOrEqual(1_000);
    expect(clock.samples).toEqual([]);
  });
});

describe('the realism page’s error guard — #457', () => {
  it('reports what a frame threw instead of letting it escape, and stops the loop', () => {
    const reported: string[] = [];
    const step = guarded(
      (elapsed: number) => {
        seconds(elapsed);
      },
      (message) => reported.push(message),
    );
    expect(step(1)).toBe(true);
    expect(() => step(-0.0021)).not.toThrow();
    expect(step(-0.0021)).toBe(false);
    expect(reported).toHaveLength(2);
    expect(reported[0]).toMatch(/^UnitError: duration in seconds must not be negative/);
  });

  it('describes something thrown that is not an Error', () => {
    expect(describeError('plain')).toBe('plain');
    expect(describeError(new Error('bare'))).toBe('bare');
  });
});
