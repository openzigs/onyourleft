// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The video render's frame clock — #1655.
 *
 * `requestAnimationFrame` hands a callback the time the browser drew at, so a
 * frame that took long on a slow machine is a frame that rode further: the
 * stutter `MediaRecorder` records. This clock runs no callback until the
 * render steps it (`tools/demo/render-video.ts`, through `window.__oylDemoRender`
 * in `main.tsx`), and hands each one the clock advanced by exactly the step.
 * So frame *n* of a render at *f* frames a second is the ride at *n / f*
 * seconds, however slow the machine, and two renders are the same frames.
 *
 * Nothing here reads a clock: `eslint.config.js` refuses `performance` and
 * `Date` in `src/demo/**\/*.ts`.
 */

import type { FrameScheduler } from './stage';

/**
 * What the video render drives the page with, as `window.__oylDemoRender` —
 * set by `main.tsx` on `?render` alone.
 */
export interface DemoRenderControl {
  /**
   * Advance the clock by `stepMs` and draw the frame due, then wait for the
   * page to show it; how many frames were drawn (one on a playing stage).
   */
  step(stepMs: number): Promise<number>;
  /** Show the closing card a baked route's video ends on, and wait for the page to show it. */
  closingCard(): Promise<void>;
}

/** A {@link FrameScheduler} whose time moves only when {@link step} is called. */
export class RenderClock implements FrameScheduler {
  #steps = 0;
  #nowMs = 0;
  #pending = new Map<number, (nowMs: number) => void>();
  #next = 1;

  request(callback: (nowMs: number) => void): number {
    const handle = this.#next;
    this.#next += 1;
    this.#pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.#pending.delete(handle);
  }

  /**
   * Advance the clock by `stepMs` and run every callback waiting for a frame,
   * once, at the new time. Returns how many ran: one on a playing stage.
   *
   * The time is the step times the steps so far, never a running sum, so a
   * step that is not a whole number of milliseconds (a thirtieth of a second)
   * does not drift over a long render.
   */
  step(stepMs: number): number {
    if (!(Number.isFinite(stepMs) && stepMs > 0)) {
      throw new RangeError(`a render step is a positive number of milliseconds, not ${stepMs}`);
    }
    this.#steps += 1;
    this.#nowMs = this.#steps * stepMs;
    const due = [...this.#pending.values()];
    this.#pending.clear();
    for (const callback of due) callback(this.#nowMs);
    return due.length;
  }
}
