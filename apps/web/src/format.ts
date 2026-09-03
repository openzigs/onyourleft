// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MetresPerSecond } from '@onyourleft/domain';
import { metresPerSecondToKilometresPerHour } from '@onyourleft/domain';

/**
 * Format a speed for display.
 *
 * The conversion itself lives in `@onyourleft/domain` and is not repeated here:
 * every conversion in the program goes through that package so that the device
 * and a Phase 3 instance cannot disagree about a number. What belongs on this
 * side of the boundary is only the presentation decision — how many decimals,
 * and which unit label.
 *
 * The argument is a `MetresPerSecond` rather than a `number`, so a caller
 * holding a distance, a cadence or an unvalidated sensor reading cannot reach
 * this function at all. Validation happened when the quantity was constructed;
 * see `@onyourleft/domain`'s README.
 */
export function formatSpeed(speed: MetresPerSecond): string {
  return `${metresPerSecondToKilometresPerHour(speed).toFixed(1)} km/h`;
}
