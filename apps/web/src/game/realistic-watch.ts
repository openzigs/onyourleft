// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Watches one realistic ride's ladder and says when there is something to
 * record — #2289. `realistic-report.ts` says what the record is and why it
 * holds no coordinate; this is the half that reads the samples, on the ride's
 * side, so it may import `quality.ts`.
 *
 * It is handed each sample the ride feeds the ladder with the state either
 * side of it, and decides nothing. Since the owner's 2026-11-06 ruling on
 * #2289 the ladder decides on frame time alone, so the only reason a record can
 * give is frame time, counted with `quality.ts`' own {@link frameTimeHot}.
 */

import {
  FRAME_MS_REDUCE_ABOVE,
  SUSTAINED_SAMPLES,
  frameTimeHot,
  type QualitySample,
  type WorldQualityState,
} from './quality';
import type {
  RealisticSettlingReading,
  RealisticStepReading,
  RealisticWorldReport,
} from './realistic-report';

/** One ride's watch. A new ride takes a new one. */
export class RealisticWatch {
  /** The last samples fed, at most one decision window of them. */
  #recent: QualitySample[] = [];
  #settling: RealisticSettlingReading | undefined;
  #steps: RealisticStepReading[] = [];

  /**
   * One sample, and the ladder's state before and after it.
   *
   * @returns the whole record when this sample changed it — the settling
   * window ended, or the ladder stepped down or left — and `undefined` when
   * there is nothing new to keep
   */
  observe(
    previous: WorldQualityState,
    next: WorldQualityState,
    sample: QualitySample,
    rideSeconds: number,
  ): RealisticWorldReport | undefined {
    if (!previous.realistic) return undefined;
    const settling = previous.settling ?? 0;
    // Still arriving: the view is drawing the stylised world.
    if (settling === Number.POSITIVE_INFINITY) return undefined;
    if (settling > 0) {
      const so = this.#settling ?? { frames: 0, slow: 0, worstMs: 0 };
      this.#settling = {
        frames: so.frames + 1,
        slow: so.slow + (frameTimeHot(sample) ? 1 : 0),
        worstMs: Math.max(so.worstMs, sample.frameMs),
      };
      return (next.settling ?? 0) === 0 ? this.#report() : undefined;
    }
    this.#recent.push(sample);
    if (this.#recent.length > SUSTAINED_SAMPLES) this.#recent.shift();
    const left = !next.realistic;
    // A climb back up is not a step down; nor is staying. The window needs no
    // clearing on a change: the ladder's pressure starts again then, so the
    // next step comes a whole window of samples later.
    if (!left && next.quality.level <= previous.quality.level) return undefined;
    this.#steps.push(stepOf(this.#recent, previous.quality.level, left, rideSeconds));
    return this.#report();
  }

  #report(): RealisticWorldReport {
    return {
      frameMsLimit: FRAME_MS_REDUCE_ABOVE,
      ...(this.#settling === undefined ? {} : { settling: this.#settling }),
      steps: [...this.#steps],
    };
  }
}

function stepOf(
  window: readonly QualitySample[],
  rung: number,
  left: boolean,
  rideSeconds: number,
): RealisticStepReading {
  const times = window.map((sample) => sample.frameMs).sort((a, b) => a - b);
  return {
    rung,
    left,
    rideSeconds,
    frames: window.length,
    overFrameMs: window.filter(frameTimeHot).length,
    medianMs: median(times),
    worstMs: times.at(-1) ?? 0,
  };
}

/** The median of sorted numbers; 0 for none. */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
