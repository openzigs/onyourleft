// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The thermal forecast, read on its own slow clock and held for the frame loop
 * — #247.
 *
 * The render loop asks `quality.ts` a question once per drawn frame, and that
 * question is synchronous. The forecast is a round trip over the Capacitor
 * bridge, and Android rate-limits it: a caller that asks too often is answered
 * `NaN`. So the forecast is **not** read per frame. It is read once when the
 * ride starts and then every {@link THERMAL_POLL_MILLISECONDS}, and every frame
 * in between is handed the latest answer.
 *
 * Pure apart from the scheduler it is handed, so both halves are tested without
 * a timer: `thermal.test.ts` drives the schedule by hand.
 */

import { HEADROOM_REDUCE_ABOVE, HEADROOM_RESTORE_BELOW } from './quality';
import type { ThermalPort } from './thermal-port';

/**
 * How often the forecast is re-read, in milliseconds.
 *
 * ⚠️ **Ten seconds, and deliberately conservative.** The forecast looks ahead
 * ({@link THERMAL_FORECAST_SECONDS}), and a step down takes time to show in
 * it, so `GameView` lets each reading move the ladder one rung at most (see
 * {@link HeadroomReading.reading}): a phone that stays hot steps down about
 * once a poll. A faster poll risks the rate limit, and a limited
 * call returns `NaN`: the ladder would read that as "no opinion" and the
 * thermal half would go quiet exactly when the device was busiest. Whether the
 * limit on a given device is looser is a question validation 0002 Part E can
 * answer on the phone. Nothing here can.
 */
export const THERMAL_POLL_MILLISECONDS = 10_000;

/**
 * How far ahead Android is asked to forecast, in seconds.
 *
 * Matches {@link THERMAL_POLL_MILLISECONDS}: each reading forecasts the moment
 * the next one is taken. The Android half passes it to
 * `getThermalHeadroom(forecastSeconds)`, which accepts 0 to 60.
 */
export const THERMAL_FORECAST_SECONDS = THERMAL_POLL_MILLISECONDS / 1000;

/** Run `task` every `milliseconds` until the returned function is called. */
export type Every = (task: () => void, milliseconds: number) => () => void;

/** One answer from the platform, and which answer it was. */
export interface HeadroomReading {
  /** The forecast, or `undefined` where there is none. @see ThermalPort */
  readonly headroom: number | undefined;
  /**
   * Which answer this is, counting from 1; 0 before any has arrived.
   *
   * ⚠️ **What a frame needs as well as the value.** The ladder counts pressure
   * per frame and a reading lasts ten seconds, so one reading handed to every
   * frame is hundreds of samples. `GameView` uses this to let one reading move
   * the ladder one rung at most.
   */
  readonly reading: number;
}

/** The forecast a frame reads, and the way to stop reading it. */
export interface HeadroomWatch {
  /** The latest answer. @see HeadroomReading */
  latest(): HeadroomReading;
  /** Stops the poll. A read in flight when this is called is discarded. */
  stop(): void;
}

/** A real interval, for the one caller that is not a test. */
export const everyInterval: Every = (task, milliseconds) => {
  const handle = setInterval(task, milliseconds);
  return () => {
    clearInterval(handle);
  };
};

/**
 * Starts reading the forecast now and on every poll after.
 *
 * ⚠️ **A rejected read is `undefined`, not the previous value.** A plugin that
 * has stopped answering has no forecast, and holding a stale "hot" reading
 * would keep a phone stepped down after it cooled. Holding a stale "cool" one
 * would be worse. The ladder already treats `undefined` as "no opinion".
 *
 * ⚠️ **An answer that arrives after a newer one is dropped.** Two reads can be
 * in flight across the bridge at once, and the older one can come back last.
 */
export function watchThermalHeadroom(port: ThermalPort, every: Every): HeadroomWatch {
  let latest: HeadroomReading = { headroom: undefined, reading: 0 };
  let stopped = false;
  let asked = 0;
  let answered = 0;
  const read = (): void => {
    asked += 1;
    const sequence = asked;
    const settle = (value: number | undefined): void => {
      if (stopped || sequence < answered) {
        return;
      }
      answered = sequence;
      latest = { headroom: value, reading: latest.reading + 1 };
    };
    port.readThermalHeadroom().then(settle, () => {
      settle(undefined);
    });
  };
  read();
  const cancel = every(read, THERMAL_POLL_MILLISECONDS);
  return {
    latest: () => latest,
    stop: () => {
      stopped = true;
      cancel();
    },
  };
}

/**
 * A forecast that is neither hot nor cool to the ladder: halfway between
 * {@link HEADROOM_RESTORE_BELOW} and {@link HEADROOM_REDUCE_ABOVE}.
 */
export const SPENT_HEADROOM = (HEADROOM_RESTORE_BELOW + HEADROOM_REDUCE_ABOVE) / 2;

/**
 * What one frame tells the ladder about heat, given the reading it holds and
 * the last reading that already moved the ladder.
 *
 * ⚠️ **One reading moves the ladder one rung at most.** The ladder counts
 * pressure per frame and a reading lasts a poll, so one reading handed to every
 * frame is hundreds of samples: one hot answer walked a ride to the floor, and
 * one cool answer climbed it straight back — the review finding on #523.
 *
 * ⚠️ **A spent reading becomes NEUTRAL, not `undefined`.** `undefined` means "no
 * opinion", and with no opinion the ladder climbs on comfortable frames alone,
 * which a hot phone keeping up has. So the first fix flapped: down on the
 * reading, back up thirty frames later, down again on the next poll. Neutral
 * still blocks a climb on frame time alone, and it still lets slow frames step
 * the ride down, as they always could.
 *
 * `undefined` and `NaN` pass through as they are: there is nothing to spend.
 */
export function forecastForFrame(
  latest: HeadroomReading,
  spentReading: number,
): number | undefined {
  const { headroom } = latest;
  if (headroom === undefined || !Number.isFinite(headroom)) {
    return headroom;
  }
  return latest.reading > spentReading ? headroom : SPENT_HEADROOM;
}
