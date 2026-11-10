// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's power as a 3-second average — #2420.
 *
 * Raw power moves by about ±10 % from one second to the next during a steady
 * effort, because the force on the pedals changes through every stroke. Head
 * units and other trainer apps show a 3 s average as the main power field, and
 * the owner's watch, reading the same trainer, does. So the HUD does too,
 * unless the rider chose instant power (`hud-layout-preference.ts` §"Power").
 *
 * ## Display only
 *
 * ⚠️ **Nothing here reaches the simulation, the trainer, the recorder or a
 * sync.** `GameView` feeds this from the frame loop, AFTER the simulation was
 * advanced with the raw reading, and only the HUD reads what it says
 * (`fields.ts` §`HudInput.shownPower`). The physics, what is written to the
 * trainer (ADR 0059, `docs/agents/wiring-gate.md`'s trainer-command seam), the
 * recording, the ride's totals, the zone time and the recent graph all keep
 * the raw readings; `power-shown-wiring.test.tsx` rides the same trace in both
 * modes and holds them identical.
 *
 * One reading deliberately stays raw: the "You" row of a lap race's standings
 * (`lap-race-hud.ts`) shows W/kg from the instant reading, because it sits
 * beside the bots' figures, which are instants too.
 *
 * ## The average
 *
 * A **time-weighted** mean over the last {@link POWER_AVERAGE_SECONDS} of the
 * RIDE's clock (the simulation's `elapsed`, as `recent-trace.ts` reads it). A
 * frame gap longer than {@link MAX_FRAME_GAP_SECONDS}, which is what a pause
 * or a backgrounded tab leaves when the clock resumes, is left out like any
 * other gap, so the first frame after it does not stand for the whole window.
 * The reading a frame
 * sees has held since the frame before it, so each frame's reading covers the
 * time since the last frame; a reading that holds for two seconds weighs twice
 * one that holds for one, however many frames drew it.
 *
 * ⚠️ **A gap is not a zero.** Time the sensor was not live is left out of the
 * mean, not counted as nought watts: a rider whose meter dropped for a second
 * did not stop pedalling for one. And while it is not live there is no
 * average at all ({@link PowerAverage.average} is `undefined`), so the HUD
 * shows the dash and *Sensor lost* it always did (`fields.ts` header): a
 * stale or unpaired meter is never a number, averaged or not.
 *
 * ## Bounded
 *
 * One entry per change of reading inside the window, merged while the reading
 * holds, and dropped once it is older than the window: a four-hour ride holds
 * no more than a four-second one.
 */

/** The window, in seconds of the ride's clock. */
export const POWER_AVERAGE_SECONDS = 3;

/**
 * The longest stretch of the ride's clock one reading is taken to have held
 * across. A frame arrives every few hundredths of a second; a longer gap is a
 * pause or a backgrounded tab (the clock is the wall clock and counts it on
 * resume), and the reading before it says nothing about the time between.
 */
export const MAX_FRAME_GAP_SECONDS = 1;

/** One stretch of the ride's clock over which one live reading held. */
interface Held {
  readonly from: number;
  to: number;
  readonly watts: number;
}

/** The running average. @see createPowerAverage */
export interface PowerAverage {
  /**
   * What the sensor said on a frame at `at` seconds of the ride's clock:
   * the reading in watts, or `undefined` where it is not live.
   */
  observe(at: number, watts: number | undefined): void;
  /**
   * The 3 s average as of the last {@link observe}, or `undefined` where the
   * last reading was not live. A first live reading, with nothing held before
   * it, is its own average.
   */
  readonly average: number | undefined;
}

/** A running average over `windowSeconds` of the ride's clock. */
export function createPowerAverage(windowSeconds = POWER_AVERAGE_SECONDS): PowerAverage {
  const held: Held[] = [];
  let last: number | undefined;
  let average: number | undefined;
  return {
    get average() {
      return average;
    },
    observe(at: number, watts: number | undefined): void {
      if (!Number.isFinite(at)) return;
      // A clock that went back is another ride's: start again.
      if (last !== undefined && at < last) {
        held.length = 0;
        last = undefined;
      }
      const live = watts !== undefined && Number.isFinite(watts);
      if (live && last !== undefined && at > last && at - last <= MAX_FRAME_GAP_SECONDS) {
        const newest = held.at(-1);
        if (newest !== undefined && newest.watts === watts && newest.to === last) {
          newest.to = at;
        } else {
          held.push({ from: last, to: at, watts });
        }
      }
      last = at;
      const start = at - windowSeconds;
      while (held.length > 0 && (held[0] as Held).to <= start) held.shift();
      if (!live) {
        average = undefined;
        return;
      }
      let weighted = 0;
      let covered = 0;
      for (const each of held) {
        const span = each.to - Math.max(each.from, start);
        weighted += each.watts * span;
        covered += span;
      }
      average = covered > 0 ? weighted / covered : watts;
    },
  };
}
