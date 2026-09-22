// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The frame cap, applied — #476. @see frame-pacer.ts
 */

import { describe, expect, it } from 'vitest';

import { FramePacer, INVALID_CAP_READ_AS, honouredCap, type PacedFrame } from './frame-pacer';
import {
  DISPLAY_RATE,
  FRAME_MS_REDUCE_ABOVE,
  FRAME_MS_RESTORE_BELOW,
  QUALITY_LADDER,
  SUSTAINED_SAMPLES,
} from './quality';

const VSYNC_MS = 1000 / 60;

/** `seconds` of a 60 Hz display under one cap, with a jitter of up to ±0.4 ms. */
function ride(
  cap: number,
  seconds: number,
  cost: (drawn: boolean) => number = () => 0,
): PacedFrame[] {
  const pacer = new FramePacer();
  const frames: PacedFrame[] = [];
  let at = 1_000;
  for (let vsync = 0; vsync < seconds * 60; vsync += 1) {
    const jitter = ((vsync * 7919) % 9) / 10 - 0.4;
    const frame = pacer.frame(at + jitter, cap);
    frames.push(frame);
    // A drawn frame that costs more than a vsync delays the next animation frame.
    at += Math.ceil(Math.max(VSYNC_MS, cost(frame.draw)) / VSYNC_MS) * VSYNC_MS;
  }
  return frames;
}

const drawn = (frames: readonly PacedFrame[]): number => frames.filter((each) => each.draw).length;

describe('the frame cap, applied — #476', () => {
  it('draws every animation frame at the display’s rate, and never more', () => {
    expect(drawn(ride(DISPLAY_RATE, 10))).toBe(600);
  });

  it('draws 30, 24 and 20 a second on a 60 Hz display', () => {
    expect(drawn(ride(30, 10))).toBe(300);
    // Carried forward from when each was due: two and three vsyncs alternate.
    // Measured from the last draw instead, this would be 200 — 20 fps.
    expect(drawn(ride(24, 10))).toBeGreaterThanOrEqual(239);
    expect(drawn(ride(24, 10))).toBeLessThanOrEqual(241);
    expect(drawn(ride(20, 10))).toBe(200);
  });

  it('draws what each rung of the ladder caps it at, and each capped rung draws fewer', () => {
    // #482: the top two rungs both draw at the display's rate.
    const counts = QUALITY_LADDER.map((rung) => drawn(ride(rung.frameCap, 10)));
    expect(counts).toEqual([600, 600, 300, expect.any(Number) as number, 200]);
    for (let level = 2; level < counts.length; level += 1) {
      expect(counts[level] ?? 0, QUALITY_LADDER[level]?.label).toBeLessThan(counts[level - 1] ?? 0);
    }
  });

  it('does not catch up with a burst after a stall', () => {
    const pacer = new FramePacer();
    expect(pacer.frame(0, 30).draw).toBe(true);
    expect(pacer.frame(33.4, 30).draw).toBe(true);
    // Half a second of nothing, then the display resumes.
    expect(pacer.frame(533.4, 30).draw).toBe(true);
    expect(pacer.frame(550, 30).draw).toBe(false);
    expect(pacer.frame(566.7, 30).draw).toBe(true);
  });

  it('follows a change of cap on the next frame', () => {
    const pacer = new FramePacer();
    let at = 0;
    const next = (cap: number): boolean => {
      at += VSYNC_MS;
      return pacer.frame(at, cap).draw;
    };
    expect([next(DISPLAY_RATE), next(DISPLAY_RATE), next(DISPLAY_RATE)]).toEqual([
      true,
      true,
      true,
    ]);
    expect([next(20), next(20), next(20), next(20)]).toEqual([true, false, false, true]);
    expect([next(DISPLAY_RATE), next(DISPLAY_RATE)]).toEqual([true, true]);
  });
});

describe('what the ladder is told under a cap — #476', () => {
  it('reports nothing after a skipped frame, so a skipped frame never reads as a fast one', () => {
    const frames = ride(30, 2);
    frames.forEach((frame, index) => {
      const previous = frames[index - 1];
      if (previous === undefined || !previous.draw) expect(frame.frameMs).toBeUndefined();
      else expect(frame.frameMs).toBeDefined();
    });
  });

  it('reads a cheap frame as cheap under every cap, not as the cap itself', () => {
    // 20 fps is 50 ms between drawn frames — over the reduce threshold. What is
    // sampled is the gap that FOLLOWS a drawn frame, which is a vsync.
    for (const cap of [DISPLAY_RATE, 30, 24, 20]) {
      const samples = ride(cap, 2)
        .map((frame) => frame.frameMs)
        .filter((ms): ms is number => ms !== undefined);
      expect(samples.length).toBeGreaterThan(30);
      expect(Math.max(...samples), String(cap)).toBeLessThan(FRAME_MS_RESTORE_BELOW);
    }
  });

  it('reads an expensive drawn frame as expensive under every cap', () => {
    // A drawn frame that holds the thread for 60 ms, whatever the cap.
    for (const cap of [DISPLAY_RATE, 30, 24, 20]) {
      const samples = ride(cap, 3, (drew) => (drew ? 60 : 0))
        .map((frame) => frame.frameMs)
        .filter((ms): ms is number => ms !== undefined);
      expect(samples.length).toBeGreaterThan(10);
      expect(Math.min(...samples), String(cap)).toBeGreaterThan(FRAME_MS_REDUCE_ABOVE);
    }
  });
});

describe('a cap that is not a frame rate fails closed — #482', () => {
  it('reads 0, a negative number, NaN and −∞ as the floor rung’s cap, not as uncapped', () => {
    // #481's review, finding 3: these all used to draw every animation frame.
    const floor = QUALITY_LADDER[QUALITY_LADDER.length - 1]?.frameCap;
    expect(INVALID_CAP_READ_AS).toBe(floor);
    expect(INVALID_CAP_READ_AS).toBe(20);
    for (const cap of [0, -0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(honouredCap(cap), String(cap)).toBe(INVALID_CAP_READ_AS);
      expect(drawn(ride(cap, 10)), String(cap)).toBe(drawn(ride(INVALID_CAP_READ_AS, 10)));
    }
    expect(drawn(ride(Number.NaN, 10))).toBe(200);
  });

  it('leaves every cap that is a frame rate as it is', () => {
    expect(honouredCap(DISPLAY_RATE)).toBe(DISPLAY_RATE);
    for (const rung of QUALITY_LADDER) expect(honouredCap(rung.frameCap)).toBe(rung.frameCap);
    expect(honouredCap(0.5)).toBe(0.5);
  });

  it('rests on the ladder holding a finite cap at all, which is asserted rather than assumed — #485', () => {
    // ⚠️ #484's review, finding 2: "fails closed" is a property of this
    // ladder rather than of the expression. `Math.min()` over an empty list is
    // `Infinity`, and `Infinity` IS `DISPLAY_RATE` — so a ladder whose every
    // rung drew at the display's rate would make the invalid-cap fallback mean
    // "uncapped" and fail OPEN again, by the arithmetic that was meant to close
    // it. The top two rungs are already `DISPLAY_RATE` (#482); this is what
    // makes the day the last finite one leaves a red build rather than a hot
    // device drawing every frame.
    expect(Number.isFinite(INVALID_CAP_READ_AS)).toBe(true);
    expect(QUALITY_LADDER.some((rung) => Number.isFinite(rung.frameCap))).toBe(true);
    // And the fallback is not the thing it exists to avoid.
    expect(INVALID_CAP_READ_AS).not.toBe(DISPLAY_RATE);
  });
});

describe('how long the ladder takes to react, rung by rung — #482', () => {
  it('takes SUSTAINED_SAMPLES drawn frames, which is 0.5, 0.5, 1.0, 1.25 and 1.5 s on a 60 Hz display', () => {
    // #481's review, finding 2, and `quality.ts` §`SUSTAINED_SAMPLES` is the
    // decision: the window is a count of DRAWN frames, so it lengthens as the
    // cap falls. This pins the table written there.
    const seconds = QUALITY_LADDER.map((rung) => {
      const frames = ride(rung.frameCap, 5);
      let samples = 0;
      const vsyncs = frames.findIndex((frame) => {
        if (frame.frameMs !== undefined) samples += 1;
        return samples === SUSTAINED_SAMPLES;
      });
      return (vsyncs + 1) / 60;
    });
    const expected = [0.5, 0.5, 1.0, 1.25, 1.5];
    seconds.forEach((measured, level) => {
      // Within two vsyncs: the first sample needs a drawn frame before it.
      expect(
        Math.abs(measured - (expected[level] ?? 0)),
        QUALITY_LADDER[level]?.label,
      ).toBeLessThan(2.5 / 60);
    });
  });
});
