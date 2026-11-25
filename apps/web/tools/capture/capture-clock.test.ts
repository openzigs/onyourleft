// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: the capture's stepped clock, over a stand-in for a window whose
 * platform clocks are the test's own: a base time it moves by hand, frames it
 * runs by hand, and timers it fires by hand. What the game does on it is
 * `src/game/capture-wiring.test.tsx`'s.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  installCaptureClock,
  type CaptureClockControl,
  type CaptureClockTarget,
} from './capture-clock';

interface Platform {
  /** The platform's own time, in milliseconds. */
  now: number;
  /** The platform's own animation frames, waiting. */
  readonly frames: Map<number, (time: number) => void>;
  /** The platform's own timers, waiting. */
  readonly timers: Map<number, { readonly run: () => void; readonly every: boolean }>;
  /** Run the platform's frames, as a real display would. */
  paint(): void;
  /** Fire the platform's timers, as real time passing would. */
  fire(): void;
}

function platform(): { readonly target: CaptureClockTarget; readonly real: Platform } {
  let handle = 0;
  const real: Platform = {
    now: 1_000,
    frames: new Map(),
    timers: new Map(),
    paint() {
      const due = [...this.frames.values()];
      this.frames.clear();
      for (const callback of due) callback(this.now);
    },
    fire() {
      for (const [id, timer] of [...this.timers]) {
        if (!timer.every) this.timers.delete(id);
        timer.run();
      }
    },
  };
  const RealDate = Date;
  const PlatformDate = new Proxy(RealDate, {
    construct: (Platform, args: unknown[]) =>
      Reflect.construct(Platform, args.length === 0 ? [real.now] : args) as object,
    get: (Platform, key) =>
      key === 'now' ? () => real.now : (Reflect.get(Platform, key) as unknown),
  });
  const target: CaptureClockTarget = {
    performance: { now: () => real.now },
    Date: PlatformDate,
    requestAnimationFrame: (callback) => {
      handle += 1;
      real.frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (id) => {
      real.frames.delete(id);
    },
    setTimeout: (handler) => {
      handle += 1;
      real.timers.set(handle, { run: handler as () => void, every: false });
      return handle;
    },
    clearTimeout: (id) => {
      if (id !== undefined) real.timers.delete(id);
    },
    setInterval: (handler) => {
      handle += 1;
      real.timers.set(handle, { run: handler as () => void, every: true });
      return handle;
    },
    clearInterval: (id) => {
      if (id !== undefined) real.timers.delete(id);
    },
  };
  return { target, real };
}

let target: CaptureClockTarget;
let real: Platform;
let clock: CaptureClockControl;

beforeEach(() => {
  ({ target, real } = platform());
  clock = installCaptureClock(target);
});

describe('before the hold — #3152', () => {
  it('is the platform’s clocks, untouched', () => {
    real.now = 2_500;
    expect(target.performance.now()).toBe(2_500);
    expect(target.Date.now()).toBe(2_500);
    expect(new target.Date().getTime()).toBe(2_500);
    const ran: number[] = [];
    target.requestAnimationFrame((time) => ran.push(time));
    target.setTimeout(() => ran.push(-1), 50);
    real.paint();
    real.fire();
    expect(ran).toEqual([2_500, -1]);
  });

  it('publishes its control on the target', () => {
    expect(target.__oylCaptureClock).toBe(clock);
  });
});

describe('the hold and the steps — #3152', () => {
  it('stands every clock still at the hold, and moves it only by whole steps', () => {
    real.now = 4_000;
    clock.hold(Date.UTC(2026, 5, 20, 10, 30));
    real.now = 9_999;
    expect(target.performance.now()).toBe(4_000);
    expect(target.Date.now()).toBe(Date.UTC(2026, 5, 20, 10, 30));
    expect(new target.Date().toISOString()).toBe('2026-06-20T10:30:00.000Z');
    expect(new target.Date(0).getTime()).toBe(0);
    expect(new target.Date() instanceof Date).toBe(true);
    clock.step(1000 / 60);
    clock.step(1000 / 60);
    clock.step(1000 / 60);
    expect(target.performance.now()).toBe(4_000 + 3 * (1000 / 60));
    expect(target.Date.now()).toBe(Date.UTC(2026, 5, 20, 10, 30) + 3 * (1000 / 60));
  });

  it('runs each waiting frame once a step, at the step’s end — seconds × fps frames in all', () => {
    clock.hold();
    const times: number[] = [];
    const loop = (time: number): void => {
      times.push(time);
      target.requestAnimationFrame(loop);
    };
    target.requestAnimationFrame(loop);
    const seconds = 20;
    const fps = 60;
    let ran = 0;
    for (let step = 0; step < seconds * fps; step += 1) ran += clock.step(1000 / fps);
    expect(ran).toBe(seconds * fps);
    expect(times).toHaveLength(seconds * fps);
    expect(times[0]).toBe(1_000 + 1000 / fps);
    // The steps times the step, never a running sum: no drift over 1,200 frames.
    expect(times.at(-1)).toBe(1_000 + seconds * fps * (1000 / fps));
    expect(clock.elapsedMs).toBeCloseTo(seconds * 1000, 9);
    // Nothing was handed to the platform's display after the hold.
    expect(real.frames.size).toBe(0);
  });

  it('runs a frame at the held instant without moving the clock', () => {
    clock.hold();
    const times: number[] = [];
    target.requestAnimationFrame((time) => times.push(time));
    expect(clock.frame()).toBe(1);
    expect(clock.frame()).toBe(0);
    expect(times).toEqual([1_000]);
    expect(clock.elapsedMs).toBe(0);
  });

  it('moves a frame asked for before the hold onto the held clock', () => {
    const times: number[] = [];
    target.requestAnimationFrame((time) => times.push(time));
    clock.hold();
    real.now = 1_500;
    real.paint();
    expect(times).toEqual([]);
    expect(clock.step(10)).toBe(1);
    expect(times).toEqual([1_010]);
  });

  it('cancels a held frame', () => {
    clock.hold();
    const handle = target.requestAnimationFrame(() => {
      throw new Error('cancelled');
    });
    target.cancelAnimationFrame(handle);
    expect(clock.step(10)).toBe(0);
  });

  it('refuses a step it cannot take, and a step of another size', () => {
    expect(() => clock.step(10)).toThrow(/not held/u);
    clock.hold();
    expect(() => clock.step(0)).toThrow(RangeError);
    expect(() => clock.step(Number.NaN)).toThrow(RangeError);
    clock.step(10);
    expect(() => clock.step(20)).toThrow(/10 ms every time/u);
  });
});

describe('the timers — #3152', () => {
  it('keep real time after the hold until the first step, while the clocks stand still', () => {
    clock.hold();
    const seen: number[] = [];
    target.setTimeout(() => seen.push(target.performance.now()), 16);
    expect(real.timers.size).toBe(1);
    real.fire();
    expect(seen).toEqual([1_000]);
  });

  it('run at their own instants, in order, once the steps have begun', () => {
    clock.hold();
    clock.step(100);
    const seen: [string, number][] = [];
    target.setTimeout(() => seen.push(['b', target.performance.now()]), 150);
    target.setTimeout(() => seen.push(['a', target.performance.now()]), 30);
    target.setTimeout(() => seen.push(['a2', target.performance.now()]), 30);
    const every = target.setInterval(() => seen.push(['every', target.performance.now()]), 40);
    expect(real.timers.size).toBe(0);
    clock.step(100);
    expect(seen).toEqual([
      ['a', 1_130],
      ['a2', 1_130],
      ['every', 1_140],
      ['every', 1_180],
    ]);
    target.clearInterval(every);
    clock.step(100);
    expect(seen.slice(4)).toEqual([['b', 1_250]]);
  });

  it('moves a timer asked for before the first step onto the stepped clock', () => {
    clock.hold();
    const seen: number[] = [];
    target.setTimeout(() => seen.push(target.performance.now()), 16);
    clock.step(10);
    real.fire();
    expect(seen).toEqual([]);
    // Run on the next step, at the instant it was moved: due then, and late.
    clock.step(10);
    expect(seen).toEqual([1_010]);
  });

  it('clears a stepped timer, and refuses one that asks for itself forever', () => {
    clock.hold();
    clock.step(10);
    const cleared = target.setTimeout(() => {
      throw new Error('cleared');
    }, 5);
    target.clearTimeout(cleared);
    clock.step(10);
    const again = (): void => {
      target.setTimeout(again, 0);
    };
    target.setTimeout(again, 0);
    expect(() => clock.step(10)).toThrow(/too many timers/u);
  });
});
