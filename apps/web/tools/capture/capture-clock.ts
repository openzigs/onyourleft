// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The capture's stepped clock — #3152, after the demo's `src/demo/render-clock.ts`.
 *
 * The demo can hand its stage a clock of its own; the real app reads the
 * platform's — `performance.now`, `requestAnimationFrame`, `Date` and the
 * timers — in more places than one prop reaches. So this replaces all of them
 * on the page, before the app's first script runs
 * (`render-capture.ts`, `page.addInitScript`), and leaves them running in real
 * time until the capture {@link CaptureClockControl.hold}s them. From then on
 * time moves only when the capture {@link CaptureClockControl.step}s it: each
 * step is exactly `stepMs` of every clock, runs the timers that fall due in
 * it in order, at their own instants, and then every animation frame waiting,
 * once, at the step's end. So frame *n* of a capture at *f* frames a second is
 * the ride at *n / f* seconds, however long the machine took to draw it.
 *
 * ## Two holds: the clocks at {@link CaptureClockControl.hold}, the timers at the first step
 *
 * Between the hold and the first step the ride draws its first frames, all at
 * the instant of the press ({@link CaptureClockControl.frame}), and the
 * renderer's warm-up (`three-renderer.ts` §`settledWhen`) waits for the GPU
 * on a 16 ms timer. With the timers held too it would wait for steps that
 * each move the ride on, so a capture's first frame would be some machine-
 * dependent way into the ride. So the timers keep real time until the first
 * step, and no ride time passes while they do: `performance.now`, `Date` and
 * the animation frames stand still from the hold.
 *
 * ⚠️ **One self-contained function**, because Playwright sends it to the page
 * as source text: it may name nothing outside its own body.
 *
 * What it does not hold: the promises, the network and the page's own
 * message events, which run as they always do; React schedules its renders
 * on those, so a step's frame is committed when the capture lets the event
 * loop turn ({@link CaptureClockControl.settled}). A frame asked for before
 * the hold, or a timer before the first step, that comes due after it, is
 * moved onto the stepped clock and runs at the next step or frame rather than
 * in real time.
 */

/** What the capture drives the page's clocks with, as `window.__oylCaptureClock`. */
export interface CaptureClockControl {
  /**
   * Stop `performance.now`, `Date` and the animation frames where they stand;
   * from now on only {@link step} moves them. The timers follow at the first step.
   * `dateMs`, when given, is the instant `Date` stands at — a capture's own,
   * so the HUD's clock and the season do not depend on when it ran.
   */
  hold(dateMs?: number): void;
  /**
   * Run every animation frame waiting, and once the timers are held the
   * timers due now, without moving the clock — the frames a ride draws
   * before its first counted one. How many animation frames ran.
   */
  frame(): number;
  /**
   * Advance every clock by `stepMs`, run each timer due on the way at its own
   * instant, then every animation frame waiting, once, at the new time. How
   * many animation frames ran: one on a running ride. A step is the same size
   * every time, so the time is the step times the steps, and never drifts.
   */
  step(stepMs: number): number;
  /** How far the clocks have been stepped since the hold, in milliseconds. */
  readonly elapsedMs: number;
  /** Two turns of the real event loop: what a step set going is committed and laid out. */
  settled(): Promise<void>;
}

/** The globals the clock replaces: a window's, or a test's stand-in for one. */
export interface CaptureClockTarget {
  performance: { now(): number };
  Date: DateConstructor;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(handler: unknown, timeout?: number, ...rest: unknown[]): number;
  clearTimeout(handle?: number): void;
  setInterval(handler: unknown, timeout?: number, ...rest: unknown[]): number;
  clearInterval(handle?: number): void;
  __oylCaptureClock?: CaptureClockControl;
}

/** Replace `target`'s clocks with the stepped clock and publish its control on it. */
export function installCaptureClock(target: CaptureClockTarget): CaptureClockControl {
  // Handles this clock gives out from here, far above any the platform's own
  // counter reaches, so a clear is never sent to the wrong one.
  const FIRST_HANDLE = 1_000_000_000;
  // A step that runs more timers than this is a timer asking for itself at
  // nought delay forever: refused rather than left to hang the capture.
  const MOST_TIMERS_PER_STEP = 100_000;

  const real = {
    now: target.performance.now.bind(target.performance),
    Date: target.Date,
    requestAnimationFrame: target.requestAnimationFrame.bind(target),
    cancelAnimationFrame: target.cancelAnimationFrame.bind(target),
    setTimeout: target.setTimeout.bind(target),
    clearTimeout: target.clearTimeout.bind(target),
    setInterval: target.setInterval.bind(target),
    clearInterval: target.clearInterval.bind(target),
  };

  interface Timer {
    due: number;
    readonly order: number;
    readonly run: () => void;
    readonly every: number | undefined;
  }

  let held = false;
  // The timers are held from the first step, not from the hold. @see the module note
  let timersHeld = false;
  let heldPerformance = 0;
  let heldDate = 0;
  let elapsed = 0;
  let steps = 0;
  let stepSize: number | undefined;
  let nextHandle = FIRST_HANDLE;
  let order = 0;
  const timers = new Map<number, Timer>();
  let frames = new Map<number, (time: number) => void>();

  const performanceNow = (): number => (held ? heldPerformance + elapsed : real.now());
  const dateNow = (): number => (held ? heldDate + elapsed : real.Date.now());

  const callable = (handler: unknown, rest: unknown[]): (() => void) =>
    typeof handler === 'function'
      ? () => {
          (handler as (...args: unknown[]) => void)(...rest);
        }
      : () => undefined;

  const queueTimer = (handle: number, delay: number, run: () => void, every?: number): void => {
    order += 1;
    timers.set(handle, { due: elapsed + Math.max(0, delay), order, run, every });
  };

  const setTimer = (
    handler: unknown,
    timeout: unknown,
    rest: unknown[],
    repeat: boolean,
  ): number => {
    const delay = typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : 0;
    const run = callable(handler, rest);
    if (timersHeld) {
      nextHandle += 1;
      queueTimer(nextHandle, delay, run, repeat ? delay : undefined);
      return nextHandle;
    }
    if (repeat) {
      const handle = real.setInterval(() => {
        if (!timersHeld) {
          run();
          return;
        }
        real.clearInterval(handle);
        queueTimer(handle, 0, run, delay);
      }, delay);
      return handle;
    }
    const handle = real.setTimeout(() => {
      if (timersHeld) queueTimer(handle, 0, run);
      else run();
    }, delay);
    return handle;
  };

  const clearTimer = (handle: unknown): void => {
    if (typeof handle !== 'number') return;
    if (timers.delete(handle)) return;
    real.clearTimeout(handle);
    real.clearInterval(handle);
  };

  /** Run every timer due by `until`, earliest first, each at its own instant. */
  const runTimers = (until: number): void => {
    for (let ran = 0; ; ran += 1) {
      let next: [number, Timer] | undefined;
      for (const entry of timers) {
        const timer = entry[1];
        if (timer.due > until) continue;
        if (
          next === undefined ||
          timer.due < next[1].due ||
          (timer.due === next[1].due && timer.order < next[1].order)
        ) {
          next = entry;
        }
      }
      if (next === undefined) return;
      if (ran >= MOST_TIMERS_PER_STEP) {
        throw new Error('the capture clock ran too many timers in one step: one asks for itself');
      }
      const [handle, timer] = next;
      elapsed = Math.max(elapsed, timer.due);
      if (timer.every === undefined) timers.delete(handle);
      else timer.due += Math.max(1, timer.every);
      timer.run();
    }
  };

  const runFrames = (): number => {
    const due = [...frames.values()];
    frames = new Map();
    for (const callback of due) callback(performanceNow());
    return due.length;
  };

  // A proxy rather than a subclass, so `Date()` called bare still answers a
  // string and `instanceof Date` still holds, as on the platform's own.
  const CaptureDate = new Proxy(real.Date, {
    construct: (Platform, args: unknown[], newTarget: unknown) =>
      Reflect.construct(
        Platform,
        args.length === 0 ? [dateNow()] : args,
        newTarget as never,
      ) as object,
    apply: () => new real.Date(dateNow()).toString(),
    get: (Platform, key, receiver: unknown) =>
      key === 'now' ? dateNow : (Reflect.get(Platform, key, receiver) as unknown),
  });

  Object.defineProperty(target.performance, 'now', {
    value: performanceNow,
    configurable: true,
    writable: true,
  });
  target.Date = CaptureDate;
  target.requestAnimationFrame = (callback) => {
    if (held) {
      nextHandle += 1;
      frames.set(nextHandle, callback);
      return nextHandle;
    }
    const handle = real.requestAnimationFrame((time: number) => {
      if (held) frames.set(handle, callback);
      else callback(time);
    });
    return handle;
  };
  target.cancelAnimationFrame = (handle) => {
    if (!frames.delete(handle)) real.cancelAnimationFrame(handle);
  };
  target.setTimeout = (handler, timeout, ...rest) => setTimer(handler, timeout, rest, false);
  target.setInterval = (handler, timeout, ...rest) => setTimer(handler, timeout, rest, true);
  target.clearTimeout = clearTimer;
  target.clearInterval = clearTimer;

  const control: CaptureClockControl = {
    hold: (dateMs) => {
      if (held) return;
      heldPerformance = real.now();
      heldDate = typeof dateMs === 'number' && Number.isFinite(dateMs) ? dateMs : real.Date.now();
      held = true;
    },
    frame: () => {
      if (!held) throw new Error('the capture clock is not held');
      if (timersHeld) runTimers(elapsed);
      return runFrames();
    },
    step: (stepMs) => {
      if (!held) throw new Error('the capture clock is not held');
      if (!(Number.isFinite(stepMs) && stepMs > 0)) {
        throw new RangeError(
          `a capture step is a positive number of milliseconds, not ${String(stepMs)}`,
        );
      }
      if (stepSize !== undefined && stepSize !== stepMs) {
        throw new RangeError(
          `a capture steps ${String(stepSize)} ms every time, not ${String(stepMs)}`,
        );
      }
      stepSize = stepMs;
      timersHeld = true;
      steps += 1;
      const until = steps * stepMs;
      runTimers(until);
      elapsed = until;
      return runFrames();
    },
    get elapsedMs() {
      return elapsed;
    },
    settled: async () => {
      for (let turn = 0; turn < 2; turn += 1) {
        await new Promise<void>((resolve) => {
          real.setTimeout(resolve, 0);
        });
      }
    },
  };
  target.__oylCaptureClock = control;
  return control;
}
