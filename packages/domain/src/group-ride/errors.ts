// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the group ride's plan raises — #3298.
 *
 * Same shape as `PacerError` and `LapRaceError`: one class with a `code`, and
 * a message that names the field and the constraint. **No message names a
 * coordinate** (ADR 0004 decision D): the plan reads the route as grades along
 * its length and never reads a position, so the only values a message carries
 * are speeds, which keep their value because for a speed the number is the
 * diagnostic.
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
  | 'ledger-step-out-of-range';

/** Raised, or returned, by the group ride's plan. @see GroupRideErrorCode */
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
