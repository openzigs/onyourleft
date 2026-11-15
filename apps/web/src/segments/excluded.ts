// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Why one of the rider's own efforts is not counted** (#69), in their units.
 *
 * #69's second criterion: *"An excluded effort is still visible to its own
 * athlete on their own activity, with the exclusion reason shown. Silently
 * deleting somebody's ride from their own history to protect a leaderboard is
 * the wrong trade."* So the segment's own screen lists such an effort, and
 * this is the sentence beside it: the same rule the matcher applied
 * (`@onyourleft/domain` §`implausibleEffort`), its two numbers in the rider's
 * own speed unit.
 */

import { implausibleEffort, metresPerSecond } from '@onyourleft/domain';
import type { SegmentEffortRecord, SegmentRecord, UnitSystem } from '@onyourleft/store';

import { formatSpeed, measurementText } from '../units/format';

/** The sentence for an excluded effort, or `undefined` for one that counts. */
export function notCountedSentence(
  segment: SegmentRecord,
  effort: SegmentEffortRecord,
  units: UnitSystem,
): string | undefined {
  if (effort.visibility !== 'excluded') return undefined;
  const found = implausibleEffort(segment.sport, segment.distance, effort.elapsed);
  if (found === undefined) {
    // Excluded for a reason this device's rule does not explain — written by
    // another build, or by #69's flag: say so rather than invent a number.
    return 'Not counted: this effort was excluded.';
  }
  const speed = measurementText(
    formatSpeed(metresPerSecond(found.impliedSpeedMetresPerSecond), units, 0),
  );
  const ceiling = measurementText(
    formatSpeed(metresPerSecond(found.ceilingMetresPerSecond), units, 0),
  );
  return `Not counted: ${speed} averaged over the segment is faster than the ${ceiling} a ${segment.sport} can go, so it is no personal best and goes on no board.`;
}
