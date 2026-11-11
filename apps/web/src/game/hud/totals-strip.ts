// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride HUD's totals strip shows — #2387.
 *
 * The whole ride's totals in one thin strip along the bottom of the road, a
 * rider's choice in Settings (`hud-layout-preference.ts` §"The totals strip"):
 * the lap, the route's length, the distance to go, the average speed, the
 * energy, the calorie estimate and the climb. **Each the figure the HUD
 * already has, never a second one**:
 *
 * - *Lap* is `plan.ts` §`planLap`, the lap the elevation strip's sentence
 *   names (`fields.ts` §`profileReading`), and on a loop only: a route that is
 *   not one has no laps to count, so the field is left out rather than drawn
 *   as a dash for a figure it can never have. The route is chosen before the
 *   ride and held for it, so the field never appears or vanishes mid-ride.
 * - *Route* is the profile's own `totalDistance`, the length the route picker
 *   states, in the rider's distance unit.
 * - *To go* and *Climbed* are the HUD's own readings of those names
 *   (`fields.ts` §`hudReadings`), picked out by key as the focus readout picks
 *   its readings (`focus-readout.ts`), so the strip and the tiers cannot
 *   disagree about either.
 * - *Avg speed* is the HUD's *Distance* over its *Moving*
 *   (`recording/totals.ts` §`rideAverageSpeed`), the rule a lap's average
 *   speed is worked out by; a dash with nothing recorded or no moving time.
 * - *Energy* is the recorder's work (`recording/totals.ts` §`rideEnergy`), in
 *   whole kilojoules: our own plain figure, and **no load metric of any name**
 *   (CLAUDE.md §6). A dash with no power reading, never `0 kJ`.
 * - *Calories* (#2434), beside *Energy*, is the recorder's calorie estimate
 *   (`recording/totals.ts` §`recordedRideCalories`): the function and the
 *   series the saved ride's figure is worked out from, so the strip's last
 *   figure is the one the ride is saved with (#2076's rule). In the words of
 *   the ride's result card and page (`detail/CaloriesFact.tsx`): `≈` and whole
 *   kilocalories, so it looks like the estimate it is, with the basis —
 *   *estimate from power* or *from heart rate* — as its phrase. A dash with
 *   nothing to estimate from, never `0 kcal`, and the card's reason for it
 *   as the phrase, so the phrase's line is there either way and the strip
 *   does not grow when an estimate appears (`theme.css` §"THE CALORIE
 *   ESTIMATE ON THE STRIP"). Whether the ride has heart rate is the HUD's
 *   own heart-rate reading, which is the channel the recorder records.
 *
 * ⚠️ **The order is fixed**, as #94 asks of every HUD row: a rider finds a
 * number by where it is. Never stale: none of these is a live sensor's, so a
 * dash here means "nothing to say", never *Sensor lost*.
 *
 * Pure: no clock and no state, as `fields.ts` is.
 */

import {
  CALORIES_BASIS_TEXT,
  CALORIES_LABEL,
  CALORIES_UNIT,
  caloriesValue,
  noCaloriesReason,
} from '../../detail/CaloriesFact';
import { rideAverageSpeed } from '../../recording/totals';
import { formatDistance, formatSpeed, speedUnit } from '../../units/format';

import { NO_READING, type HudInput, type HudReading } from './fields';
import { planLap } from './plan';

/** *Calories*' key, which `HudCore.tsx` gives the strip's two-column cell (#2434). */
export const TOTALS_CALORIES_KEY = 'totals-calories';

/** Joules in a kilojoule. Named so the division below is not a bare 1000. */
const JOULES_PER_KILOJOULE = 1000;

/**
 * The strip's readings, for this ride, out of the readings the HUD draws.
 *
 * @param readings `fields.ts` §`hudReadings` for the same input: *To go* and
 *   *Climbed* are taken from it, never worked out again.
 */
export function totalsStripReadings(
  input: HudInput,
  readings: readonly HudReading[],
): readonly HudReading[] {
  const units = input.units ?? 'metric';
  const own = (key: string, as: string): readonly HudReading[] =>
    readings.filter((reading) => reading.key === key).map((reading) => ({ ...reading, key: as }));
  const lap = planLap(input.profile, input.state.ride.distance);
  const route = formatDistance(input.profile.totalDistance, units);
  const totals = input.rideTotals;
  const speed =
    totals === undefined || input.movingSeconds === undefined
      ? undefined
      : rideAverageSpeed(totals.distance, input.movingSeconds);
  const energy = totals?.energy;
  const calories = totals?.calories;
  return [
    ...(lap === undefined
      ? []
      : [{ key: 'totals-lap', label: 'Lap', value: String(lap), unit: '', stale: false }]),
    { key: 'totals-route', label: 'Route', value: route.value, unit: route.unit, stale: false },
    ...own('remaining', 'totals-remaining'),
    speed === undefined
      ? {
          key: 'totals-average-speed',
          label: 'Avg speed',
          value: NO_READING,
          unit: speedUnit(units),
          stale: false,
        }
      : {
          key: 'totals-average-speed',
          label: 'Avg speed',
          ...formatSpeed(speed, units),
          stale: false,
        },
    {
      key: 'totals-energy',
      label: 'Energy',
      value: energy === undefined ? NO_READING : String(Math.round(energy / JOULES_PER_KILOJOULE)),
      unit: 'kJ',
      stale: false,
    },
    calories === undefined
      ? {
          key: TOTALS_CALORIES_KEY,
          label: CALORIES_LABEL,
          value: NO_READING,
          unit: CALORIES_UNIT,
          detail: noCaloriesReason(
            { hasPower: energy !== undefined, hasHeartRate: input.heartRate.value !== undefined },
            true,
          ),
          stale: false,
        }
      : {
          key: TOTALS_CALORIES_KEY,
          label: CALORIES_LABEL,
          value: caloriesValue(calories),
          unit: CALORIES_UNIT,
          detail: CALORIES_BASIS_TEXT[calories.basis],
          stale: false,
        },
    ...own('climbed', 'totals-climbed'),
  ];
}
