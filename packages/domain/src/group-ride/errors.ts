// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the group ride's rules raise — the plan (#3298) and the
 * paceline rotation (#3299), epic #3296.
 *
 * Same shape as `PacerError` and `LapRaceError`: one class with a `code`, and
 * a message that names the field and the constraint. **No message names a
 * coordinate** (ADR 0004 decision D, `unit-error.ts`). The plan reads the route
 * as grades along its length and never reads a position, so the only values
 * its messages carry are speeds, which keep their value because for a speed
 * the number is the diagnostic. The rotation's messages never carry a value: a
 * line counts metres along the road, never a position on the earth, but a
 * message that never carries a value cannot start carrying a coordinate when a
 * later caller hands one in by mistake.
 */

/** Why a {@link GroupRideError} was raised. Switch on this, not on the message. */
export type GroupRideErrorCode =
  /** A target average that is not a finite speed above zero. */
  | 'target-out-of-range'
  /** A target faster than the group can average on this route (#3298 rule 7). */
  | 'target-unreachable'
  /** A target slower than the gentlest group can average on this route. */
  | 'target-too-slow'
  /** A capacity that is not a finite power at or above the gentlest base power. */
  | 'capacity-out-of-range'
  /** A speed model that answered something other than a finite speed above zero. */
  | 'speed-out-of-range'
  /** An odometer that is not a finite number of metres. */
  | 'odometer-not-finite'
  /** A ledger step that is not a finite number of seconds of at least zero. */
  | 'ledger-step-out-of-range'
  /** A line that is too short or too long, names a member twice, or holds more than one rider. */
  | 'line-invalid'
  /** A line's seed that is not a whole number. */
  | 'seed-not-integer'
  /** A view whose time, speeds, distances, reserves or course are not a ride's. */
  | 'view-out-of-range'
  /** A view at an instant before the last decision. */
  | 'instant-out-of-order'
  /** A line phase or a rider role this module does not name. */
  | 'unknown-value';

/** Raised, or returned, by the group ride's rules. @see GroupRideErrorCode */
export class GroupRideError extends Error {
  readonly code: GroupRideErrorCode;
  /**
   * For `target-unreachable`, the highest average the group can make on the
   * route; for `target-too-slow`, the lowest. Metres per second. `undefined`
   * for every other code.
   */
  readonly reachableAverageMetresPerSecond: number | undefined;

  constructor(code: GroupRideErrorCode, message: string, reachableAverageMetresPerSecond?: number) {
    super(message);
    this.name = 'GroupRideError';
    this.code = code;
    this.reachableAverageMetresPerSecond = reachableAverageMetresPerSecond;
  }
}
