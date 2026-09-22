// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which animation frames are drawn under a rung's frame cap, and what the
 * quality ladder is told about them — #476.
 *
 * `quality.ts` §`QualitySettings.frameCap` was declared on every rung and read
 * by nothing, so every rung drew at the display's rate. This is what reads it.
 * `GameView`'s loop asks it once per `requestAnimationFrame` and draws only
 * when it says so.
 *
 * ## Which frames are drawn
 *
 * A cap of `c` frames a second is an interval of `1000 / c` ms, and a frame is
 * drawn when that much has passed since the last one was DUE, not since the
 * last one was drawn. The difference is the whole of 24 fps on a 60 Hz
 * display: vsyncs are 16.7 ms apart, so "41.7 ms since the last draw" is first
 * true three vsyncs later and a rider gets 20 fps; carrying the schedule
 * forward alternates two and three vsyncs and averages 24. A frame that
 * arrives very late (a stall, a backgrounded tab) restarts the schedule from
 * itself rather than drawing a burst to catch up. {@link PACING_SLACK_MS}
 * absorbs a vsync's timestamp arriving a fraction early.
 *
 * {@link DISPLAY_RATE}'s infinite cap is an interval of zero: every animation
 * frame is drawn, which is never faster than the display refreshes.
 *
 * ## ⚠️ What the ladder is told — a skipped frame must not read as a fast one
 *
 * The ladder (`quality.ts` §`nextQuality`) decides from a frame time. Before
 * #476 that was the gap between one animation frame and the next, and every
 * frame was drawn, so it was how long a drawn frame held the main thread and
 * the GPU. Under a cap two readings of that gap are WRONG:
 *
 * - **after a skipped frame** it is a vsync of doing nothing — 16.7 ms, a
 *   "fast frame" that would climb a hot device back up the ladder;
 * - **between two drawn frames** it is the cap itself — 50 ms at 20 fps,
 *   over `FRAME_MS_REDUCE_ABOVE`, so the floor rung would read itself as hot
 *   for ever and a 30 fps rung could never read as cool.
 *
 * So the one sample taken is **the gap that follows a DRAWN frame**: how long
 * that frame kept the next animation frame from arriving, which is the same
 * quantity the ladder was always fed on an uncapped rung, and the same
 * quantity whatever the cap. A frame after a skipped one reports nothing.
 */

import { DISPLAY_RATE, QUALITY_LADDER } from './quality';

/** How early a vsync's timestamp may arrive and still count as due. */
export const PACING_SLACK_MS = 2;

/**
 * What a cap that is not a frame rate is read as: the ladder's LOWEST cap —
 * #482, from #481's review (finding 3).
 *
 * ⚠️ **It used to fail open.** `!(cap > 0)` made 0, a negative number and
 * `NaN` mean "uncapped", which is drawing at the display's rate — the heaviest
 * outcome there is, on the rungs that exist because a device is hot. A
 * mistyped rung would have drawn at full rate with every test green. So an
 * invalid cap now fails CLOSED, to the floor rung's rate.
 *
 * Clamped rather than thrown, deliberately: this runs inside
 * `requestAnimationFrame`, and a throw there ends the render loop mid-ride,
 * which is a frozen world under a rider who is pedalling. The mistake is caught
 * where it can be made instead — `quality.test.ts` §"gives every rung a cap the
 * pacer can honour" is red for any rung whose cap is neither
 * {@link DISPLAY_RATE} nor a positive number.
 */
export const INVALID_CAP_READ_AS = Math.min(
  // Over the VALID caps only, or a mistyped floor rung would make this NaN too.
  ...QUALITY_LADDER.map((rung) => rung.frameCap).filter((cap) => Number.isFinite(cap) && cap > 0),
);

/**
 * The cap the pacer actually applies: the rung's own, unless it is not a
 * frame rate. @see INVALID_CAP_READ_AS
 */
export function honouredCap(cap: number): number {
  if (cap === DISPLAY_RATE) return DISPLAY_RATE;
  return Number.isFinite(cap) && cap > 0 ? cap : INVALID_CAP_READ_AS;
}

/** What one animation frame is, to the pacer. */
export interface PacedFrame {
  /** Whether to draw on this animation frame. */
  readonly draw: boolean;
  /**
   * The sample for the quality ladder, if this animation frame produced one:
   * the gap since the previous animation frame, only when that one was drawn.
   */
  readonly frameMs: number | undefined;
}

export class FramePacer {
  #due: number | undefined;
  #previousAt: number | undefined;
  #previousDrawn = false;
  #cap: number | undefined;

  /**
   * Call once per animation frame with its time in milliseconds and the rung's
   * cap in frames a second.
   */
  frame(at: number, rungCap: number): PacedFrame {
    const frameMs =
      this.#previousDrawn && this.#previousAt !== undefined
        ? Math.max(0, at - this.#previousAt)
        : undefined;
    // ⚠️ Normalised BEFORE it is compared with the last one: `NaN !== NaN`, so
    // a NaN cap compared raw would read as a new cap on every frame, restart
    // the schedule every frame and draw every frame — failing open again.
    const cap = honouredCap(rungCap);
    const interval = cap === DISPLAY_RATE ? 0 : 1000 / cap;
    let draw: boolean;
    // A new cap starts its own schedule from this frame, rather than inheriting
    // a due time computed at another rate.
    if (interval === 0 || this.#due === undefined || cap !== this.#cap) {
      draw = true;
      this.#due = at + interval;
    } else if (at >= this.#due - PACING_SLACK_MS) {
      draw = true;
      // Carried forward from when it was due, not from now — the 24 fps case —
      // unless that is already behind us, when the schedule restarts here.
      const next = this.#due + interval;
      this.#due = next < at - PACING_SLACK_MS ? at + interval : next;
    } else {
      draw = false;
    }
    this.#cap = cap;
    this.#previousAt = at;
    this.#previousDrawn = draw;
    return { draw, frameMs };
  }
}
