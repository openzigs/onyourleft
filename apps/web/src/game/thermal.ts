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

import type { ThermalPort } from './thermal-port';

/**
 * How often the forecast is re-read, in milliseconds.
 *
 * ⚠️ **Ten seconds, and deliberately conservative.** The forecast looks ahead
 * ({@link THERMAL_FORECAST_SECONDS}) and the ladder needs a sustained run of hot
 * samples before it moves, so a reading that is up to ten seconds old costs the
 * ladder nothing it can use. A faster poll risks the rate limit, and a limited
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

/** The forecast a frame reads, and the way to stop reading it. */
export interface HeadroomWatch {
  /** The latest forecast, or `undefined` until one has arrived or where none exists. */
  latest(): number | undefined;
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
  let latest: number | undefined;
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
      latest = value;
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
