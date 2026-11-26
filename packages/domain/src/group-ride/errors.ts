// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the group ride's rules raise — #3299, epic #3296.
 *
 * Same shape as `LapRaceError`: one class with a `code`, and a message that
 * names **the field and the constraint and never the value** (ADR 0004
 * decision D, `unit-error.ts`). A line counts metres along the road, never a
 * position on the earth, but a message that never carries a value cannot start
 * carrying a coordinate when a later caller hands one in by mistake.
 */

/** Why a {@link GroupRideError} was raised. Switch on this, not on the message. */
export type GroupRideErrorCode =
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

/** Raised by the group ride's rules. @see GroupRideErrorCode */
export class GroupRideError extends Error {
  readonly code: GroupRideErrorCode;

  constructor(code: GroupRideErrorCode, message: string) {
    super(message);
    this.name = 'GroupRideError';
    this.code = code;
  }
}
