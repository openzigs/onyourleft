// SPDX-License-Identifier: AGPL-3.0-or-later

import { metresPerSecondToKilometresPerHour } from '@onyourleft/domain';

/**
 * Format a speed for display.
 *
 * The conversion itself lives in `@onyourleft/domain` and is not repeated here:
 * every conversion in the program goes through that package so that the device
 * and a Phase 3 instance cannot disagree about a number. What belongs on this
 * side of the boundary is only the presentation decision — how many decimals,
 * and which unit label.
 */
export function formatSpeed(metresPerSecond: number): string {
  return `${metresPerSecondToKilometresPerHour(metresPerSecond).toFixed(1)} km/h`;
}
