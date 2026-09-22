// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realism page's clock and its error guard — #457.
 *
 * ⚠️ Spike code on a never-merged branch.
 *
 * ## Why this is its own module
 *
 * On the Pixel Tablet the first version of the page never drew a realism
 * configuration. It set its origin with `performance.now()` once the assets
 * had loaded and then measured every frame from `requestAnimationFrame`'s
 * timestamp. That timestamp is the START of the frame, so it can be earlier
 * than a `performance.now()` read a moment before. The first elapsed time came
 * out a few milliseconds negative, `seconds()` threw a `UnitError`, and the
 * throw left the rAF callback as an uncaught exception. The loop died, nothing
 * rendered, `__oylRealism.errors` stayed empty, and `ready` stayed false.
 *
 * So there is ONE clock, the rAF timestamp:
 *
 * - its origin is the first frame drawn after everything has loaded;
 * - warm-up is counted from that frame;
 * - a step is never negative;
 * - a gap too long to be a frame (a page throttled while hidden, a GC pause
 *   the size of a stall) is counted as a stall, not sampled. The baseline's
 *   one published figure had been `{p50: 43530, count: 1}`: a single sample,
 *   43 s long. It is reported, never averaged in.
 *
 * {@link guarded} is how a throw anywhere in a frame reaches `errors` instead
 * of vanishing.
 */

/** A step longer than this is not a frame; it is the page not being drawn. */
export const MAXIMUM_FRAME_GAP_MS = 1_000;

/** What one frame is, as the clock sees it. */
export interface ClockFrame {
  /** Seconds since the first frame drawn; never negative. */
  readonly elapsedSeconds: number;
  /** The step this frame contributed to the sample, if it did. */
  readonly sampledMs: number | undefined;
}

export class MeasurementClock {
  readonly #warmUpSeconds: number;
  #origin: number | undefined;
  #last = 0;
  #samples: number[] = [];
  #sampledMs = 0;
  #stalls = 0;

  constructor(warmUpSeconds: number) {
    this.#warmUpSeconds = warmUpSeconds;
  }

  /** Call once per `requestAnimationFrame`, with its timestamp. */
  frame(now: number): ClockFrame {
    if (this.#origin === undefined) {
      this.#origin = now;
      this.#last = now;
      return { elapsedSeconds: 0, sampledMs: undefined };
    }
    const step = Math.max(0, now - this.#last);
    this.#last = Math.max(this.#last, now);
    const elapsedSeconds = Math.max(0, (this.#last - this.#origin) / 1000);
    if (elapsedSeconds <= this.#warmUpSeconds || step === 0) {
      return { elapsedSeconds, sampledMs: undefined };
    }
    if (step > MAXIMUM_FRAME_GAP_MS) {
      this.#stalls += 1;
      return { elapsedSeconds, sampledMs: undefined };
    }
    this.#samples.push(step);
    this.#sampledMs += step;
    return { elapsedSeconds, sampledMs: step };
  }

  /**
   * Whether the current window has sampled at least `seconds` of frames. It
   * also needs more than one sample, because a single sample is not a
   * distribution.
   */
  windowFull(seconds: number): boolean {
    return this.#samples.length > 1 && this.#sampledMs >= seconds * 1000;
  }

  /** The frames sampled so far, without ending the window. */
  get samples(): readonly number[] {
    return this.#samples;
  }

  /** Ends the window: returns what it held and starts an empty one. */
  take(): { readonly samples: readonly number[]; readonly stalls: number } {
    const taken = { samples: this.#samples, stalls: this.#stalls };
    this.#samples = [];
    this.#sampledMs = 0;
    this.#stalls = 0;
    return taken;
  }
}

/**
 * `step` wrapped so that a throw is REPORTED, and the loop stops, instead of
 * escaping as an uncaught exception. The wrapped function returns whether the
 * caller should schedule another frame.
 */
export function guarded<A extends unknown[]>(
  step: (...args: A) => void,
  report: (message: string) => void,
): (...args: A) => boolean {
  return (...args: A): boolean => {
    try {
      step(...args);
      return true;
    } catch (error: unknown) {
      report(describe(error));
      return false;
    }
  };
}

/** An error's message, with its name when it has one worth reading. */
export function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message;
  }
  return String(error);
}
