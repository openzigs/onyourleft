// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride HUD's focus arrangement shows — #2383.
 *
 * One compact readout instead of the two tiers: the three numbers a rider
 * steers the effort by, large, and four smaller under them. **Picked out of
 * `fields.ts` §`hudReadings` by key, never worked out again**: each is the
 * same `HudReading` the full HUD draws — the same figure, the same formatting
 * in the rider's units, the same dash for a sensor that dropped and the same
 * *Sensor lost* — so the two arrangements cannot disagree about a number.
 *
 * ⚠️ **The order is fixed**, as #94 asks of the full HUD: a rider finds a
 * number by where it is. Power, cadence and heart rate keep the order they
 * have in the full HUD's primary tier, so a rider who switches finds each
 * where they last saw it.
 *
 * The small row ends with the ride's time — #2382's field, the recorder's
 * *Elapsed* where a recording runs and the ride's own clock, *Ride*,
 * otherwise — so the focus HUD shows how long the rider has been riding from
 * the first second. Everything else the full HUD shows is a choice of that
 * arrangement, not this one.
 */

import { ELAPSED_TIME_KEY, type HudReading } from './fields';

/** The large row, in the full HUD's primary order. */
export const FOCUS_MAIN_KEYS = ['power', 'cadence', 'heartRate'] as const;

/**
 * The small row: the speed, the average power, the distance (#2383's three)
 * and the ride's time (#2382).
 */
export const FOCUS_MORE_KEYS = ['speed', 'averagePower', 'distance', ELAPSED_TIME_KEY] as const;

/** The focus readout's two rows. */
export interface FocusReadings {
  readonly main: readonly HudReading[];
  readonly more: readonly HudReading[];
}

/**
 * The two rows, out of the readings the HUD would otherwise draw. A key the
 * ride left out (the demo leaves out its totals and its elapsed time) is left
 * out here too, rather than drawn as a dash for a figure it can never have.
 */
export function focusReadings(readings: readonly HudReading[]): FocusReadings {
  const pick = (keys: readonly string[]): HudReading[] =>
    keys.flatMap((key) => readings.filter((reading) => reading.key === key));
  return { main: pick(FOCUS_MAIN_KEYS), more: pick(FOCUS_MORE_KEYS) };
}
