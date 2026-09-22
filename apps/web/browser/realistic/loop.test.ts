// SPDX-License-Identifier: AGPL-3.0-or-later

import { seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  describe as describeError,
  guarded,
  MAXIMUM_FRAME_GAP_MS,
  MeasurementClock,
  readoutMs,
  RECENT_FRAMES,
} from './loop';

describe('the realistic page’s clock — #457, #430', () => {
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

describe('the realistic page’s on-screen readout — #478', () => {
  /** A clock past its warm-up, fed `frames` frames 16 ms apart. */
  function ridden(frames: number): { clock: MeasurementClock; now: number } {
    const clock = new MeasurementClock(0);
    let now = 0;
    clock.frame(now);
    for (let each = 0; each < frames; each += 1) {
      now += 16;
      clock.frame(now);
    }
    return { clock, now };
  }

  it('keeps the latest frames when the measurement window is taken — the tablet’s NaN', () => {
    // The page publishes its measurement and then takes the window EVERY frame
    // (no soak), so the window it used to read the readout from was empty at
    // every readout for the rest of the ride.
    const { clock, now } = ridden(40);
    clock.take();
    let at = now;
    for (let each = 0; each < 5; each += 1) {
      at += 16;
      clock.frame(at);
      clock.take();
    }
    expect(clock.samples).toEqual([]);
    expect(clock.recent).toHaveLength(45);
    expect(clock.recent.every((step) => step === 16)).toBe(true);
  });

  it('holds only the latest frames, oldest first', () => {
    const clock = new MeasurementClock(0);
    let now = 0;
    clock.frame(now);
    for (let each = 1; each <= RECENT_FRAMES + 10; each += 1) {
      // Each step one millisecond longer than the last, so order is visible.
      now += 10 + each;
      clock.frame(now);
    }
    const recent = clock.recent;
    expect(recent).toHaveLength(RECENT_FRAMES);
    expect(recent[0]).toBe(10 + 11);
    expect(recent[recent.length - 1]).toBe(10 + RECENT_FRAMES + 10);
  });

  it('holds nothing before the first timed frame, and says so rather than NaN', () => {
    const clock = new MeasurementClock(3);
    clock.frame(0);
    clock.frame(16);
    expect(clock.recent).toEqual([]);
    expect(readoutMs(NaN)).not.toMatch(/NaN/);
    expect(readoutMs(16.66)).toBe('16.7 ms');
  });
});

describe('the realistic page’s error guard — #457, #430', () => {
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
