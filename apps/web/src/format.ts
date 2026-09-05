// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MetresPerSecond } from '@onyourleft/domain';
import { metresPerSecondToKilometresPerHour } from '@onyourleft/domain';

/** The unit label a speed is shown in. */
export const SPEED_UNIT = 'km/h';

/**
 * Format a speed for display, as digits without a unit.
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
 *
 * ⚠️ **Digits and unit are returned separately, and that is a requirement
 * rather than an oversight.** `ride/MetricGrid.tsx` renders the two in
 * different elements at different sizes, and announces them to a screen reader
 * as one sentence built by `metricSentence`. A single `'36.0 km/h'` string
 * would have to be split apart there to be rendered at all.
 *
 * This function replaced one that returned the combined string, which #143
 * found had lost its last production caller while `MetricGrid` carried its own
 * copy of the `.toFixed(1)` and the unit label. An exported helper with a test
 * and no caller survives refactors it should not, and two places deciding how
 * many decimals a speed has is exactly the disagreement this module exists to
 * prevent.
 */
export function formatSpeedValue(speed: MetresPerSecond): string {
  return metresPerSecondToKilometresPerHour(speed).toFixed(1);
}
