// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which lap of a lap race may be a loop's best lap — #2319, ADR 0060's
 * amendment of 2026-11-26.
 *
 * `GameView` asks this as the rider crosses the line in a solo lap race on
 * one of their own loops, with the laps the recording has stated by then
 * (`recording/laps.ts`), and hands the answer to the port, whose store keeps
 * it if it is the fastest (`@onyourleft/store` §`ActivityStore.recordBestLap`).
 * A lap time and nothing else: no place and no bot (D-12.2).
 *
 * Only a WHOLE lap: the last one stated, not a part lap (the rider stopped in
 * it), and as long as the loop to within {@link BEST_LAP_LEAST_SHARE}. A
 * lap shorter than that is not a lap of this loop, and a time on it would be
 * a best no rider could beat by riding the loop.
 *
 * Pure: it reads no clock and keeps nothing.
 */

import type { LapFigures } from '../../recording/laps';

/**
 * The least share of the loop's length a lap must cover to be a whole lap of
 * it: 0.9. The recording's distance is the ride's own, which a rider's speed
 * builds up second by second, so a whole lap reads a few metres either side
 * of the profile's length; a tenth of a loop is never that.
 */
export const BEST_LAP_LEAST_SHARE = 0.9;

/**
 * The moving time of the lap just finished, in seconds, if it may be the
 * loop's best; `undefined` if it may not, or there is none.
 *
 * @param laps every lap the recording has stated on this ride, the one just
 *   finished last
 * @param loopMetres the loop's length, the route profile's total distance
 */
export function raceLapToKeep(
  laps: readonly Pick<LapFigures, 'distance' | 'movingTime' | 'partial'>[],
  loopMetres: number,
): number | undefined {
  const lap = laps.at(-1);
  if (lap === undefined || lap.partial === true) return undefined;
  const time = lap.movingTime as number;
  if (!Number.isFinite(time) || time <= 0) return undefined;
  if (!(loopMetres > 0) || (lap.distance as number) < BEST_LAP_LEAST_SHARE * loopMetres) {
    return undefined;
  }
  return time;
}
